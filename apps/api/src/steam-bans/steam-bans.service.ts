import { Injectable, NotFoundException } from '@nestjs/common';
import { DB_CONSTRAINTS, type Prisma } from '@rage/db';
import { type AuditRequestContext, AuditService } from '../audit/audit.service.js';
import { iso } from '../common/http/dto.js';
import { type Page, pageOf, toSkipTake } from '../common/pagination/pagination.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { assertSuperAdminLocked } from '../team-domain/team-access.js';
import { rethrowMapped } from '../team-domain/team-errors.js';
import { M3_TX_OPTIONS } from '../tournament-domain/tournament-access.js';
import {
  invalidStateTransition,
  steamIdAlreadyBanned,
} from '../tournament-domain/tournament-errors.js';
import type { BannedSteamIdDto, CreateSteamBanDto, SteamBansQueryDto } from './steam-bans.dto.js';

const actor = { select: { id: true, playerProfile: { select: { nickname: true } } } } as const;
const banSelect = {
  id: true,
  steamId64: true,
  reason: true,
  createdAt: true,
  liftedAt: true,
  liftReason: true,
  createdBy: actor,
  liftedBy: actor,
} satisfies Prisma.BannedSteamIdSelect;
type BanRow = Prisma.BannedSteamIdGetPayload<{ select: typeof banSelect }>;

/**
 * SteamID64 bans (docs/TOURNAMENTS.md §5), SUPER_ADMIN only. A ban blocks new registrations,
 * approvals and substitutions containing the SteamID; locked rosters are never rewritten.
 */
@Injectable()
export class SteamBansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: SteamBansQueryDto): Promise<Page<BannedSteamIdDto>> {
    const where: Prisma.BannedSteamIdWhereInput =
      query.active === undefined ? {} : { liftedAt: query.active ? null : { not: null } };
    const db = this.prisma.client;
    const [rows, total] = await db.$transaction([
      db.bannedSteamId.findMany({
        where,
        select: banSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(query),
      }),
      db.bannedSteamId.count({ where }),
    ]);
    return pageOf(await this.withUsers(rows), total, query);
  }

  async create(
    actorUserId: string,
    dto: CreateSteamBanDto,
    ctx: AuditRequestContext,
  ): Promise<BannedSteamIdDto> {
    try {
      const row = await this.prisma.client.$transaction(async (tx) => {
        await assertSuperAdminLocked(tx, actorUserId);
        const active = await tx.bannedSteamId.findFirst({
          where: { steamId64: dto.steamId64, liftedAt: null },
          select: { id: true },
        });
        if (active) throw steamIdAlreadyBanned();
        const created = await tx.bannedSteamId.create({
          data: { steamId64: dto.steamId64, reason: dto.reason, createdById: actorUserId },
          select: banSelect,
        });
        await this.audit.write(
          {
            action: 'steam_ban.create',
            actorUserId,
            resourceType: 'banned_steam_id',
            resourceId: created.id,
            detail: { steamId64: dto.steamId64, reason: dto.reason },
          },
          ctx,
          tx,
        );
        return created;
      }, M3_TX_OPTIONS);
      return (await this.withUsers([row]))[0]!;
    } catch (err) {
      rethrowMapped(err, { [DB_CONSTRAINTS.steamBanOneActivePerSteamId]: steamIdAlreadyBanned });
    }
  }

  async lift(
    actorUserId: string,
    banId: string,
    reason: string,
    ctx: AuditRequestContext,
  ): Promise<BannedSteamIdDto> {
    const row = await this.prisma.client.$transaction(async (tx) => {
      await assertSuperAdminLocked(tx, actorUserId);
      const locked = await tx.$queryRaw<{ steam_id64: string; lifted_at: Date | null }[]>`
        SELECT steam_id64, lifted_at FROM banned_steam_ids WHERE id = ${banId}::uuid FOR UPDATE`;
      if (!locked[0]) throw new NotFoundException('Ban not found');
      if (locked[0].lifted_at) throw invalidStateTransition('This ban has already been lifted');
      const updated = await tx.bannedSteamId.update({
        where: { id: banId },
        // lifted_at / lifted_by / lift_reason are set together (banned_steam_ids_lifted_fields_chk).
        data: { liftedAt: new Date(), liftedById: actorUserId, liftReason: reason },
        select: banSelect,
      });
      await this.audit.write(
        {
          action: 'steam_ban.lift',
          actorUserId,
          resourceType: 'banned_steam_id',
          resourceId: banId,
          detail: { steamId64: locked[0].steam_id64, reason },
        },
        ctx,
        tx,
      );
      return updated;
    }, M3_TX_OPTIONS);
    return (await this.withUsers([row]))[0]!;
  }

  private async withUsers(rows: BanRow[]): Promise<BannedSteamIdDto[]> {
    const users = rows.length
      ? await this.prisma.client.user.findMany({
          where: { steamId64: { in: [...new Set(rows.map((r) => r.steamId64))] } },
          select: { id: true, steamId64: true },
        })
      : [];
    const bySteam = new Map(users.map((u) => [u.steamId64, u.id]));
    return rows.map((r) => ({
      id: r.id,
      steamId64: r.steamId64,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      createdBy: { id: r.createdBy.id, nickname: r.createdBy.playerProfile?.nickname ?? '' },
      liftedAt: iso(r.liftedAt),
      liftedBy: r.liftedBy
        ? { id: r.liftedBy.id, nickname: r.liftedBy.playerProfile?.nickname ?? '' }
        : null,
      liftReason: r.liftReason,
      active: r.liftedAt === null,
      userId: bySteam.get(r.steamId64) ?? null,
    }));
  }
}
