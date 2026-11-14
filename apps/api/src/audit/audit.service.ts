import { Injectable } from '@nestjs/common';
import { type Prisma } from '@rage/db';
import type { RequestWithIds } from '../common/http/request-id.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';

/** Audit action codes: M1 (docs/AUTH.md §10) and M2 (docs/TEAMS.md §9). */
export type AuditAction =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.login_rejected'
  | 'profile.update'
  | 'role_grant.create'
  | 'role_grant.revoke'
  | 'role_grant.bootstrap'
  | 'team_application.submit'
  | 'team_application.withdraw'
  | 'team_application.approve'
  | 'team_application.reject'
  | 'team.create'
  | 'team.captain_transfer'
  | 'team.disband'
  | 'team_invitation.create'
  | 'team_invitation.revoke'
  | 'team_invitation.accept'
  | 'team_invitation.decline'
  | 'team_invitation.expire'
  | 'team_membership.join'
  | 'team_membership.leave'
  | 'team_membership.remove';

export interface AuditEntry {
  action: AuditAction;
  actorUserId: string | null;
  resourceType: string;
  resourceId: string | null;
  /** Never put tokens, cookies, nonces or OpenID parameters here. */
  detail?: Record<string, unknown>;
}

/** Audit correlation derived from the request: server id only; client id kept as detail. */
export interface AuditRequestContext {
  serverRequestId: string | null;
  clientRequestId: string | undefined;
}

export function auditContextOf(req: RequestWithIds): AuditRequestContext {
  return {
    serverRequestId: req.serverRequestId ?? null,
    clientRequestId: req.clientRequestId,
  };
}

type Db = Prisma.TransactionClient | PrismaService['client'];

/** Append-only audit writer. Pass a transaction client to make the row atomic with a change. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async write(entry: AuditEntry, ctx: AuditRequestContext, db: Db = this.prisma.client) {
    const detail: Record<string, unknown> = { ...(entry.detail ?? {}) };
    if (ctx.clientRequestId) detail.clientRequestId = ctx.clientRequestId;
    await db.auditLog.create({
      data: {
        action: entry.action,
        actorUserId: entry.actorUserId,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        requestId: ctx.serverRequestId,
        detailJson: detail as Prisma.InputJsonObject,
      },
    });
  }
}
