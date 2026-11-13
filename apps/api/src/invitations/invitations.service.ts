import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DB_CONSTRAINTS, type InvitationStatus, type Prisma } from '@rage/db';
import { type AuditRequestContext, AuditService } from '../audit/audit.service.js';
import { API_ERROR_CODES } from '../common/errors/api-error.js';
import { errorSummary, PrismaService } from '../infra/prisma/prisma.service.js';
import {
  activeRosterCount,
  assertTeamActive,
  lockTeam,
  TX_OPTIONS,
} from '../team-domain/team-access.js';
import {
  alreadyInTeam,
  conflict,
  invitationExpired,
  invitationNotPending,
  rethrowMapped,
} from '../team-domain/team-errors.js';
import {
  expireStaleInvitations,
  myInvitationSelect,
  toMyInvitationView,
} from '../team-domain/invitations.js';
import { MY_INVITATIONS_LIMIT, ROSTER_CAP } from '../team-domain/team-policy.js';
import type { MyInvitationDto } from './invitations.dto.js';

type Tx = Prisma.TransactionClient;

interface LockedInvitation {
  team_id: string;
  status: InvitationStatus;
  role: 'PLAYER' | 'SUBSTITUTE';
  invited_by: string;
  expires_at: Date;
}

const invitationNotFound = () => new NotFoundException('Invitation not found');

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Own invitations with the given status (default PENDING), newest first, max 50. */
  async listMine(
    userId: string,
    status: InvitationStatus,
    ctx: AuditRequestContext,
  ): Promise<MyInvitationDto[]> {
    // Lazy expiry on read is best effort (TEAMS.md §6.4).
    try {
      await this.prisma.client.$transaction(
        (tx) => expireStaleInvitations(tx, this.audit, ctx, { inviteeUserId: userId }, userId),
        TX_OPTIONS,
      );
    } catch (err) {
      this.logger.warn({ err: errorSummary(err) }, 'lazy invitation expiry failed');
    }
    const rows = await this.prisma.client.teamInvitation.findMany({
      where: {
        inviteeUserId: userId,
        status,
        ...(status === 'PENDING' ? { expiresAt: { gt: new Date() } } : {}),
      },
      select: myInvitationSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MY_INVITATIONS_LIMIT,
    });
    return rows.map(toMyInvitationView);
  }

  /**
   * Resolves the invitation for its invitee only: another user's invitation is reported as
   * missing (404) so its existence is not revealed. Then takes the team lock (the roster
   * serialization point) and locks the invitation row — lock order team → invitation, the same
   * as revoke, so accept/decline/revoke serialize without deadlocks.
   */
  private async lockOwnInvitation(
    tx: Tx,
    userId: string,
    invitationId: string,
  ): Promise<LockedInvitation> {
    const peek = await tx.teamInvitation.findUnique({
      where: { id: invitationId },
      select: { teamId: true, inviteeUserId: true },
    });
    if (!peek || peek.inviteeUserId !== userId) throw invitationNotFound();
    await lockTeam(tx, peek.teamId);
    const rows = await tx.$queryRaw<LockedInvitation[]>`
      SELECT team_id, status, role, invited_by, expires_at FROM team_invitations
      WHERE id = ${invitationId}::uuid AND invitee_user_id = ${userId}::uuid
      FOR UPDATE`;
    if (!rows[0]) throw invitationNotFound();
    return rows[0];
  }

  /** TEAMS.md §6.1. */
  async accept(
    userId: string,
    invitationId: string,
    ctx: AuditRequestContext,
  ): Promise<MyInvitationDto> {
    let result: { expired: true } | { expired: false; view: MyInvitationDto };
    try {
      result = await this.prisma.client.$transaction(async (tx) => {
        const inv = await this.lockOwnInvitation(tx, userId, invitationId);
        if (inv.status !== 'PENDING') throw invitationNotPending();
        const now = new Date();
        if (inv.expires_at.getTime() <= now.getTime()) {
          await expireStaleInvitations(tx, this.audit, ctx, { invitationId }, userId, now);
          return { expired: true as const };
        }
        const team = await tx.team.findUniqueOrThrow({
          where: { id: inv.team_id },
          select: { id: true, status: true, slug: true, name: true },
        });
        assertTeamActive({ ...team, isSample: false });
        const existing = await tx.teamMembership.findFirst({
          where: { userId, leftAt: null },
          select: { id: true },
        });
        if (existing) throw alreadyInTeam();
        if ((await activeRosterCount(tx, inv.team_id)) >= ROSTER_CAP) {
          throw conflict(API_ERROR_CODES.rosterFull, `The roster is full (max ${ROSTER_CAP})`);
        }
        const membership = await tx.teamMembership.create({
          data: {
            teamId: inv.team_id,
            userId,
            role: inv.role,
            joinedAt: now,
            invitedById: inv.invited_by,
            invitationId,
          },
          select: { id: true },
        });
        const row = await tx.teamInvitation.update({
          where: { id: invitationId },
          data: { status: 'ACCEPTED', respondedAt: now },
          select: myInvitationSelect,
        });
        await this.audit.write(
          {
            action: 'team_invitation.accept',
            actorUserId: userId,
            resourceType: 'team_invitation',
            resourceId: invitationId,
            detail: { teamId: inv.team_id, role: inv.role, membershipId: membership.id },
          },
          ctx,
          tx,
        );
        await this.audit.write(
          {
            action: 'team_membership.join',
            actorUserId: userId,
            resourceType: 'team_membership',
            resourceId: membership.id,
            detail: { teamId: inv.team_id, userId, role: inv.role, invitationId },
          },
          ctx,
          tx,
        );
        return { expired: false as const, view: toMyInvitationView(row) };
      }, TX_OPTIONS);
    } catch (err) {
      // Accepting two teams concurrently: the one-active-membership index decides.
      rethrowMapped(err, {
        [DB_CONSTRAINTS.membershipOneActivePerUser]: alreadyInTeam,
        [DB_CONSTRAINTS.membershipInvitationUnique]: invitationNotPending,
      });
    }
    // The EXPIRED transition is committed before answering (mandatory inside accept, §6.4).
    if (result.expired) throw invitationExpired();
    return result.view;
  }

  async decline(
    userId: string,
    invitationId: string,
    ctx: AuditRequestContext,
  ): Promise<MyInvitationDto> {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const inv = await this.lockOwnInvitation(tx, userId, invitationId);
      if (inv.status !== 'PENDING') throw invitationNotPending();
      const now = new Date();
      if (inv.expires_at.getTime() <= now.getTime()) {
        await expireStaleInvitations(tx, this.audit, ctx, { invitationId }, userId, now);
        return { expired: true as const };
      }
      const row = await tx.teamInvitation.update({
        where: { id: invitationId },
        data: { status: 'DECLINED', respondedAt: now },
        select: myInvitationSelect,
      });
      await this.audit.write(
        {
          action: 'team_invitation.decline',
          actorUserId: userId,
          resourceType: 'team_invitation',
          resourceId: invitationId,
          detail: { teamId: inv.team_id, role: inv.role },
        },
        ctx,
        tx,
      );
      return { expired: false as const, view: toMyInvitationView(row) };
    }, TX_OPTIONS);
    if (result.expired) throw invitationExpired();
    return result.view;
  }
}
