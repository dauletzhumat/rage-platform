import { Injectable, NotFoundException } from '@nestjs/common';
import { type Prisma } from '@rage/db';
import {
  type Page,
  pageOf,
  type PaginationQueryDto,
  type SearchPaginationQueryDto,
  toSkipTake,
} from '../common/pagination/pagination.js';
import { escapeLike } from '../common/http/search.js';
import { iso } from '../common/http/dto.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { type M2MembershipRole, publicLeftReason } from '../team-domain/team-policy.js';
import type {
  MembershipRoleValue,
  RosterHistoryEntryDto,
  TeamDetailDto,
  TeamSummaryDto,
} from './teams.dto.js';

/** Only approved, active teams are public; applications never appear here (ADR-002). */
const publicWhere = { status: 'ACTIVE' } satisfies Prisma.TeamWhereInput;
/**
 * Current members whose accounts are publicly visible. Suspended/banned users are
 * hidden from public rosters and counts, consistent with /players (security LOW-2).
 */
const activeMembers = {
  leftAt: null,
  user: { status: 'ACTIVE' },
} satisfies Prisma.TeamMembershipWhereInput;

const summarySelect = {
  id: true,
  slug: true,
  name: true,
  tag: true,
  countryCode: true,
  region: true,
  isSample: true,
  _count: { select: { memberships: { where: activeMembers } } },
} satisfies Prisma.TeamSelect;

const detailSelect = {
  ...summarySelect,
  description: true,
  createdAt: true,
  memberships: {
    where: activeMembers,
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
    select: {
      userId: true,
      role: true,
      joinedAt: true,
      user: {
        select: {
          playerProfile: { select: { slug: true, nickname: true, countryCode: true } },
        },
      },
    },
  },
} satisfies Prisma.TeamSelect;

type SummaryRow = Prisma.TeamGetPayload<{ select: typeof summarySelect }>;
type DetailRow = Prisma.TeamGetPayload<{ select: typeof detailSelect }>;

const ROLE_ORDER: Record<MembershipRoleValue, number> = {
  CAPTAIN: 0,
  PLAYER: 1,
  SUBSTITUTE: 2,
  COACH: 3,
  MANAGER: 4,
};

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: SearchPaginationQueryDto): Promise<Page<TeamSummaryDto>> {
    const where: Prisma.TeamWhereInput = {
      ...publicWhere,
      ...(query.q
        ? {
            OR: [
              { name: { contains: escapeLike(query.q), mode: 'insensitive' } },
              { tag: { contains: escapeLike(query.q), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const db = this.prisma.client;
    const [rows, total] = await db.$transaction([
      db.team.findMany({
        where,
        select: summarySelect,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      db.team.count({ where }),
    ]);
    return pageOf(rows.map(toSummary), total, query);
  }

  async getBySlug(slug: string): Promise<TeamDetailDto> {
    const row = await this.prisma.client.team.findFirst({
      where: { ...publicWhere, slug },
      select: detailSelect,
    });
    if (!row) throw new NotFoundException('Team not found');
    return toDetail(row);
  }

  /** Detail for operators / mutation responses: any team status (sample flag included). */
  async getDetailById(id: string): Promise<TeamDetailDto> {
    const row = await this.prisma.client.team.findUnique({ where: { id }, select: detailSelect });
    if (!row) throw new NotFoundException('Team not found');
    return toDetail(row);
  }

  /**
   * Public roster history, newest first (`joined_at DESC, id DESC` — a captain transfer opens two
   * rows with the same `joined_at`, `id` is the deterministic tie-breaker). Only enumerated
   * `leftReason`s are exposed. Suspended/banned users are hidden like on the current roster.
   */
  async rosterHistory(
    slug: string,
    query: PaginationQueryDto,
  ): Promise<Page<RosterHistoryEntryDto>> {
    const team = await this.prisma.client.team.findFirst({
      where: { ...publicWhere, slug },
      select: { id: true },
    });
    if (!team) throw new NotFoundException('Team not found');
    const where: Prisma.TeamMembershipWhereInput = {
      teamId: team.id,
      user: { status: 'ACTIVE' },
    };
    const db = this.prisma.client;
    const [rows, total] = await db.$transaction([
      db.teamMembership.findMany({
        where,
        orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
        select: {
          role: true,
          joinedAt: true,
          leftAt: true,
          leftReason: true,
          user: { select: { playerProfile: { select: { slug: true, nickname: true } } } },
        },
        ...toSkipTake(query),
      }),
      db.teamMembership.count({ where }),
    ]);
    return pageOf(
      rows.map((m) => ({
        playerSlug: m.user.playerProfile?.slug ?? '',
        nickname: m.user.playerProfile?.nickname ?? '',
        role: m.role as M2MembershipRole,
        joinedAt: m.joinedAt.toISOString(),
        leftAt: iso(m.leftAt),
        leftReason: m.leftAt ? publicLeftReason(m.leftReason) : null,
      })),
      total,
      query,
    );
  }
}

function toDetail(row: DetailRow): TeamDetailDto {
  const roster = row.memberships
    .flatMap((m) => {
      const profile = m.user.playerProfile;
      if (!profile) return [];
      return [
        {
          userId: m.userId,
          playerSlug: profile.slug,
          nickname: profile.nickname,
          countryCode: profile.countryCode,
          role: m.role as MembershipRoleValue,
          joinedAt: m.joinedAt.toISOString(),
        },
      ];
    })
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);

  return {
    ...toSummary(row),
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    roster,
  };
}

function toSummary(row: SummaryRow): TeamSummaryDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tag: row.tag,
    countryCode: row.countryCode,
    region: row.region,
    logoUrl: null,
    isSample: row.isSample,
    activeMemberCount: row._count.memberships,
  };
}
