import { ConflictException, Injectable } from '@nestjs/common';
import { API_ERROR_CODES, errorBodyWithDetails } from '../common/errors/api-error.js';
import { DB_CONSTRAINTS, type MatchStatus, type Prisma } from '@rage/db';
import { type AuditRequestContext, AuditService } from '../audit/audit.service.js';
import { uuidv7 } from '../common/idempotency/uuid7.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { initialTransition } from '../matches/transitions.js';
import { rethrowMapped } from '../team-domain/team-errors.js';
import {
  assignFinalSeeds,
  planBracket,
  validateSeedAssignment,
} from '../tournament-domain/bracket.js';
import { loadBracket } from '../tournament-domain/bracket-view.js';
import {
  lockTournament,
  M3_TX_OPTIONS,
  requireTournamentAdmin,
} from '../tournament-domain/tournament-access.js';
import {
  bracketExists,
  invalidStateTransition,
  notEnoughTeams,
  seedsInvalid,
} from '../tournament-domain/tournament-errors.js';
import { matchFormatFor, readSettings } from '../tournament-domain/tournament-policy.js';
import { SamplePolicy, sampleAuditTag } from '../tournament-domain/sample-policy.js';
import type { BracketDto } from '../tournaments/tournaments.dto.js';
import { registrationSelect } from '../tournament-domain/registration-view.js';
import { toAdminRegistrationDtos } from './registration-review.service.js';
import type { AdminRegistrationDto, SeedsDto } from './tournament-admin.dto.js';

type Tx = Prisma.TransactionClient;

/**
 * Seeding and single-elimination bracket generation (docs/TOURNAMENTS.md §6). Deterministic
 * (pure planner in tournament-domain/bracket.ts) and idempotent: the tournament row lock
 * serializes generation and a second call sees the stage → 409 BRACKET_EXISTS; the unique
 * `(tournament_id, sequence)` stage index is the backstop.
 */
