/**
 * Normalizes database constraint violations raised through Prisma 7 + @prisma/adapter-pg.
 *
 * With driver adapters, Prisma does not populate `meta.target`; the Postgres details live in
 * `error.meta.driverAdapterError.cause` ({ originalCode, originalMessage, constraint, table, … }).
 * Observed codes (Prisma 7.10.1): unique → P2002; CHECK / trigger RAISE → P2039 (generic DB error).
 */

export type DbViolationKind =
  'unique' | 'check' | 'foreign_key' | 'not_null' | 'append_only' | 'other';

export interface DbViolation {
  kind: DbViolationKind;
  /** Constraint or index name when available (e.g. "team_memberships_one_active_per_user_uniq"). */
  constraint: string | undefined;
  /** Postgres SQLSTATE (e.g. "23505"). */
  sqlState: string | undefined;
  /** Prisma error code (e.g. "P2002"). */
  prismaCode: string | undefined;
  table: string | undefined;
}

interface AdapterCause {
  originalCode?: unknown;
  originalMessage?: unknown;
  code?: unknown;
  kind?: unknown;
  table?: unknown;
  constraint?: { index?: unknown; fields?: unknown; foreignKey?: unknown } | unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

const SQLSTATE_KIND: Record<string, DbViolationKind> = {
  '23505': 'unique',
  '23514': 'check',
  '23503': 'foreign_key',
  '23502': 'not_null',
};

/**
 * Returns a normalized description when `error` is a database constraint/trigger violation
 * surfaced by Prisma, otherwise `undefined`.
 */
export function getDbViolation(error: unknown): DbViolation | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as { code?: unknown; meta?: { driverAdapterError?: { cause?: AdapterCause } } };
  const prismaCode = asString(e.code);
  const cause = e.meta?.driverAdapterError?.cause;
  if (!cause) {
    if (prismaCode === 'P2002')
      return {
        kind: 'unique',
        constraint: undefined,
        sqlState: '23505',
        prismaCode,
        table: undefined,
      };
    if (prismaCode === 'P2003')
      return {
        kind: 'foreign_key',
        constraint: undefined,
        sqlState: '23503',
        prismaCode,
        table: undefined,
      };
    return undefined;
  }
  const sqlState = asString(cause.originalCode) ?? asString(cause.code);
  const message = asString(cause.originalMessage) ?? '';
  const structured =
    cause.constraint && typeof cause.constraint === 'object'
      ? (cause.constraint as { index?: unknown; foreignKey?: unknown })
      : undefined;
  const constraint =
    asString(structured?.index) ??
    asString(structured?.foreignKey) ??
    /constraint "([^"]+)"/.exec(message)?.[1];

  let kind: DbViolationKind = (sqlState && SQLSTATE_KIND[sqlState]) || 'other';
  if (kind === 'other' && prismaCode === 'P2002') kind = 'unique';
  if (sqlState === 'P0001' && message.includes('is append-only')) kind = 'append_only';

  return { kind, constraint, sqlState, prismaCode, table: asString(cause.table) };
}

/** True when `error` violates the given unique constraint / unique index (or any unique one if omitted). */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const v = getDbViolation(error);
  return v?.kind === 'unique' && (constraint === undefined || v.constraint === constraint);
}
