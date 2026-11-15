import { Injectable } from '@nestjs/common';
import { DB_CONSTRAINTS, isUniqueViolation, type MatchFormat, type Prisma } from '@rage/db';
import { type AuditRequestContext, AuditService } from '../audit/audit.service.js';
import { iso } from '../common/http/dto.js';
import { escapeLike } from '../common/http/search.js';
import { type Page, pageOf, toSkipTake } from '../common/pagination/pagination.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { lockMatch, transitionMatch } from '../matches/transitions.js';
import { fieldError, forbiddenRole, rethrowMapped } from '../team-domain/team-errors.js';
import { pickFreeSlug } from '../team-domain/team-policy.js';
import {
  lockTournament,
  M3_TX_OPTIONS,
  requireGlobalTournamentAdmin,
  requireTournamentAdmin,
  tournamentAdminScope,
} from '../tournament-domain/tournament-access.js';
import {
  formatNotSupported,
  invalidStateTransition,
  TOURNAMENT_IDENTITY_CONSTRAINTS,
  tournamentFull,
  tournamentNameTaken,
  tournamentNotFound,
} from '../tournament-domain/tournament-errors.js';
import {
  canChangeTournamentStatus,
  EDITABLE_TOURNAMENT_STATUSES,
  readSettings,
  RESERVED_TOURNAMENT_SLUGS,
  SUPPORTED_BRACKET_FORMATS,
  tournamentSlugBase,
  writeSettings,
} from '../tournament-domain/tournament-policy.js';
import type {
  AdminTournamentDto,
  AdminTournamentsQueryDto,
  CreateTournamentDto,
  TournamentStatusChangeDto,
  UpdateTournamentDto,
} from './tournament-admin.dto.js';

type Tx = Prisma.TransactionClient;

const SLUG_RACE_RETRIES = 3;

export const adminTournamentSelect = {
  id: true,
  slug: true,
  name: true,
  format: true,
  status: true,
  isSample: true,
  defaultMatchFormat: true,
  maxTeams: true,
  registrationOpenAt: true,
  registrationCloseAt: true,
  startsAt: true,
  settingsJson: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { stages: true } },
} satisfies Prisma.TournamentSelect;

type AdminTournamentRow = Prisma.TournamentGetPayload<{ select: typeof adminTournamentSelect }>;

const isSupportedFormat = (f: string) =>
  (SUPPORTED_BRACKET_FORMATS as readonly string[]).includes(f);

function parseDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(value);
}

function assertWindow(open: Date | null, close: Date | null): void {
  if (open && close && close.getTime() <= open.getTime()) {
    throw fieldError('registrationCloseAt', 'registrationCloseAt must be after registrationOpenAt');
  }
}

/**
 * Tournament administration (docs/TOURNAMENTS.md §3): create / edit / status changes / lists.
 * Authority is re-checked inside each transaction after the tournament lock (§2).
 */
