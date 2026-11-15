import { type BracketFormat, type MatchFormat, type Prisma, type TournamentStatus } from '@rage/db';
import { hasSuperAdminLocked } from '../team-domain/team-access.js';
import { forbiddenRole, sampleResource } from '../team-domain/team-errors.js';
import { tournamentNotFound } from './tournament-errors.js';

type Tx = Prisma.TransactionClient;

/**
 * Lock order for every M3 mutation (docs/TOURNAMENTS.md §2):
 *   tournament → registration → team → grants (SUPER_ADMIN first, then scoped) → other rows;
 *   match locks: match → next match (always after the tournament lock).
 * Every transaction that touches several of these takes them in this order, so M3 mutations
 * cannot deadlock each other, nor M2 team mutations (team → grants) nor grant revocation
 * (SUPER_ADMIN grants → target grant).
 */

export interface LockedTournament {
  id: string;
  slug: string;
  name: string;
  status: TournamentStatus;
  format: BracketFormat;
  defaultMatchFormat: MatchFormat;
  maxTeams: number | null;
  registrationOpenAt: Date | null;
  registrationCloseAt: Date | null;
  settingsJson: unknown;
  isSample: boolean;
}

interface TournamentRow {
  id: string;
  slug: string;
  name: string;
  status: TournamentStatus;
  format: BracketFormat;
  default_match_format: MatchFormat;
  max_teams: number | null;
  registration_open_at: Date | null;
  registration_close_at: Date | null;
  settings_json: unknown;
  is_sample: boolean;
}

/**
 * `SELECT … FROM tournaments WHERE id = $1 FOR UPDATE | FOR SHARE`. 404 if missing. Sample
 * tournaments are rejected (409 SAMPLE_RESOURCE) unless `allowSample` (read-only checks).
 */
export async function lockTournament(
  tx: Tx,
  tournamentId: string,
  mode: 'update' | 'share' = 'update',
  options: { allowSample?: boolean } = {},
): Promise<LockedTournament> {
  const rows =
    mode === 'update'
      ? await tx.$queryRaw<TournamentRow[]>`
          SELECT id, slug, name, status, format, default_match_format, max_teams,
                 registration_open_at, registration_close_at, settings_json, is_sample
          FROM tournaments WHERE id = ${tournamentId}::uuid FOR UPDATE`
      : await tx.$queryRaw<TournamentRow[]>`
          SELECT id, slug, name, status, format, default_match_format, max_teams,
                 registration_open_at, registration_close_at, settings_json, is_sample
          FROM tournaments WHERE id = ${tournamentId}::uuid FOR SHARE`;
  const r = rows[0];
  if (!r) throw tournamentNotFound();
  if (r.is_sample && !options.allowSample) throw sampleResource();
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    status: r.status,
    format: r.format,
    defaultMatchFormat: r.default_match_format,
    maxTeams: r.max_teams,
    registrationOpenAt: r.registration_open_at,
    registrationCloseAt: r.registration_close_at,
    settingsJson: r.settings_json,
    isSample: r.is_sample,
  };
}

/** Active TOURNAMENT_ADMIN grant that is GLOBAL or scoped to this tournament (FOR SHARE). */
async function hasTournamentAdminGrantLocked(
  tx: Tx,
  userId: string,
  tournamentId: string | null,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM user_role_grants
    WHERE user_id = ${userId}::uuid AND role = 'TOURNAMENT_ADMIN' AND revoked_at IS NULL
      AND (scope_type = 'GLOBAL'
           OR (scope_type = 'TOURNAMENT' AND scope_id = ${tournamentId}::uuid))
    ORDER BY id
    FOR SHARE`;
  return rows.length > 0;
}

/**
 * "Tournament admin of T" (§2): SUPER_ADMIN, or an active TOURNAMENT_ADMIN grant GLOBAL or
 * scoped `TOURNAMENT:<T>`. Read `FOR SHARE` so a concurrent revoke serializes with the action.
 * Call after the tournament (and registration / team) locks.
 */
export async function isTournamentAdminLocked(
  tx: Tx,
  userId: string,
  tournamentId: string,
): Promise<boolean> {
  if (await hasSuperAdminLocked(tx, userId)) return true;
  return hasTournamentAdminGrantLocked(tx, userId, tournamentId);
}

/**
 * 403 FORBIDDEN_ROLE unless tournament admin of T. A DRAFT tournament is unpublished, so a
 * caller without authority gets 404 instead (API_CONVENTIONS §5: may not know it exists).
 */
export async function requireTournamentAdmin(
  tx: Tx,
  userId: string,
  tournament: { id: string; status: TournamentStatus },
): Promise<void> {
  if (await isTournamentAdminLocked(tx, userId, tournament.id)) return;
  if (tournament.status === 'DRAFT') throw tournamentNotFound();
  throw forbiddenRole();
}

/** Create: SUPER_ADMIN or GLOBAL TOURNAMENT_ADMIN, re-checked in the transaction. */
export async function requireGlobalTournamentAdmin(tx: Tx, userId: string): Promise<void> {
  if (await hasSuperAdminLocked(tx, userId)) return;
  if (await hasTournamentAdminGrantLocked(tx, userId, null)) return;
  throw forbiddenRole();
}

/**
 * "Match admin of M" (§2): tournament admin of M's tournament, or an active MATCH_ADMIN grant
 * GLOBAL, scoped `TOURNAMENT:<T>` (AUTH.md §6 grantable scope) or `MATCH:<M>`.
 */
export async function isMatchAdminLocked(
  tx: Tx,
  userId: string,
  matchId: string,
  tournamentId: string | null,
): Promise<boolean> {
  if (await hasSuperAdminLocked(tx, userId)) return true;
  if (await hasTournamentAdminGrantLocked(tx, userId, tournamentId)) return true;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM user_role_grants
    WHERE user_id = ${userId}::uuid AND role = 'MATCH_ADMIN' AND revoked_at IS NULL
      AND (scope_type = 'GLOBAL'
           OR (scope_type = 'TOURNAMENT' AND scope_id = ${tournamentId}::uuid)
           OR (scope_type = 'MATCH' AND scope_id = ${matchId}::uuid))
    ORDER BY id
    FOR SHARE`;
  return rows.length > 0;
}

/**
 * Read-only scope of a caller's tournament-admin authority (no locks; for admin lists).
 * `all` = SUPER_ADMIN or GLOBAL TOURNAMENT_ADMIN; otherwise the scoped tournament ids.
 */
export async function tournamentAdminScope(
  db: Tx,
  userId: string,
): Promise<{ all: boolean; tournamentIds: string[] }> {
  const grants = await db.userRoleGrant.findMany({
    where: { userId, revokedAt: null, role: { in: ['SUPER_ADMIN', 'TOURNAMENT_ADMIN'] } },
    select: { role: true, scopeType: true, scopeId: true },
  });
  const all = grants.some(
    (g) => g.scopeType === 'GLOBAL' && (g.role === 'SUPER_ADMIN' || g.role === 'TOURNAMENT_ADMIN'),
  );
  const tournamentIds = grants
    .filter((g) => g.role === 'TOURNAMENT_ADMIN' && g.scopeType === 'TOURNAMENT' && g.scopeId)
    .map((g) => g.scopeId!);
  return { all, tournamentIds };
}

/** Interactive transaction options for M3 mutations (lock waits under contention). */
export const M3_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;
