import { Injectable, NotFoundException } from '@nestjs/common';
import { type Prisma } from '@rage/db';
import { iso } from '../common/http/dto.js';
import { type Page, pageOf, toSkipTake } from '../common/pagination/pagination.js';
import { escapeLike } from '../common/http/search.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { loadBracket } from '../tournament-domain/bracket-view.js';
import { isRegistrationWindowOpen, readSettings } from '../tournament-domain/tournament-policy.js';
import {
  type BracketDto,
  PUBLIC_TOURNAMENT_STATUSES,
  type PublicTournamentTeamDto,
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
    const [rows, total] = await Promise.all([
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
        defaultMatchFormat: true,
        maxTeams: true,
        _count: { select: { registrations: { where: { status: 'APPROVED' } } } },
      },
    });
    if (!row) throw new NotFoundException('Tournament not found');
    const settings = readSettings(row.settingsJson);
    return {
      ...toSummary(row),
      description: settings.description,
      registeredTeamCount: row._count.registrations,
      approvedTeamCount: row._count.registrations,
      mapPool: settings.mapPool,
      defaultMatchFormat: row.defaultMatchFormat,
      finalMatchFormat: settings.finalMatchFormat,
      maxTeams: row.maxTeams,
      registrationOpen: isRegistrationWindowOpen(row, new Date()),
    };
  }

  /** APPROVED registrations with seed and current LOCKED roster; no SteamIDs (§10). */
  async teams(slug: string): Promise<PublicTournamentTeamDto[]> {
    const t = await this.findPublic(slug);
    const rows = await this.prisma.client.tournamentRegistration.findMany({
      where: { tournamentId: t.id, status: 'APPROVED' },
      orderBy: [{ seed: { sort: 'asc', nulls: 'last' } }, { reviewedAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        seed: true,
        team: { select: { id: true, slug: true, name: true, tag: true, isSample: true } },
        rosters: {
          where: { status: 'LOCKED' },
          orderBy: { version: 'desc' },
          take: 1,
          select: {
            version: true,
            lockedAt: true,
            entries: {
              orderBy: [{ role: 'asc' }, { nicknameSnapshot: 'asc' }, { id: 'asc' }],
              select: {
                nicknameSnapshot: true,
                role: true,
                user: { select: { playerProfile: { select: { slug: true } } } },
              },
            },
          },
        },
      },
    });
    return rows
      .filter((r) => r.rosters.length > 0)
      .map((r) => {
        const roster = r.rosters[0]!;
        return {
          registrationId: r.id,
          seed: r.seed,
          team: { id: r.team.id, slug: r.team.slug, name: r.team.name, tag: r.team.tag },
          isSample: r.team.isSample || t.isSample,
          roster: {
            version: roster.version,
            lockedAt: iso(roster.lockedAt),
            entries: roster.entries.map((e) => ({
              playerSlug: e.user.playerProfile?.slug ?? '',
              nicknameSnapshot: e.nicknameSnapshot,
              role: e.role,
            })),
          },
        };
      });
  }

  /** Bracket (§6); before generation → `rounds: []` (§15.4). */
  async bracket(slug: string): Promise<BracketDto> {
    const t = await this.findPublic(slug);
    const bracket = await loadBracket(this.prisma.client, t.id, String(t.format));
    return bracket ?? { format: String(t.format), size: 0, rounds: [] };
  }

  private async findPublic(slug: string) {
    const t = await this.prisma.client.tournament.findFirst({
      where: { ...publicWhere, slug },
      select: { id: true, format: true, isSample: true },
    });
    if (!t) throw new NotFoundException('Tournament not found');
    return t;
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