@Injectable()
export class TournamentAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actorUserId: string,
    query: AdminTournamentsQueryDto,
  ): Promise<Page<AdminTournamentDto>> {
    const db = this.prisma.client;
    const scope = await tournamentAdminScope(db, actorUserId);
    if (!scope.all && scope.tournamentIds.length === 0) throw forbiddenRole();
    const where: Prisma.TournamentWhereInput = {
      ...(scope.all ? {} : { id: { in: scope.tournamentIds } }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { name: { contains: escapeLike(query.q), mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      db.tournament.findMany({
        where,
        select: adminTournamentSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...toSkipTake(query),
      }),
      db.tournament.count({ where }),
    ]);
    return pageOf(await this.toDtos(rows), total, query);
  }

  async get(actorUserId: string, tournamentId: string): Promise<AdminTournamentDto> {
    const db = this.prisma.client;
    const row = await db.tournament.findUnique({
      where: { id: tournamentId },
      select: adminTournamentSelect,
    });
    if (!row) throw tournamentNotFound();
    const scope = await tournamentAdminScope(db, actorUserId);
    if (!scope.all && !scope.tournamentIds.includes(tournamentId)) {
      if (row.status === 'DRAFT') throw tournamentNotFound();
      throw forbiddenRole();
    }
    return (await this.toDtos([row]))[0]!;
  }

  async create(
    actorUserId: string,
    dto: CreateTournamentDto,
    ctx: AuditRequestContext,
  ): Promise<AdminTournamentDto> {
    if (!isSupportedFormat(dto.format)) throw formatNotSupported();
    const open = parseDate(dto.registrationOpenAt) ?? null;
    const close = parseDate(dto.registrationCloseAt) ?? null;
    assertWindow(open, close);
    for (let attempt = 1; ; attempt++) {
      try {
        const id = await this.prisma.client.$transaction(async (tx) => {
          await requireGlobalTournamentAdmin(tx, actorUserId);
          await this.assertNameFree(tx, dto.name, null);
          const slug = await this.chooseSlug(tx, tournamentSlugBase(dto.name));
          const created = await tx.tournament.create({
            data: {
              slug,
              name: dto.name,
              format: dto.format,
              status: 'DRAFT',
              defaultMatchFormat: dto.defaultMatchFormat,
              maxTeams: dto.maxTeams,
              registrationOpenAt: open,
              registrationCloseAt: close,
              startsAt: parseDate(dto.startsAt) ?? null,
              settingsJson: writeSettings(
                {},
                {
                  description: dto.description ?? null,
                  mapPool: dto.mapPool,
                  finalMatchFormat: (dto.finalMatchFormat ?? null) as MatchFormat | null,
                },
              ),
              createdById: actorUserId,
            },
            select: { id: true, slug: true },
          });
          await this.audit.write(
            {
              action: 'tournament.create',
              actorUserId,
              resourceType: 'tournament',
              resourceId: created.id,
              detail: {
                name: dto.name,
                slug: created.slug,
                format: dto.format,
                defaultMatchFormat: dto.defaultMatchFormat,
                finalMatchFormat: dto.finalMatchFormat ?? null,
                maxTeams: dto.maxTeams,
                mapPool: dto.mapPool,
              },
            },
            ctx,
            tx,
          );
          return created.id;
        }, M3_TX_OPTIONS);
        return await this.get(actorUserId, id);
      } catch (err) {
        if (
          attempt < SLUG_RACE_RETRIES &&
          isUniqueViolation(err, DB_CONSTRAINTS.tournamentSlugUnique)
        ) {
          continue;
        }
        rethrowMapped(err, TOURNAMENT_IDENTITY_CONSTRAINTS);
      }
    }
  }

  async update(
    actorUserId: string,
    tournamentId: string,
    dto: UpdateTournamentDto,
    ctx: AuditRequestContext,
  ): Promise<AdminTournamentDto> {
    if (dto.format !== undefined && !isSupportedFormat(dto.format)) throw formatNotSupported();
    try {
      await this.prisma.client.$transaction(async (tx) => {
        const t = await lockTournament(tx, tournamentId, 'update');
        await requireTournamentAdmin(tx, actorUserId, t);
        if (!EDITABLE_TOURNAMENT_STATUSES.has(t.status)) {
          throw invalidStateTransition(`Settings cannot be edited while ${t.status}`);
        }
        const open =
          dto.registrationOpenAt === undefined
            ? t.registrationOpenAt
            : parseDate(dto.registrationOpenAt)!;
        const close =
          dto.registrationCloseAt === undefined
            ? t.registrationCloseAt
            : parseDate(dto.registrationCloseAt)!;
        assertWindow(open ?? null, close ?? null);
        if (dto.name !== undefined) await this.assertNameFree(tx, dto.name, tournamentId);
        if (dto.maxTeams !== undefined) {
          const approved = await tx.tournamentRegistration.count({
            where: { tournamentId, status: 'APPROVED' },
          });
          if (dto.maxTeams < approved) throw tournamentFull();
        }
        const settingsPatch: Parameters<typeof writeSettings>[1] = {};
        if (dto.description !== undefined) settingsPatch.description = dto.description ?? null;
        if (dto.mapPool !== undefined) settingsPatch.mapPool = dto.mapPool;
        if (dto.finalMatchFormat !== undefined) {
          settingsPatch.finalMatchFormat = (dto.finalMatchFormat ?? null) as MatchFormat | null;
        }
        const changed = Object.keys(dto).filter(
          (k) => (dto as Record<string, unknown>)[k] !== undefined,
        );
        await tx.tournament.update({
          where: { id: tournamentId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.format !== undefined ? { format: dto.format } : {}),
            ...(dto.defaultMatchFormat !== undefined
              ? { defaultMatchFormat: dto.defaultMatchFormat }
              : {}),
            ...(dto.maxTeams !== undefined ? { maxTeams: dto.maxTeams } : {}),
            ...(dto.registrationOpenAt !== undefined ? { registrationOpenAt: open } : {}),
            ...(dto.registrationCloseAt !== undefined ? { registrationCloseAt: close } : {}),
            ...(dto.startsAt !== undefined ? { startsAt: parseDate(dto.startsAt) ?? null } : {}),
            ...(Object.keys(settingsPatch).length > 0
              ? { settingsJson: writeSettings(t.settingsJson, settingsPatch) }
              : {}),
          },
        });
        await this.audit.write(
          {
            action: 'tournament.update',
            actorUserId,
            resourceType: 'tournament',
            resourceId: tournamentId,
            detail: { changed, patch: dto as unknown as Record<string, unknown> },
          },
          ctx,
          tx,
        );
      }, M3_TX_OPTIONS);
    } catch (err) {
      rethrowMapped(err, TOURNAMENT_IDENTITY_CONSTRAINTS);
    }
    return this.get(actorUserId, tournamentId);
  }

  /**
   * Manual lifecycle transitions (§3). Cancelling (reason required) cancels every non-completed
   * match of the tournament through the state machine (transition rows, version bump).
   */
  async changeStatus(
    actorUserId: string,
    tournamentId: string,
    dto: TournamentStatusChangeDto,
    ctx: AuditRequestContext,
  ): Promise<AdminTournamentDto> {
    if (dto.to === 'CANCELLED' && !dto.reason) {
      throw fieldError('reason', 'reason is required when cancelling a tournament');
    }
    await this.prisma.client.$transaction(async (tx) => {
      const t = await lockTournament(tx, tournamentId, 'update');
      await requireTournamentAdmin(tx, actorUserId, t);
      if (!canChangeTournamentStatus(t.status, dto.to)) {
        throw invalidStateTransition(`Tournament status ${t.status} → ${dto.to} is not allowed`);
      }
      if (dto.to === 'REGISTRATION_OPEN') {
        const settings = readSettings(t.settingsJson);
        if (settings.mapPool.length === 0 || t.maxTeams === null) {
          throw invalidStateTransition('Set the map pool and maxTeams before opening registration');
        }
      }
      let cancelledMatches = 0;
      if (dto.to === 'CANCELLED') {
        cancelledMatches = await this.cancelMatches(tx, tournamentId, actorUserId, dto.reason!);
      }
      await tx.tournament.update({ where: { id: tournamentId }, data: { status: dto.to } });
      await this.audit.write(
        {
          action: 'tournament.status_change',
          actorUserId,
          resourceType: 'tournament',
          resourceId: tournamentId,
          detail: {
            from: t.status,
            to: dto.to,
            reason: dto.reason ?? null,
            ...(dto.to === 'CANCELLED' ? { cancelledMatches } : {}),
          },
        },
        ctx,
        tx,
      );
    }, M3_TX_OPTIONS);
    return this.get(actorUserId, tournamentId);
  }

  private async cancelMatches(
    tx: Tx,
    tournamentId: string,
    actorUserId: string,
    reason: string,
  ): Promise<number> {
    const ids = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM matches
      WHERE tournament_id = ${tournamentId}::uuid AND status NOT IN ('COMPLETED', 'CANCELLED')
      ORDER BY id`;
    const now = new Date();
    for (const { id } of ids) {
      const m = await lockMatch(tx, id);
      if (!m || m.status === 'COMPLETED' || m.status === 'CANCELLED') continue;
      await transitionMatch(tx, m, 'CANCELLED', {
        source: 'ADMIN',
        actorUserId,
        reason,
        now,
        data: { statusReason: 'tournament_cancelled' },
      });
    }
    return ids.length;
  }

  private async assertNameFree(tx: Tx, name: string, excludeId: string | null): Promise<void> {
    const exclude = excludeId ?? '00000000-0000-0000-0000-000000000000';
    const rows = await tx.$queryRaw<{ clash: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM tournaments WHERE lower(name) = lower(${name})
                     AND id <> ${exclude}::uuid) AS clash`;
    if (rows[0]?.clash) throw tournamentNameTaken();
  }

  private async chooseSlug(tx: Tx, base: string): Promise<string> {
    const pattern = `${base}-%`;
    const rows = await tx.$queryRaw<{ slug: string }[]>`
      SELECT slug FROM tournaments WHERE slug = ${base} OR slug LIKE ${pattern}`;
    return pickFreeSlug(base, new Set(rows.map((r) => r.slug)), RESERVED_TOURNAMENT_SLUGS);
  }

  private async toDtos(rows: AdminTournamentRow[]): Promise<AdminTournamentDto[]> {
    if (rows.length === 0) return [];
    const counts = await this.prisma.client.tournamentRegistration.groupBy({
      by: ['tournamentId', 'status'],
      where: {
        tournamentId: { in: rows.map((r) => r.id) },
        status: { in: ['APPROVED', 'PENDING'] },
      },
      _count: { _all: true },
    });
    const countOf = (id: string, status: string) =>
      counts.find((c) => c.tournamentId === id && c.status === status)?._count._all ?? 0;
    return rows.map((r) => {
      const settings = readSettings(r.settingsJson);
      return {
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: settings.description,
        format: r.format,
        status: r.status,
        isSample: r.isSample,
        defaultMatchFormat: r.defaultMatchFormat,
        finalMatchFormat: settings.finalMatchFormat,
        maxTeams: r.maxTeams,
        registrationOpenAt: iso(r.registrationOpenAt),
        registrationCloseAt: iso(r.registrationCloseAt),
        startsAt: iso(r.startsAt),
        mapPool: settings.mapPool,
        approvedTeamCount: countOf(r.id, 'APPROVED'),
        pendingRegistrationCount: countOf(r.id, 'PENDING'),
        bracketGenerated: r._count.stages > 0,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }
}
