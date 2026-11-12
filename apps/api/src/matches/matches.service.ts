import { Injectable, NotFoundException } from '@nestjs/common';
import { type Prisma } from '@rage/db';
import { iso } from '../common/http/dto.js';
import {
  type Page,
  pageOf,
  type PaginationQueryDto,
  toSkipTake,
} from '../common/pagination/pagination.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { PUBLIC_TOURNAMENT_STATUSES } from '../tournaments/tournaments.dto.js';
import type {
  MatchDetailDto,
  MatchFormatValue,
  MatchStatusValue,
  MatchSummaryDto,
} from './matches.dto.js';

/** Matches of unpublished (DRAFT) tournaments are not public. */
const publicWhere = {
  OR: [{ tournamentId: null }, { tournament: { status: { in: [...PUBLIC_TOURNAMENT_STATUSES] } } }],
} satisfies Prisma.MatchWhereInput;

const teamRef = { select: { slug: true, name: true, tag: true } } as const;

const summarySelect = {
  id: true,
  status: true,
  format: true,
  scheduledAt: true,
  isSample: true,
  resultVerifiedAt: true,
  teamA: teamRef,
  teamB: teamRef,
  winnerTeam: { select: { slug: true } },
  tournament: { select: { slug: true, name: true } },
} satisfies Prisma.MatchSelect;

type SummaryRow = Prisma.MatchGetPayload<{ select: typeof summarySelect }>;

@Injectable()
export class MatchesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PaginationQueryDto): Promise<Page<MatchSummaryDto>> {
    const db = this.prisma.client;
    const [rows, total] = await db.$transaction([
      db.match.findMany({
        where: publicWhere,
        select: summarySelect,
        orderBy: [{ scheduledAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      db.match.count({ where: publicWhere }),
    ]);
    return pageOf(rows.map(toSummary), total, query);
  }

  async getById(id: string): Promise<MatchDetailDto> {
    const row = await this.prisma.client.match.findFirst({
      where: { AND: [publicWhere, { id }] },
      select: {
        ...summarySelect,
        maps: {
          orderBy: { mapOrder: 'asc' },
          select: {
            mapOrder: true,
            mapName: true,
            status: true,
            teamAScore: true,
            teamBScore: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Match not found');
    return {
      ...toSummary(row),
      maps: row.maps.map((m) => {
        // Scores default to 0 in the DB; never present an unplayed map as "0–0".
        const played = m.status !== 'PENDING' && m.status !== 'CANCELLED';
        return {
          mapOrder: m.mapOrder,
          mapName: m.mapName,
          status: m.status,
          teamAScore: played ? m.teamAScore : null,
          teamBScore: played ? m.teamBScore : null,
        };
      }),
    };
  }
}

function toSummary(row: SummaryRow): MatchSummaryDto {
  return {
    id: row.id,
    status: row.status as MatchStatusValue,
    format: row.format as MatchFormatValue,
    scheduledAt: iso(row.scheduledAt),
    teamA: row.teamA ?? null,
    teamB: row.teamB ?? null,
    tournament: row.tournament ?? null,
    // A winner is public only once the result has been verified (server-confirmed).
    winnerTeamSlug: row.resultVerifiedAt ? (row.winnerTeam?.slug ?? null) : null,
    isSample: row.isSample,
  };
}