@Injectable()
export class BracketAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly samples: SamplePolicy,
  ) {}

  async setSeeds(
    actorUserId: string,
    tournamentId: string,
    dto: SeedsDto,
    ctx: AuditRequestContext,
  ): Promise<AdminRegistrationDto[]> {
    try {
      await this.prisma.client.$transaction(async (tx) => {
        const t = await lockTournament(tx, tournamentId, 'update', this.samples);
        await requireTournamentAdmin(tx, actorUserId, t);
        if (t.status !== 'REGISTRATION_CLOSED') {
          throw invalidStateTransition('Seeds can only be set while registration is closed');
        }
        const approved = await tx.tournamentRegistration.findMany({
          where: { tournamentId, status: 'APPROVED' },
          select: { id: true },
        });
        const problem = validateSeedAssignment(
          approved.map((r) => r.id),
          dto.seeds,
        );
        if (problem) throw seedsInvalid(problem);
        // The seed unique index is not deferrable: clear first, then assign (SCHEMA.md notes).
        await tx.tournamentRegistration.updateMany({
          where: { tournamentId, status: 'APPROVED' },
          data: { seed: null },
        });
        for (const s of dto.seeds) {
          await tx.tournamentRegistration.update({
            where: { id: s.registrationId },
            data: { seed: s.seed },
          });
        }
        await this.audit.write(
          {
            action: 'tournament.seeds',
            actorUserId,
            resourceType: 'tournament',
            resourceId: tournamentId,
            detail: {
              ...sampleAuditTag(t.isSample),
              seeds: [...dto.seeds]
                .sort((a, b) => a.seed - b.seed)
                .map((s) => ({ registrationId: s.registrationId, seed: s.seed })),
            },
          },
          ctx,
          tx,
        );
      }, M3_TX_OPTIONS);
    } catch (err) {
      rethrowMapped(err, {
        [DB_CONSTRAINTS.registrationApprovedSeedUnique]: () => seedsInvalid('seeds must be unique'),
      });
    }
    const rows = await this.prisma.client.tournamentRegistration.findMany({
      where: { tournamentId, status: 'APPROVED' },
      select: registrationSelect,
      orderBy: [{ seed: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    });
    return toAdminRegistrationDtos(this.prisma.client, rows);
  }

  async generate(
    actorUserId: string,
    tournamentId: string,
    ctx: AuditRequestContext,
  ): Promise<BracketDto> {
    let format = 'SINGLE_ELIMINATION';
    try {
      await this.prisma.client.$transaction(async (tx) => {
        const t = await lockTournament(tx, tournamentId, 'update', this.samples);
        await requireTournamentAdmin(tx, actorUserId, t);
        format = t.format;
        const existing = await tx.tournamentStage.count({ where: { tournamentId } });
        if (existing > 0) throw bracketExists();
        if (t.status !== 'REGISTRATION_CLOSED') {
          throw invalidStateTransition('The bracket is generated once registration is closed');
        }
        const regs = await tx.tournamentRegistration.findMany({
          where: { tournamentId, status: 'APPROVED' },
          select: {
            id: true,
            teamId: true,
            seed: true,
            reviewedAt: true,
            team: { select: { status: true } },
          },
        });
        if (regs.length < 2) throw notEnoughTeams();
        // Gate I-5: a team disbanded/deactivated after approval cannot be bracketed; the
        // registration must be withdrawn first (by an operator — incl. SUPER_ADMIN override).
        const inactive = regs.filter((r) => r.team.status !== 'ACTIVE');
        if (inactive.length > 0) {
          throw new ConflictException(
            errorBodyWithDetails(
              'Approved registrations of inactive teams must be withdrawn first',
              API_ERROR_CODES.teamNotActive,
              inactive.map((r) => ({ field: r.id, message: 'TEAM_NOT_ACTIVE' })),
            ),
          );
        }
        const seeded = assignFinalSeeds(regs.map((r) => ({ ...r, approvedAt: r.reviewedAt })));
        await tx.tournamentRegistration.updateMany({
          where: { tournamentId, status: 'APPROVED' },
          data: { seed: null },
        });
        for (const r of seeded) {
          await tx.tournamentRegistration.update({
            where: { id: r.id },
            data: { seed: r.finalSeed },
          });
        }
        const teamBySeed = new Map(seeded.map((r) => [r.finalSeed, r.teamId]));
        const result = await this.createBracket(tx, {
          tournamentId,
          actorUserId,
          format: t.format,
          defaultMatchFormat: t.defaultMatchFormat,
          settingsJson: t.settingsJson,
          isSample: t.isSample,
          teamBySeed,
        });
        await tx.tournament.update({
          where: { id: tournamentId },
          data: { status: 'IN_PROGRESS' },
        });
        await this.audit.write(
          {
            action: 'bracket.generate',
            actorUserId,
            resourceType: 'tournament',
            resourceId: tournamentId,
            detail: {
              stageId: result.stageId,
              bracketId: result.bracketId,
              generationVersion: 1,
              teamCount: seeded.length,
              size: result.size,
              byes: result.byes,
              ...sampleAuditTag(t.isSample),
              seeds: seeded.map((r) => ({
                registrationId: r.id,
                teamId: r.teamId,
                seed: r.finalSeed,
              })),
            },
          },
          ctx,
          tx,
        );
        await this.audit.write(
          {
            action: 'tournament.status_change',
            actorUserId,
            resourceType: 'tournament',
            resourceId: tournamentId,
            detail: {
              from: 'REGISTRATION_CLOSED',
              to: 'IN_PROGRESS',
              trigger: 'generate_bracket',
              ...sampleAuditTag(t.isSample),
            },
          },
          ctx,
          tx,
        );
      }, M3_TX_OPTIONS);
    } catch (err) {
      rethrowMapped(err, {
        [DB_CONSTRAINTS.stageSequenceUnique]: bracketExists,
        [DB_CONSTRAINTS.bracketGenerationUnique]: bracketExists,
      });
    }
    const bracket = await loadBracket(this.prisma.client, tournamentId, format);
    if (!bracket) throw new Error('bracket missing after generation');
    return bracket;
  }

  /**
   * Stage (sequence 1) + bracket (generation 1) + every slot with next links + one match per
   * slot. Round 1 gets both teams (A = better seed); a bye slot's match is CANCELLED with
   * status_reason 'bye' and its team is placed directly into the next match.
   */
  private async createBracket(
    tx: Tx,
    input: {
      tournamentId: string;
      actorUserId: string;
      format: Prisma.TournamentGetPayload<object>['format'];
      defaultMatchFormat: Prisma.TournamentGetPayload<object>['defaultMatchFormat'];
      settingsJson: unknown;
      /** Matches of a sample tournament are sample data too (dev-only demo mode). */
      isSample: boolean;
      teamBySeed: Map<number, string>;
    },
  ): Promise<{ stageId: string; bracketId: string; size: number; byes: number }> {
    const plan = planBracket(input.teamBySeed.size);
    const settings = readSettings(input.settingsJson);
    const now = new Date();
    const stage = await tx.tournamentStage.create({
      data: {
        tournamentId: input.tournamentId,
        name: 'Main bracket',
        format: input.format,
        sequence: 1,
        createdAt: now,
      },
      select: { id: true },
    });
    const bracket = await tx.bracket.create({
      data: { stageId: stage.id, generationVersion: 1, createdAt: now },
      select: { id: true },
    });

    const key = (r: number, s: number) => `${r}:${s}`;
    const slotIds = new Map(plan.slots.map((s) => [key(s.roundNumber, s.slotNumber), uuidv7()]));
    // Final first so every next_slot_id already exists (single INSERT, but keep it obvious).
    const slotRows = [...plan.slots]
      .sort((a, b) => b.roundNumber - a.roundNumber || a.slotNumber - b.slotNumber)
      .map((s) => ({
        id: slotIds.get(key(s.roundNumber, s.slotNumber))!,
        bracketId: bracket.id,
        roundNumber: s.roundNumber,
        slotNumber: s.slotNumber,
        nextSlotId: s.next ? slotIds.get(key(s.next.roundNumber, s.next.slotNumber))! : null,
        nextSlotPosition: s.next ? s.next.position : null,
        createdAt: now,
      }));
    await tx.bracketSlot.createMany({ data: slotRows });

    interface MatchDraft {
      id: string;
      slotKey: string;
      teamAId: string | null;
      teamBId: string | null;
      status: MatchStatus;
      statusReason: string | null;
      format: Prisma.TournamentGetPayload<object>['defaultMatchFormat'];
    }
    const drafts = new Map<string, MatchDraft>();
    for (const s of plan.slots) {
      const k = key(s.roundNumber, s.slotNumber);
      drafts.set(k, {
        id: uuidv7(),
        slotKey: k,
        teamAId: null,
        teamBId: null,
        status: 'CREATED',
        statusReason: null,
        format: matchFormatFor(s.next === null, input.defaultMatchFormat, settings),
      });
    }
    let byes = 0;
    for (const p of plan.firstRound) {
      const d = drafts.get(key(1, p.slotNumber))!;
      d.teamAId = input.teamBySeed.get(p.seedA)!;
      d.teamBId = p.seedB === null ? null : input.teamBySeed.get(p.seedB)!;
      if (p.seedB === null) {
        byes += 1;
        d.status = 'CANCELLED';
        d.statusReason = 'bye';
        const slot = plan.slots.find((x) => x.roundNumber === 1 && x.slotNumber === p.slotNumber)!;
        const next = drafts.get(key(slot.next!.roundNumber, slot.next!.slotNumber))!;
        if (slot.next!.position === 'A') next.teamAId = d.teamAId;
        else next.teamBId = d.teamAId;
      }
    }
    const matches = [...drafts.values()];
    await tx.match.createMany({
      data: matches.map((m) => ({
        id: m.id,
        tournamentId: input.tournamentId,
        stageId: stage.id,
        bracketSlotId: slotIds.get(m.slotKey)!,
        teamAId: m.teamAId,
        teamBId: m.teamBId,
        format: m.format,
        status: m.status,
        statusReason: m.statusReason,
        isSample: input.isSample,
        createdAt: now,
      })),
    });
    await tx.matchStateTransition.createMany({
      data: matches.map((m) =>
        initialTransition(
          m.id,
          m.status as 'CREATED' | 'CANCELLED',
          m.statusReason === 'bye' ? 'bye' : 'bracket_generated',
          input.actorUserId,
          now,
        ),
      ),
    });
    return { stageId: stage.id, bracketId: bracket.id, size: plan.size, byes };
  }
}
