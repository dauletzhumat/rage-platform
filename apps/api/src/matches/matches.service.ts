import { Injectable } from '@nestjs/common';
import {
  type Page,
  pageOf,
  type PaginationQueryDto,
  toSkipTake,
} from '../common/pagination/pagination.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { matchNotFound } from '../tournament-domain/tournament-errors.js';
import {
  matchDetailSelect,
  matchSummarySelect,
  publicMatchWhere,
  toMatchDetail,
  toMatchSummary,
} from './match-view.js';
import type { MatchDetailDto, MatchSummaryDto } from './matches.dto.js';

@Injectable()
export class MatchesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PaginationQueryDto): Promise<Page<MatchSummaryDto>> {
    const db = this.prisma.client;
    const [rows, total] = await db.$transaction([
      db.match.findMany({
        where: publicMatchWhere,
        select: matchSummarySelect,
        orderBy: [{ scheduledAt: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      db.match.count({ where: publicMatchWhere }),
    ]);
    return pageOf(rows.map(toMatchSummary), total, query);
  }

  async getById(id: string): Promise<MatchDetailDto> {
    const row = await this.prisma.client.match.findFirst({
      where: { AND: [publicMatchWhere, { id }] },
      select: matchDetailSelect,
    });
    if (!row) throw matchNotFound();
    return toMatchDetail(row);
  }
}
