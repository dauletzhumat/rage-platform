import { Injectable, NotFoundException } from '@nestjs/common';
import { type Prisma } from '@rage/db';
import { iso } from '../common/http/dto.js';
import { type Page, pageOf, toSkipTake } from '../common/pagination/pagination.js';
import { escapeLike } from '../common/http/search.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import {
  PUBLIC_TOURNAMENT_STATUSES,
  type TournamentDetailDto,
  type TournamentListQueryDto,
  type TournamentStatusValue,
  type TournamentSummaryDto,
} from './tournaments.dto.js';

const publicWhere = {
  status: { in: [...PUBLIC_TOURNAMENT_STATUSES] },
} satisfies Prisma.TournamentWhereInput;

const summarySelect = {
  id: true,
  slug: true,
  name: true,
  format: true,
  status: true,
  startsAt: true,
  registrationOpenAt: true,
  registrationCloseAt: true,
  isSample: true,
} satisfies Prisma.TournamentSelect;

type SummaryRow = Prisma.TournamentGetPayload<{ select: typeof summarySelect }>;

@Injectable()
export class TournamentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: TournamentListQueryDto): Promise<Page<TournamentSummaryDto>> {
    const where: Prisma.TournamentWhereInput = {
      ...publicWhere,
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { name: { contains: escapeLike(query.q), mode: 'insensitive' } } : {}),
    };
    const db = this.prisma.client;
    const [rows, total] = await db.$transaction([
      db.tournament.findMany({
        where,
        select: summarySelect,
        orderBy: [{ startsAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      db.tournament.count({ where }),
    ]);
    return pageOf(rows.map(toSummary), total, query);
  }

  async getBySlug(slug: string): Promise<TournamentDetailDto> {
    const row = await this.prisma.client.tournament.findFirst({
      where: { ...publicWhere, slug },
      select: {
        ...summarySelect,
        settingsJson: true,
        _count: { select: { registrations: { where: { status: 'APPROVED' } } } },
      },
    });
    if (!row) throw new NotFoundException('Tournament not found');
    return {
      ...toSummary(row),
      description: readDescription(row.settingsJson),
      registeredTeamCount: row._count.registrations,
    };
  }
}

function toSummary(row: SummaryRow): TournamentSummaryDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    format: String(row.format),
    status: row.status as TournamentStatusValue,
    startsAt: iso(row.startsAt),
    registrationOpenAt: iso(row.registrationOpenAt),
    registrationCloseAt: iso(row.registrationCloseAt),
    isSample: row.isSample,
  };
}

function readDescription(settings: unknown): string | null {
  if (settings && typeof settings === 'object' && 'description' in settings) {
    const d = (settings as { description: unknown }).description;
    return typeof d === 'string' ? d : null;
  }
  return null;
}
