import { Injectable, UnauthorizedException } from '@nestjs/common';
import { type Prisma } from '@rage/db';
import { type AuditRequestContext, AuditService } from '../audit/audit.service.js';
import { iso } from '../common/http/dto.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import type { MeDto, UpdateMyProfileDto } from './me.dto.js';

const meSelect = {
  id: true,
  steamId64: true,
  status: true,
  createdAt: true,
  lastLoginAt: true,
  playerProfile: { select: { slug: true, nickname: true, countryCode: true, biography: true } },
  steamProfile: { select: { steamDisplayName: true, avatarUrl: true, profileUrl: true } },
  roleGrants: {
    where: { revokedAt: null },
    select: { id: true, role: true, scopeType: true, scopeId: true, issuedAt: true },
    orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.UserSelect;

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(userId: string): Promise<MeDto> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: meSelect,
    });
    // A session always belongs to a user with a profile (created at first login).
    if (!user?.playerProfile) throw new UnauthorizedException('Authentication required');
    return {
      user: {
        id: user.id,
        steamId64: user.steamId64,
        status: user.status,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: iso(user.lastLoginAt),
      },
      profile: user.playerProfile,
      steamProfile: user.steamProfile
        ? {
            displayName: user.steamProfile.steamDisplayName,
            avatarUrl: user.steamProfile.avatarUrl,
            profileUrl: user.steamProfile.profileUrl,
          }
        : null,
      roles: user.roleGrants.map((g) => ({
        id: g.id,
        role: g.role,
        scopeType: g.scopeType,
        scopeId: g.scopeId,
        issuedAt: g.issuedAt.toISOString(),
      })),
    };
  }

  async updateProfile(
    userId: string,
    dto: UpdateMyProfileDto,
    ctx: AuditRequestContext,
  ): Promise<MeDto> {
    const data: Prisma.PlayerProfileUpdateInput = {};
    if (dto.nickname !== undefined) data.nickname = dto.nickname;
    if (dto.countryCode !== undefined) data.countryCode = dto.countryCode;
    if (dto.biography !== undefined) data.biography = dto.biography;
    const fields = Object.keys(data);
    if (fields.length > 0) {
      await this.prisma.client.$transaction(async (tx) => {
        const res = await tx.playerProfile.updateMany({ where: { userId }, data });
        if (res.count !== 1) throw new UnauthorizedException('Authentication required');
        await this.audit.write(
          {
            action: 'profile.update',
            actorUserId: userId,
            resourceType: 'player_profile',
            resourceId: userId,
            detail: { fields },
          },
          ctx,
          tx,
        );
      });
    }
    return this.get(userId);
  }
}
