import { type InvitationStatus, Prisma } from '@rage/db';
import { type AuditRequestContext, type AuditService } from '../audit/audit.service.js';
import { iso } from '../common/http/dto.js';
import type { InvitationRole } from './team-policy.js';

type Tx = Prisma.TransactionClient;

export interface InvitationScope {
  teamId?: string;
  inviteeUserId?: string;
  invitationId?: string;
}

/**
 * Lazy expiry (TEAMS.md §6.4): persists `EXPIRED` (responded_at = expires_at) for PENDING
 * invitations past `expires_at` within the given scope, and audits each one. The single
 * `UPDATE … RETURNING` is atomic per row: under concurrency only the transaction that actually
 * flips a row sees it returned, so each expiry is audited exactly once.
 */
export async function expireStaleInvitations(
  tx: Tx,
  audit: AuditService,
  ctx: AuditRequestContext,
  scope: InvitationScope,
  triggeredByUserId: string | null,
  now = new Date(),
): Promise<string[]> {
  const filters: Prisma.Sql[] = [];
  if (scope.teamId) filters.push(Prisma.sql`AND team_id = ${scope.teamId}::uuid`);
  if (scope.inviteeUserId) {
    filters.push(Prisma.sql`AND invitee_user_id = ${scope.inviteeUserId}::uuid`);
  }
  if (scope.invitationId) filters.push(Prisma.sql`AND id = ${scope.invitationId}::uuid`);
  if (filters.length === 0) throw new Error('expireStaleInvitations requires a scope');
  // CTE with ORDER BY id FOR UPDATE SKIP LOCKED (gate I-5): deterministic lock order and no
  // waiting on rows another transaction is already handling (that transaction decides them;
  // rows this transaction already holds are never skipped).
  const rows = await tx.$queryRaw<
    { id: string; team_id: string; invitee_user_id: string; role: string }[]
  >`
    WITH stale AS (
      SELECT id FROM team_invitations
      WHERE status = 'PENDING' AND expires_at <= ${now} ${Prisma.join(filters, ' ')}
      ORDER BY id
      FOR UPDATE SKIP LOCKED
    )
    UPDATE team_invitations t SET status = 'EXPIRED', responded_at = t.expires_at
    FROM stale WHERE t.id = stale.id
    RETURNING t.id, t.team_id, t.invitee_user_id, t.role`;
  for (const row of rows) {
    await audit.write(
      {
        action: 'team_invitation.expire',
        // System transition (lazy expiry); the user whose request noticed it is kept in detail.
        actorUserId: null,
        resourceType: 'team_invitation',
        resourceId: row.id,
        detail: {
          teamId: row.team_id,
          inviteeUserId: row.invitee_user_id,
          role: row.role,
          triggeredByUserId,
        },
      },
      ctx,
      tx,
    );
  }
  return rows.map((r) => r.id);
}

export const teamInvitationSelect = {
  id: true,
  status: true,
  role: true,
  expiresAt: true,
  createdAt: true,
  respondedAt: true,
  inviteeUserId: true,
  invitedById: true,
  invitee: {
    select: { steamId64: true, playerProfile: { select: { nickname: true, slug: true } } },
  },
  invitedBy: { select: { playerProfile: { select: { nickname: true } } } },
} satisfies Prisma.TeamInvitationSelect;

export type TeamInvitationRow = Prisma.TeamInvitationGetPayload<{
  select: typeof teamInvitationSelect;
}>;

export const myInvitationSelect = {
  id: true,
  status: true,
  role: true,
  expiresAt: true,
  createdAt: true,
  respondedAt: true,
  team: { select: { id: true, slug: true, name: true, tag: true } },
  invitedBy: { select: { playerProfile: { select: { nickname: true } } } },
} satisfies Prisma.TeamInvitationSelect;

export type MyInvitationRow = Prisma.TeamInvitationGetPayload<{
  select: typeof myInvitationSelect;
}>;

export interface TeamInvitationView {
  id: string;
  status: InvitationStatus;
  role: InvitationRole;
  expiresAt: string;
  createdAt: string;
  respondedAt: string | null;
  invitee: { userId: string; steamId64: string; nickname: string; playerSlug: string };
  invitedBy: { userId: string; nickname: string };
}

export interface MyInvitationView {
  id: string;
  status: InvitationStatus;
  role: InvitationRole;
  expiresAt: string;
  createdAt: string;
  respondedAt: string | null;
  team: { id: string; slug: string; name: string; tag: string };
  invitedBy: { nickname: string };
}

export function toTeamInvitationView(row: TeamInvitationRow): TeamInvitationView {
  return {
    id: row.id,
    status: row.status,
    role: row.role as InvitationRole,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    respondedAt: iso(row.respondedAt),
    invitee: {
      userId: row.inviteeUserId,
      steamId64: row.invitee.steamId64,
      nickname: row.invitee.playerProfile?.nickname ?? '',
      playerSlug: row.invitee.playerProfile?.slug ?? '',
    },
    invitedBy: {
      userId: row.invitedById,
      nickname: row.invitedBy.playerProfile?.nickname ?? '',
    },
  };
}

export function toMyInvitationView(row: MyInvitationRow): MyInvitationView {
  return {
    id: row.id,
    status: row.status,
    role: row.role as InvitationRole,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    respondedAt: iso(row.respondedAt),
    team: row.team,
    invitedBy: { nickname: row.invitedBy.playerProfile?.nickname ?? '' },
  };
}
