import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DB_CONSTRAINTS,
  isUniqueViolation,
  type Prisma,
  type RoleScopeType,
  type RoleType,
} from '@rage/db';
import { type AuditRequestContext, AuditService } from '../audit/audit.service.js';
import { API_ERROR_CODES, errorBody } from '../common/errors/api-error.js';
import { iso } from '../common/http/dto.js';
import { escapeLike } from '../common/http/search.js';
import { type Page, pageOf, toSkipTake } from '../common/pagination/pagination.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import type {
  AdminUserDto,
  AdminUsersQueryDto,
  AuditLogDto,
  AuditQueryDto,
  GrantRoleDto,
  RoleGrantDto,
} from './admin.dto.js';

/** Which scopes each role may be granted on (M1; TEAM_MANAGER is used from M2). */
export const ROLE_SCOPES: Record<RoleType, readonly RoleScopeType[]> = {
  SUPER_ADMIN: ['GLOBAL'],
  TOURNAMENT_ADMIN: ['GLOBAL', 'TOURNAMENT'],
  MATCH_ADMIN: ['GLOBAL', 'TOURNAMENT'],
  OBSERVER: ['GLOBAL', 'TOURNAMENT', 'MATCH'],
  TEAM_MANAGER: ['TEAM'],
};

const grantSelect = {
  id: true,
  userId: true,
  role: true,
  scopeType: true,
  scopeId: true,
  issuedAt: true,
  issuedById: true,
  reason: true,
  revokedAt: true,
} satisfies Prisma.UserRoleGrantSelect;

type GrantRow = Prisma.UserRoleGrantGetPayload<{ select: typeof grantSelect }>;

