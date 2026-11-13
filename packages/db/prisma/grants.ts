/**
 * `db:grants` — creates/updates the least-privilege application role (ADR-016, SEC-M0-M4).
 *
 * Run as the database OWNER (the role that runs `prisma migrate deploy`) after every
 * `migrate deploy`. Idempotent: every run re-creates the exact privilege set, so restrictions
 * on append-only tables are re-applied even if a migration (or default privileges) granted more.
 *
 * Env:
 *   MIGRATION_DATABASE_URL  owner connection (falls back to DATABASE_URL)
 *   RAGE_APP_DB_ROLE        application role name (default `rage_app`)
 *   RAGE_APP_DB_PASSWORD    application role password (required, never logged)
 *
 * The password never reaches the server in plaintext: a SCRAM-SHA-256 verifier is computed
 * locally and passed as a bind parameter to `format('%L')`, so it cannot appear in server
 * statement logs in cleartext and no shell or SQL string interpolation is involved.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadRootEnv, ownerDatabaseUrl } from './load-env.js';

export const DEFAULT_APP_ROLE = 'rage_app';

/** Tables the application may only SELECT and INSERT (raw history; see append-only triggers). */
export const APPEND_ONLY_TABLES: readonly string[] = ['audit_logs', 'match_events'];

/** Tables the application must not access at all. */
export const NO_ACCESS_TABLES: readonly string[] = ['_prisma_migrations'];

const ROLE_NAME_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const RESERVED_ROLE_NAMES = new Set([
  'public',
  'none',
  'current_user',
  'session_user',
  'current_role',
]);
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;
const SCRAM_ITERATIONS = 4096;

export function validateAppRoleName(name: string): string {
  if (!ROLE_NAME_RE.test(name) || name.startsWith('pg_') || RESERVED_ROLE_NAMES.has(name)) {
    throw new Error(
      `RAGE_APP_DB_ROLE must match ${ROLE_NAME_RE.source}, must not start with "pg_" and must not be reserved`,
    );
  }
  return name;
}

/**
 * Validates the app password without ever echoing it. Printable ASCII only: node-postgres does
 * not apply SASLprep, so non-ASCII passwords could hash differently on client and server.
 */
export function validateAppPassword(password: string | undefined): string {
  if (password === undefined || password === '') {
    throw new Error('RAGE_APP_DB_PASSWORD is required and must not be empty');
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(
      `RAGE_APP_DB_PASSWORD must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters long`,
    );
  }
  if (!/^[\x21-\x7e]+$/.test(password)) {
    throw new Error('RAGE_APP_DB_PASSWORD must contain only printable ASCII without spaces');
  }
  return password;
}

/**
 * Builds a PostgreSQL SCRAM-SHA-256 verifier (RFC 5802/7677, the format stored in pg_authid):
 * `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>`.
 */
