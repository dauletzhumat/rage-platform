import { NotFoundException } from '@nestjs/common';
import { type Prisma, type TeamStatus } from '@rage/db';
import { API_ERROR_CODES } from '../common/errors/api-error.js';
import { conflict, forbiddenRole, sampleResource } from './team-errors.js';

type Tx = Prisma.TransactionClient;

export interface LockedTeam {
  id: string;
  slug: string;
  name: string;
  status: TeamStatus;
  isSample: boolean;
}

/**
 * `SELECT … FROM teams WHERE id = $1 FOR UPDATE` — the serialization point for every roster
 * mutation of one team (accept, remove, leave, transfer, invite, revoke). Lock order is always
 * team → grants → invitation/membership rows, so these transactions cannot deadlock each other.
 * 404 if missing; 409 SAMPLE_RESOURCE for sample teams (never part of an M2 mutation).
 */
export async function lockTeam(tx: Tx, teamId: string): Promise<LockedTeam> {
  const rows = await tx.$queryRaw<
    { id: string; slug: string; name: string; status: TeamStatus; is_sample: boolean }[]
  >`SELECT id, slug, name, status, is_sample FROM teams WHERE id = ${teamId}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new NotFoundException('Team not found');
  if (row.is_sample) throw sampleResource();
  return { id: row.id, slug: row.slug, name: row.name, status: row.status, isSample: false };
}

export function assertTeamActive(team: LockedTeam): void {
  if (team.status !== 'ACTIVE') {
    throw conflict(API_ERROR_CODES.teamNotActive, 'Team is not active');
  }
}

/**
 * Re-checks inside the transaction that the actor still holds an active GLOBAL SUPER_ADMIN grant.
 * `FOR SHARE` conflicts with the row update of a concurrent revoke, so a SUPER_ADMIN being
 * revoked cannot complete an action concurrently (same lesson as M1 security gate L-2).
 */
export async function hasSuperAdminLocked(tx: Tx, userId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM user_role_grants
    WHERE user_id = ${userId}::uuid AND role = 'SUPER_ADMIN'
      AND scope_type = 'GLOBAL' AND revoked_at IS NULL
    FOR SHARE`;
  return rows.length > 0;
}

export async function assertSuperAdminLocked(tx: Tx, userId: string): Promise<void> {
  if (!(await hasSuperAdminLocked(tx, userId))) throw forbiddenRole();
}

export interface TeamAccess {
  isCaptain: boolean;
  isManager: boolean;
  isSuperAdmin: boolean;
  /** Captain, TEAM_MANAGER of this team, or SUPER_ADMIN. */
  isOperator: boolean;
  /** SUPER_ADMIN acting on a team they neither captain nor manage (audited `override: true`). */
  override: boolean;
}

/**
 * Resolves the actor's authority over a team. Call only AFTER `lockTeam` in the same
 * transaction: captaincy is then stable (every membership change takes the team lock), and the
 * grant rows are read `FOR SHARE` so a concurrent revoke of the grant serializes with us.
 */
export async function resolveTeamAccess(
  tx: Tx,
  teamId: string,
  actorUserId: string,
): Promise<TeamAccess> {
  const captain = await tx.teamMembership.findFirst({
    where: { teamId, userId: actorUserId, role: 'CAPTAIN', leftAt: null },
    select: { id: true },
  });
  const manager = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM user_role_grants
    WHERE user_id = ${actorUserId}::uuid AND role = 'TEAM_MANAGER'
      AND scope_type = 'TEAM' AND scope_id = ${teamId}::uuid AND revoked_at IS NULL
    FOR SHARE`;
  const isSuperAdmin = await hasSuperAdminLocked(tx, actorUserId);
  const isCaptain = captain !== null;
  const isManager = manager.length > 0;
  return {
    isCaptain,
    isManager,
    isSuperAdmin,
    isOperator: isCaptain || isManager || isSuperAdmin,
    override: isSuperAdmin && !isCaptain && !isManager,
  };
}

export async function requireOperator(
  tx: Tx,
  teamId: string,
  actorUserId: string,
): Promise<TeamAccess> {
  const access = await resolveTeamAccess(tx, teamId, actorUserId);
  if (!access.isOperator) throw forbiddenRole();
  return access;
}

/** Number of active roster memberships counted against `ROSTER_CAP`. */
export async function activeRosterCount(tx: Tx, teamId: string): Promise<number> {
  return tx.teamMembership.count({
    where: { teamId, leftAt: null, role: { in: ['CAPTAIN', 'PLAYER', 'SUBSTITUTE'] } },
  });
}

/** Interactive transaction options for M2 mutations (lock waits under contention). */
export const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const;