export function toRoleGrantDto(g: GrantRow): RoleGrantDto {
  return {
    id: g.id,
    role: g.role,
    scopeType: g.scopeType,
    scopeId: g.scopeId,
    issuedAt: g.issuedAt.toISOString(),
    issuedById: g.issuedById,
    reason: g.reason,
    revokedAt: iso(g.revokedAt),
  };
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listUsers(query: AdminUsersQueryDto): Promise<Page<AdminUserDto>> {
    const q = query.q?.trim();
    let where: Prisma.UserWhereInput = {};
    if (q) {
      const byNickname: Prisma.UserWhereInput = {
        playerProfile: { nickname: { contains: escapeLike(q), mode: 'insensitive' } },
      };
      where = /^\d{17}$/.test(q) ? { OR: [byNickname, { steamId64: q }] } : byNickname;
    }
    const db = this.prisma.client;
    const [rows, total] = await db.$transaction([
      db.user.findMany({
        where,
        select: {
          id: true,
          steamId64: true,
          status: true,
          isSample: true,
          createdAt: true,
          lastLoginAt: true,
          playerProfile: { select: { nickname: true, slug: true } },
          // All grants (active and revoked), newest first.
          roleGrants: {
            select: grantSelect,
            orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(query),
      }),
      db.user.count({ where }),
    ]);
    return pageOf(
      rows.map((u) => ({
        id: u.id,
        steamId64: u.steamId64,
        status: u.status,
        isSample: u.isSample,
        nickname: u.playerProfile?.nickname ?? null,
        slug: u.playerProfile?.slug ?? null,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: iso(u.lastLoginAt),
        roles: u.roleGrants.map(toRoleGrantDto),
      })),
      total,
      query,
    );
  }

  async grantRole(
    actorUserId: string,
    targetUserId: string,
    dto: GrantRoleDto,
    ctx: AuditRequestContext,
  ): Promise<RoleGrantDto> {
    const scopeId = dto.scopeId ?? null;
    if (!ROLE_SCOPES[dto.role].includes(dto.scopeType)) {
      throw new BadRequestException(`Role ${dto.role} cannot be granted on scope ${dto.scopeType}`);
    }
    if ((dto.scopeType === 'GLOBAL') !== (scopeId === null)) {
      throw new BadRequestException(
        'scopeId is required for scoped roles and forbidden for GLOBAL',
      );
    }
    try {
      return await this.prisma.client.$transaction(async (tx) => {
        // Re-check the actor's authority at commit time under a lock that conflicts with the
        // FOR UPDATE taken by revokeRole: a SUPER_ADMIN being revoked concurrently cannot
        // finish a grant (security gate M1, finding L-2).
        const actorGrant = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM user_role_grants
          WHERE user_id = ${actorUserId}::uuid AND role = 'SUPER_ADMIN'
            AND scope_type = 'GLOBAL' AND revoked_at IS NULL
          FOR SHARE`;
        if (actorGrant.length === 0) {
          throw new ForbiddenException(
            errorBody('Insufficient permissions', API_ERROR_CODES.forbiddenRole),
          );
        }
        const target = await tx.user.findUnique({
          where: { id: targetUserId },
          select: { id: true, isSample: true },
        });
        if (!target) throw new NotFoundException('User not found');
        if (target.isSample) throw new ConflictException('Sample users cannot receive roles');
        await assertScopeExists(tx, dto.scopeType, scopeId);
        const grant = await tx.userRoleGrant.create({
          data: {
            userId: target.id,
            role: dto.role,
            scopeType: dto.scopeType,
            scopeId,
            issuedById: actorUserId,
            reason: dto.reason,
          },
          select: grantSelect,
        });
        await this.audit.write(
          {
            action: 'role_grant.create',
            actorUserId,
            resourceType: 'user_role_grant',
            resourceId: grant.id,
            detail: {
              targetUserId: target.id,
              role: grant.role,
              scopeType: grant.scopeType,
              scopeId: grant.scopeId,
              reason: dto.reason,
            },
          },
          ctx,
          tx,
        );
        return toRoleGrantDto(grant);
      });
    } catch (err) {
      // The partial unique index (user, role, scope) WHERE revoked_at IS NULL decides races.
      if (isUniqueViolation(err, DB_CONSTRAINTS.roleGrantActiveUnique) || isUniqueViolation(err)) {
        throw new ConflictException(
          errorBody(
            'An active grant of this role and scope already exists',
            API_ERROR_CODES.roleAlreadyGranted,
          ),
        );
      }
      throw err;
    }
  }

  async revokeRole(
    actorUserId: string,
    targetUserId: string,
    grantId: string,
    reason: string,
    ctx: AuditRequestContext,
  ): Promise<RoleGrantDto> {
    return this.prisma.client.$transaction(async (tx) => {
      // Serialize concurrent SUPER_ADMIN changes: lock every active SUPER_ADMIN grant so two
      // admins revoking each other cannot leave the platform without a super admin.
      const activeSuperAdmins = await tx.$queryRaw<{ id: string; user_id: string }[]>`
        SELECT id, user_id FROM user_role_grants
        WHERE role = 'SUPER_ADMIN' AND scope_type = 'GLOBAL' AND revoked_at IS NULL
        FOR UPDATE`;
      if (!activeSuperAdmins.some((g) => g.user_id === actorUserId)) {
        throw new ForbiddenException(
          errorBody('Insufficient permissions', API_ERROR_CODES.forbiddenRole),
        );
      }
      const grant = await tx.userRoleGrant.findFirst({
        where: { id: grantId, userId: targetUserId },
        select: grantSelect,
      });
      if (!grant) throw new NotFoundException('Role grant not found');
      if (grant.revokedAt) throw new ConflictException('Role grant is already revoked');
      if (grant.role === 'SUPER_ADMIN' && grant.scopeType === 'GLOBAL') {
        if (grant.userId === actorUserId) {
          throw new ConflictException(
            errorBody(
              'You cannot revoke your own SUPER_ADMIN grant',
              API_ERROR_CODES.lastSuperAdmin,
            ),
          );
        }
        if (activeSuperAdmins.length <= 1) {
          throw new ConflictException(
            errorBody('Cannot revoke the last SUPER_ADMIN grant', API_ERROR_CODES.lastSuperAdmin),
          );
        }
      }
      const now = new Date();
      const updated = await tx.userRoleGrant.update({
        where: { id: grant.id },
        data: { revokedAt: now, revokedById: actorUserId },
        select: grantSelect,
      });
      await this.audit.write(
        {
          action: 'role_grant.revoke',
          actorUserId,
          resourceType: 'user_role_grant',
          resourceId: grant.id,
          detail: {
            targetUserId,
            role: grant.role,
            scopeType: grant.scopeType,
            scopeId: grant.scopeId,
            reason,
          },
        },
        ctx,
        tx,
      );
      return toRoleGrantDto(updated);
    });
  }

  async listAudit(query: AuditQueryDto): Promise<Page<AuditLogDto>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    };
    const db = this.prisma.client;
    const [rows, total] = await db.$transaction([
      db.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(query),
      }),
      db.auditLog.count({ where }),
    ]);
    return pageOf(
      rows.map((r) => ({
        id: r.id,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        actorUserId: r.actorUserId,
        requestId: r.requestId,
        detail:
          r.detailJson && typeof r.detailJson === 'object' && !Array.isArray(r.detailJson)
            ? (r.detailJson as Record<string, unknown>)
            : {},
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      query,
    );
  }
}

async function assertScopeExists(
  tx: Prisma.TransactionClient,
  scopeType: RoleScopeType,
  scopeId: string | null,
): Promise<void> {
  if (scopeType === 'GLOBAL' || scopeId === null) return;
  const where = { where: { id: scopeId }, select: { id: true } } as const;
  const found =
    scopeType === 'TEAM'
      ? await tx.team.findUnique(where)
      : scopeType === 'TOURNAMENT'
        ? await tx.tournament.findUnique(where)
        : await tx.match.findUnique(where);
  if (!found) throw new NotFoundException(`${scopeType.toLowerCase()} not found`);
}
