import { Injectable, NotFoundException } from '@nestjs/common';
import { type Prisma } from '@rage/db';
import {
  type Page,
  pageOf,
  type SearchPaginationQueryDto,
  toSkipTake,
} from '../common/pagination/pagination.js';
import { escapeLike } from '../common/http/search.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import type { PlayerDetailDto, PlayerSummaryDto } from './players.dto.js';

const summarySelect = {
  id: true,
  slug: true,
  nickname: true,
  countryCode: true,
  user: {
    select: {
      steamId64: true,
      isSample: true,
      steamProfile: { select: { avatarUrl: true } },
    },
  },
} satisfies Prisma.PlayerProfileSelect;

type SummaryRow = Prisma.PlayerProfileGetPayload<{ select: typeof summarySelect }>;

/** Only active (non-suspended/non-deleted) accounts are public. */
const publicWhere = { user: { status: 'ACTIVE' } } satisfies Prisma.PlayerProfileWhereInput;

@Injectable()
export class PlayersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: SearchPaginationQueryDto): Promise<Page<PlayerSummaryDto>> {
    const where: Prisma.PlayerProfileWhereInput = {
      ...publicWhere,
      ...(query.q ? { nickname: { contains: escapeLike(query.q), mode: 'insensitive' } } : {}),
    };
    const db = this.prisma.client;
    const [rows, total] = await db.$transaction([
      db.playerProfile.findMany({
        where,
        select: summarySelect,
        orderBy: [{ nickname: 'asc' }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      db.playerProfile.count({ where }),
    ]);
    return pageOf(rows.map(toSummary), total, query);
  }

  async getBySlug(slug: string): Promise<PlayerDetailDto> {
    const row = await this.prisma.client.playerProfile.findFirst({
      where: { ...publicWhere, slug },
      select: {
        ...summarySelect,
        biography: true,
        createdAt: true,
        user: {
          select: {
            ...summarySelect.user.select,
            memberships: {
              where: { leftAt: null, team: { status: 'ACTIVE' } },
              select: { team: { select: { slug: true, name: true, tag: true } } },
              take: 1,
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Player not found');
    return {
      ...toSummary(row),
      biography: row.biography,
      createdAt: row.createdAt.toISOString(),
      currentTeam: row.user.memberships[0]?.team ?? null,
    };
  }
}

function toSummary(row: SummaryRow): PlayerSummaryDto {
  return {
    id: row.id,
    slug: row.slug,
    nickname: row.nickname,
    countryCode: row.countryCode,
    avatarUrl: row.user.steamProfile?.avatarUrl ?? null,
    steamId64: row.user.steamId64,
    isSample: row.user.isSample,
  };
}
