import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@rage/db';
import { API_ERROR_CODES, errorBody } from '../common/errors/api-error.js';
import { conflict } from '../team-domain/team-errors.js';

type Tx = Prisma.TransactionClient;

/**
 * Conflict-of-interest rules (M3 security gate L-3). Officials must not decide matters of a
 * team they run: "operates" here means active CAPTAIN membership or an active TEAM_MANAGER grant
 * — the SUPER_ADMIN override of TEAMS.md §3 is deliberately NOT counted as operating a team.
 * A SUPER_ADMIN may still act despite a conflict; the action is audited with `override: true`.
 */

export const conflictOfInterest = (message: string) =>
  new ForbiddenException(errorBody(message, API_ERROR_CODES.conflictOfInterest));

/** Ids among `teamIds` that `userId` captains or manages (TEAM_MANAGER grant). */
export async function operatedTeamIds(
  tx: Tx,
  userId: string,
  teamIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(teamIds)];
  if (ids.length === 0) return new Set();
  const list = Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
  const rows = await tx.$queryRaw<{ team_id: string }[]>`
    SELECT team_id FROM team_memberships
    WHERE user_id = ${userId}::uuid AND role = 'CAPTAIN' AND left_at IS NULL
      AND team_id IN (${list})
    UNION
    SELECT scope_id AS team_id FROM user_role_grants
    WHERE user_id = ${userId}::uuid AND role = 'TEAM_MANAGER' AND scope_type = 'TEAM'
      AND revoked_at IS NULL AND scope_id IN (${list})`;
  return new Set(rows.map((r) => r.team_id));
}

/**
 * Registration rule (L-3 d): a team cannot enter a tournament in which another PENDING/APPROVED
 * registration's team shares an operator (same captain or TEAM_MANAGER user) → 409. Runs under
 * the tournament lock, so two such registrations cannot slip in concurrently.
 */
export async function assertNoSharedOperator(
  tx: Tx,
  tournamentId: string,
  teamId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH ops AS (
      SELECT user_id FROM team_memberships
      WHERE team_id = ${teamId}::uuid AND role = 'CAPTAIN' AND left_at IS NULL
      UNION
      SELECT user_id FROM user_role_grants
      WHERE role = 'TEAM_MANAGER' AND scope_type = 'TEAM' AND scope_id = ${teamId}::uuid
        AND revoked_at IS NULL
    )
    SELECT g.id FROM tournament_registrations g
    WHERE g.tournament_id = ${tournamentId}::uuid
      AND g.status IN ('PENDING', 'APPROVED')
      AND g.team_id <> ${teamId}::uuid
      AND (
        EXISTS (SELECT 1 FROM team_memberships m
                WHERE m.team_id = g.team_id AND m.role = 'CAPTAIN' AND m.left_at IS NULL
                  AND m.user_id IN (SELECT user_id FROM ops))
        OR EXISTS (SELECT 1 FROM user_role_grants r
                   WHERE r.role = 'TEAM_MANAGER' AND r.scope_type = 'TEAM'
                     AND r.scope_id = g.team_id AND r.revoked_at IS NULL
                     AND r.user_id IN (SELECT user_id FROM ops))
      )
    LIMIT 1`;
  if (rows.length > 0) {
    throw conflict(
      API_ERROR_CODES.conflictOfInterest,
      'Another team in this tournament shares a captain or manager with this team',
    );
  }
}