export function scramSha256Verifier(
  password: string,
  salt: Buffer = randomBytes(16),
  iterations = SCRAM_ITERATIONS,
): string {
  const salted = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

export interface ApplyGrantsOptions {
  role?: string;
  password: string | undefined;
}

export interface ApplyGrantsSummary {
  role: string;
  roleCreated: boolean;
  owner: string;
  database: string;
  dmlTables: number;
  appendOnlyTables: string[];
  noAccessTables: string[];
  sequences: number;
}

function quoteIdent(name: string): string {
  // Only ever called with names validated by ROLE_NAME_RE or read from the catalog.
  return `"${name.replace(/"/g, '""')}"`;
}

/** Runs one server-built statement: `format()` does the quoting, values are bind parameters. */
async function execFormatted(
  client: pg.ClientBase,
  template: string,
  args: string[],
): Promise<void> {
  const placeholders = args.map((_, i) => `$${i + 1}::text`).join(', ');
  const built = await client.query<{ sql: string }>(
    `SELECT format('${template}', ${placeholders}) AS sql`,
    args,
  );
  const row = built.rows[0];
  if (!row) throw new Error('format() returned no statement');
  await client.query(row.sql);
}

/**
 * Creates/updates the application role and re-applies its exact privilege set inside a single
 * transaction. `client` must be connected as the owner of the `public` schema tables.
 */
export async function applyGrants(
  client: pg.ClientBase,
  options: ApplyGrantsOptions,
): Promise<ApplyGrantsSummary> {
  const role = validateAppRoleName(options.role ?? DEFAULT_APP_ROLE);
  const verifier = scramSha256Verifier(validateAppPassword(options.password));
  const r = quoteIdent(role);

  await client.query('BEGIN');
  try {
    // Serialise concurrent runs against the same database.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('rage:db:grants'))`);

    const ctx = await client.query<{ owner: string; database: string; version: number }>(
      `SELECT current_user AS owner, current_database() AS database,
              current_setting('server_version_num')::int AS version`,
    );
    const { owner, database, version } = ctx.rows[0]!;
    if (owner === role) {
      throw new Error(
        `db:grants is connected as the application role "${role}"; connect as the owner (MIGRATION_DATABASE_URL)`,
      );
    }

    const foreign = await client.query<{ name: string; owner: string }>(
      `SELECT c.relname AS name, pg_get_userbyid(c.relowner) AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f','S')
          AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user)
        ORDER BY 1`,
    );
    if (foreign.rows.length > 0) {
      const list = foreign.rows.map((x) => `${x.name} (owner ${x.owner})`).join(', ');
      throw new Error(
        `db:grants must run as the owner of all objects in schema public ("${owner}" does not own: ${list})`,
      );
    }

    const required = [...APPEND_ONLY_TABLES, ...NO_ACCESS_TABLES];
    const present = await client.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relname = ANY($1::text[])`,
      [required],
    );
    const presentSet = new Set(present.rows.map((x) => x.name));
    const missing = required.filter((t) => !presentSet.has(t));
    if (missing.length > 0) {
      throw new Error(
        `Tables missing: ${missing.join(', ')}. Run "migrate:deploy" before "db:grants".`,
      );
    }

    // --- Role --------------------------------------------------------------------------
    const existed = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [role]);
    let roleCreated = false;
    if (existed.rowCount === 0) {
      await client.query('SAVEPOINT create_role');
      try {
        await client.query(`CREATE ROLE ${r} NOLOGIN`);
        await client.query('RELEASE SAVEPOINT create_role');
        roleCreated = true;
      } catch (error) {
        // Roles are cluster-wide: another database's db:grants may have created it meanwhile.
        if ((error as { code?: string }).code !== '42710') throw error;
        await client.query('ROLLBACK TO SAVEPOINT create_role');
      }
    }
    await execFormatted(
      client,
      'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD %L',
      [role, verifier],
    );

    const escalation = await client.query<{ granted: string }>(
      `SELECT pg_get_userbyid(m.roleid) AS granted FROM pg_auth_members m
        WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = $1)
          AND (m.roleid = (SELECT oid FROM pg_roles WHERE rolname = current_user)
               OR (SELECT rolsuper OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE oid = m.roleid))`,
      [role],
    );
    if (escalation.rows.length > 0) {
      throw new Error(
        `Role "${role}" is a member of privileged role(s) ${escalation.rows.map((x) => x.granted).join(', ')}; revoke the membership manually`,
      );
    }

    // --- Database and schema ------------------------------------------------------------
    await execFormatted(client, 'GRANT CONNECT ON DATABASE %I TO %I', [database, role]);
    // No TEMP tables for the app role (default PUBLIC privilege; QA gate M1 P3-4). The
    // database owner keeps them through ownership.
    await execFormatted(client, 'REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', [database]);
    await execFormatted(client, 'REVOKE TEMPORARY ON DATABASE %I FROM %I', [database, role]);
    await client.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
    await client.query(`REVOKE CREATE ON SCHEMA public FROM ${r}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${r}`);

    // --- Tables: reset, grant DML, then restrict ----------------------------------------
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${r}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${r}`,
    );
    const forbidden =
      version >= 170000
        ? 'TRUNCATE, REFERENCES, TRIGGER, MAINTAIN'
        : 'TRUNCATE, REFERENCES, TRIGGER';
    await client.query(`REVOKE ${forbidden} ON ALL TABLES IN SCHEMA public FROM ${r}`);
    for (const table of APPEND_ONLY_TABLES) {
      await client.query(`REVOKE UPDATE, DELETE ON TABLE public.${quoteIdent(table)} FROM ${r}`);
    }
    for (const table of NO_ACCESS_TABLES) {
      await client.query(`REVOKE ALL ON TABLE public.${quoteIdent(table)} FROM ${r}`);
    }

    // --- Sequences ----------------------------------------------------------------------
    await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${r}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${r}`);

    // --- Future objects created by the owner (i.e. by later migrations) -----------------
    // NOTE: a new append-only table gets full DML from these defaults until it is added to
    // APPEND_ONLY_TABLES and db:grants is re-run (which is mandatory after every migrate).
    const o = quoteIdent(owner);
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${o} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${r}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${o} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${r}`,
    );

    // --- Self-check (defence in depth; aborts the transaction on any mismatch) ----------
    // Append-only: exactly SELECT + INSERT. No-access: nothing at all.
    const check = await client.query<{ name: string; ok: boolean }>(
      `SELECT t.name,
              NOT has_table_privilege($1, t.oid, 'UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
          AND CASE WHEN t.name = ANY($3::text[])
                   THEN NOT has_table_privilege($1, t.oid, 'SELECT, INSERT')
                   ELSE has_table_privilege($1, t.oid, 'SELECT') AND has_table_privilege($1, t.oid, 'INSERT')
              END AS ok
         FROM (SELECT x AS name, format('public.%I', x)::regclass::oid AS oid
                 FROM unnest($2::text[]) AS x) AS t`,
      [role, required, [...NO_ACCESS_TABLES]],
    );
    const bad = check.rows.filter((x) => !x.ok).map((x) => x.name);
    const attrs = await client.query<{ ok: boolean }>(
      `SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)
              AND rolcanlogin AS ok FROM pg_roles WHERE rolname = $1`,
      [role],
    );
    if (bad.length > 0 || attrs.rows[0]?.ok !== true) {
      throw new Error(`db:grants self-check failed (tables: ${bad.join(', ') || 'ok'})`);
    }

    const counts = await client.query<{ tables: number; sequences: number }>(
      `SELECT
         (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
             AND has_table_privilege($1, c.oid, 'UPDATE')) AS tables,
         (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'S') AS sequences`,
      [role],
    );

    await client.query('COMMIT');
    return {
      role,
      roleCreated,
      owner,
      database,
      dmlTables: counts.rows[0]!.tables,
      appendOnlyTables: [...APPEND_ONLY_TABLES],
      noAccessTables: [...NO_ACCESS_TABLES],
      sequences: counts.rows[0]!.sequences,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

/** Strips the Prisma-only `?schema=` parameter; only the `public` schema is supported. */
export function toPgConnectionString(url: string): string {
  const u = new URL(url);
  const schema = u.searchParams.get('schema');
  if (schema && schema !== 'public') {
    throw new Error(`db:grants supports only schema "public", got "${schema}"`);
  }
  u.searchParams.delete('schema');
  return u.toString();
}

async function main(): Promise<void> {
  loadRootEnv();
  const role = process.env.RAGE_APP_DB_ROLE || DEFAULT_APP_ROLE;
  const password = process.env.RAGE_APP_DB_PASSWORD;
  // Validate before connecting so a misconfiguration fails fast.
  validateAppRoleName(role);
  validateAppPassword(password);

  const client = new pg.Client({ connectionString: toPgConnectionString(ownerDatabaseUrl()) });
  await client.connect();
  try {
    const summary = await applyGrants(client, { role, password });
    console.warn(`[db:grants] applied: ${JSON.stringify(summary)}`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    // Print the message only: never dump objects that could carry connection details.
    console.error('[db:grants] failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
