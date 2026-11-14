import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyGrants, type ApplyGrantsSummary } from '../prisma/grants.js';
import {
  getTestDatabaseUrl,
  uniqueSteamId64,
  uniqueSuffix,
  withPgClient,
} from './helpers/test-db.js';

// Roles are cluster-wide. A dedicated role name keeps this suite from changing the password of
// the dev `rage_app` role (which the local API may be using) and tolerates leftovers from
// earlier runs: every run re-applies attributes, password and grants.
const ROLE = 'rage_app_it';
const PASSWORD = randomBytes(18).toString('base64url');
const PERMISSION_DENIED = /permission denied/;

function appConnectionString(): string {
  const u = new URL(getTestDatabaseUrl());
  u.username = ROLE;
  u.password = PASSWORD;
  u.searchParams.delete('schema');
  return u.toString();
}

async function withAppClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: appConnectionString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Runs `fn` in a transaction that is always rolled back. */
async function inRolledBackTx<T>(client: pg.Client, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    return await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

async function expectDenied(
  client: pg.Client,
  sql: string,
  pattern: RegExp = PERMISSION_DENIED,
): Promise<void> {
  await client.query('SAVEPOINT denied');
  await expect(client.query(sql)).rejects.toThrow(pattern);
  await client.query('ROLLBACK TO SAVEPOINT denied');
}

type GrantRow = { table_name: string; privilege_type: string };

async function privilegeSnapshot(): Promise<string[]> {
  return withPgClient(async (c) => {
    const r = await c.query<GrantRow>(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = $1 AND table_schema = 'public' ORDER BY 1, 2`,
      [ROLE],
    );
    return r.rows.map((x) => `${x.table_name}:${x.privilege_type}`);
  });
}

let firstRun: ApplyGrantsSummary;

beforeAll(async () => {
  // Simulate a pre-existing, mis-configured role: the script must repair its attributes.
  await withPgClient(async (c) => {
    const isSuper = await c.query<{ s: boolean }>(
      `SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user`,
    );
    const exists = await c.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [ROLE]);
    if (isSuper.rows[0]?.s && exists.rowCount) {
      await c.query(`ALTER ROLE ${ROLE} CREATEDB INHERIT`);
    }
  });
  firstRun = await withPgClient((c) => applyGrants(c, { role: ROLE, password: PASSWORD }));
});

describe('db:grants application role (ADR-016)', () => {
  it('reports a sane summary', () => {
    expect(firstRun.role).toBe(ROLE);
    expect(firstRun.database).toMatch(/_test$/);
    expect(firstRun.owner).not.toBe(ROLE);
    expect(firstRun.dmlTables).toBeGreaterThan(30);
    expect(firstRun.appendOnlyTables).toEqual(['audit_logs', 'match_events']);
  });

  it('role has no elevated attributes and stores only a SCRAM verifier', async () => {
    await withPgClient(async (c) => {
      const r = await c.query(
        `SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit, rolcanlogin
           FROM pg_roles WHERE rolname = $1`,
        [ROLE],
      );
      expect(r.rows[0]).toEqual({
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
        rolinherit: false,
        rolcanlogin: true,
      });
      const su = await c.query<{ s: boolean }>(
        `SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user`,
      );
      if (su.rows[0]?.s) {
        const pw = await c.query<{ p: string }>(
          `SELECT rolpassword AS p FROM pg_authid WHERE rolname = $1`,
          [ROLE],
        );
        expect(pw.rows[0]?.p.startsWith('SCRAM-SHA-256$4096:')).toBe(true);
        expect(pw.rows[0]?.p).not.toContain(PASSWORD);
      }
    });
    await withAppClient(async (app) => {
      const r = await app.query<{ u: string; s: string }>(
        `SELECT current_user AS u, current_setting('is_superuser') AS s`,
      );
      expect(r.rows[0]).toEqual({ u: ROLE, s: 'off' });
    });
  });

  it('can SELECT/INSERT/UPDATE/DELETE a normal table', async () => {
    await withAppClient(async (app) => {
      await inRolledBackTx(app, async () => {
        const id = randomUUID();
        const steam = uniqueSteamId64();
        await app.query(`INSERT INTO users (id, steam_id64, updated_at) VALUES ($1, $2, now())`, [
          id,
          steam,
        ]);
        await app.query(
          `INSERT INTO player_profiles (id, user_id, nickname, slug, updated_at)
           VALUES ($1, $2, $3, $4, now())`,
          [
            randomUUID(),
            id,
            `it_${uniqueSuffix()}`.slice(0, 32),
            `it-${uniqueSuffix()}`.slice(0, 32),
          ],
        );
        const upd = await app.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [id]);
        expect(upd.rowCount).toBe(1);
        const sel = await app.query<{ status: string }>(`SELECT status FROM users WHERE id = $1`, [
          id,
        ]);
        expect(sel.rows[0]?.status).toBe('SUSPENDED');
        expect(
          (await app.query(`DELETE FROM player_profiles WHERE user_id = $1`, [id])).rowCount,
        ).toBe(1);
        expect((await app.query(`DELETE FROM users WHERE id = $1`, [id])).rowCount).toBe(1);
      });
    });
  });

  it('has full DML (not append-only) on idempotency_keys (M2)', async () => {
    const privs = await privilegeSnapshot();
    expect(privs.filter((p) => p.startsWith('idempotency_keys:'))).toEqual([
      'idempotency_keys:DELETE',
      'idempotency_keys:INSERT',
      'idempotency_keys:SELECT',
      'idempotency_keys:UPDATE',
    ]);
    await withAppClient(async (app) => {
      await inRolledBackTx(app, async () => {
        const userId = randomUUID();
        await app.query(`INSERT INTO users (id, steam_id64, updated_at) VALUES ($1, $2, now())`, [
          userId,
          uniqueSteamId64(),
        ]);
        const id = randomUUID();
        await app.query(
          `INSERT INTO idempotency_keys (id, user_id, key, method, route, request_hash, expires_at)
           VALUES ($1, $2, $3, 'POST', '/api/v1/teams/:teamId/leave', $4, now() + interval '24 hours')`,
          [id, userId, randomUUID(), 'a'.repeat(64)],
        );
        const upd = await app.query(
          `UPDATE idempotency_keys SET status = 'COMPLETED', response_status = 204 WHERE id = $1`,
          [id],
        );
        expect(upd.rowCount).toBe(1);
        expect((await app.query(`DELETE FROM idempotency_keys WHERE id = $1`, [id])).rowCount).toBe(
          1,
        );
      });
    });
  });

  it('can INSERT and SELECT audit_logs, and INSERT is granted on match_events', async () => {
    await withAppClient(async (app) => {
      await inRolledBackTx(app, async () => {
        const id = randomUUID();
        await app.query(
          `INSERT INTO audit_logs (id, action, resource_type) VALUES ($1, 'roles.it', 'test')`,
          [id],
        );
        const r = await app.query(`SELECT 1 FROM audit_logs WHERE id = $1`, [id]);
        expect(r.rowCount).toBe(1);
      });
      const p = await app.query<{ i: boolean; s: boolean }>(
        `SELECT has_table_privilege('match_events', 'INSERT') AS i, has_table_privilege('match_events', 'SELECT') AS s`,
      );
      expect(p.rows[0]).toEqual({ i: true, s: true });
    });
  });

  it.each(['audit_logs', 'match_events'])(
    'UPDATE, DELETE and TRUNCATE on %s are denied, even with the maintenance GUC',
    async (table) => {
      await withAppClient(async (app) => {
        for (const maintenance of [false, true]) {
          await inRolledBackTx(app, async () => {
            if (maintenance) await app.query(`SET LOCAL rage.allow_append_only_maintenance = 'on'`);
            const col = table === 'audit_logs' ? 'action' : 'event_type';
            await expectDenied(app, `UPDATE ${table} SET ${col} = 'x'`);
            await expectDenied(app, `DELETE FROM ${table}`);
            await expectDenied(app, `TRUNCATE ${table}`);
          });
        }
      });
    },
  );

  it('cannot read or write _prisma_migrations', async () => {
    await withAppClient(async (app) => {
      await inRolledBackTx(app, async () => {
        await expectDenied(app, `SELECT count(*) FROM _prisma_migrations`);
        await expectDenied(app, `DELETE FROM _prisma_migrations`);
      });
    });
  });

  it('cannot TRUNCATE a normal table, create tables, or alter the schema', async () => {
    await withAppClient(async (app) => {
      await inRolledBackTx(app, async () => {
        await expectDenied(app, `TRUNCATE users`);
        await expectDenied(app, `CREATE TABLE public.rage_app_it_forbidden (id int)`);
        // QA gate M1 P3-4: no TEMP tables either.
        await expectDenied(app, `CREATE TEMP TABLE rage_app_it_tmp (id int)`);
        await expectDenied(app, `ALTER TABLE users ADD COLUMN x int`, /must be owner/);
        await expectDenied(
          app,
          `DROP TRIGGER audit_logs_append_only ON audit_logs`,
          /must be owner/,
        );
      });
      const r = await app.query<{ c: boolean }>(
        `SELECT has_schema_privilege('public', 'CREATE') AS c`,
      );
      expect(r.rows[0]?.c).toBe(false);
    });
  });

  it('is idempotent: a second run yields the identical privilege set', async () => {
    const before = await privilegeSnapshot();
    const second = await withPgClient((c) => applyGrants(c, { role: ROLE, password: PASSWORD }));
    expect(second.roleCreated).toBe(false);
    expect(second.dmlTables).toBe(firstRun.dmlTables);
    expect(await privilegeSnapshot()).toEqual(before);
    expect(before).toContain('audit_logs:INSERT');
    expect(before).toContain('audit_logs:SELECT');
    expect(
      before.filter((x) => x.startsWith('audit_logs:') || x.startsWith('match_events:')).sort(),
    ).toEqual([
      'audit_logs:INSERT',
      'audit_logs:SELECT',
      'match_events:INSERT',
      'match_events:SELECT',
    ]);
    expect(before.some((x) => x.startsWith('_prisma_migrations:'))).toBe(false);
    expect(before.some((x) => /:(TRUNCATE|REFERENCES|TRIGGER|MAINTAIN)$/.test(x))).toBe(false);
    // The app can still log in after the password was re-applied.
    await withAppClient(async (app) => {
      expect((await app.query('SELECT 1')).rowCount).toBe(1);
    });
  });

  it('refuses an empty password and an invalid role name without touching the database', async () => {
    await withPgClient(async (c) => {
      await expect(applyGrants(c, { role: ROLE, password: '' })).rejects.toThrow(
        /RAGE_APP_DB_PASSWORD/,
      );
      await expect(applyGrants(c, { role: 'Bad-Name', password: PASSWORD })).rejects.toThrow(
        /RAGE_APP_DB_ROLE/,
      );
    });
  });

  it('refuses to run when connected as the application role', async () => {
    await withAppClient(async (app) => {
      await expect(applyGrants(app, { role: ROLE, password: PASSWORD })).rejects.toThrow(
        /application role|owner|permission denied/,
      );
    });
  });

  describe('tables created by a later migration', () => {
    const table = `roles_it_future_${uniqueSuffix().replace(/[^a-z0-9]/g, '')}`.slice(0, 60);

    afterAll(async () => {
      await withPgClient((c) => c.query(`DROP TABLE IF EXISTS public.${table}`));
    });

    it('receive DML (but not TRUNCATE) through default privileges', async () => {
      await withPgClient((c) =>
        c.query(`CREATE TABLE public.${table} (id int PRIMARY KEY, note text, n serial)`),
      );
      await withAppClient(async (app) => {
        await inRolledBackTx(app, async () => {
          await app.query(`INSERT INTO public.${table} (id, note) VALUES (1, 'a')`);
          await app.query(`UPDATE public.${table} SET note = 'b' WHERE id = 1`);
          const r = await app.query<{ note: string; n: number }>(
            `SELECT note, n FROM public.${table}`,
          );
          expect(r.rows[0]?.note).toBe('b');
          await app.query(`DELETE FROM public.${table} WHERE id = 1`);
          await expectDenied(app, `TRUNCATE public.${table}`);
        });
      });
    });
  });
});
