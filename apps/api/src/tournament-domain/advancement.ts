import { type Prisma } from '@rage/db';
import { type AuditRequestContext, type AuditService } from '../audit/audit.service.js';
import { lockMatch } from '../matches/transitions.js';

type Tx = Prisma.TransactionClient;

export interface AdvanceInput {
  tournamentId: string;
  tournamentStatus: string;
  match: { id: string; bracketSlotId: string | null };
  winnerTeamId: string;
  loserTeamId: string;
  actorUserId: string;
  now: Date;
}

export interface AdvanceOutcome {
  nextMatchId: string | null;
  tournamentCompleted: boolean;
}

/**
 * Advancement (docs/TOURNAMENTS.md §9), in the SAME transaction as the result. The caller
 * holds the tournament lock (FOR UPDATE) and the completed match lock; this locks the next
 * match (match → next match) and places the winner at `next_slot_position`. Completing the
 * final moves the tournament IN_PROGRESS → COMPLETED and records placements 1 and 2.
 * Never creates a result for the next match ("no phantom results"): it only fills a TBD slot.
 */
export async function advanceWinner(
  tx: Tx,
  audit: AuditService,
  ctx: AuditRequestContext,
  input: AdvanceInput,
): Promise<AdvanceOutcome> {
  if (!input.match.bracketSlotId) return { nextMatchId: null, tournamentCompleted: false };
  const slot = await tx.bracketSlot.findUniqueOrThrow({
    where: { id: input.match.bracketSlotId },
    select: { nextSlotId: true, nextSlotPosition: true },
  });

  if (!slot.nextSlotId || !slot.nextSlotPosition) {
    // The final: tournament completes, placements 1 and 2.
    if (input.tournamentStatus !== 'IN_PROGRESS') {
      throw new Error(`final completed while tournament is ${input.tournamentStatus}`);
    }
    await tx.tournament.update({
      where: { id: input.tournamentId },
      data: { status: 'COMPLETED', endsAt: input.now },
    });
    await tx.teamAchievement.createMany({
      data: [
        { teamId: input.winnerTeamId, tournamentId: input.tournamentId, placement: 1 },
        { teamId: input.loserTeamId, tournamentId: input.tournamentId, placement: 2 },
      ],
    });
    await audit.write(
      {
        action: 'tournament.status_change',
        actorUserId: input.actorUserId,
        resourceType: 'tournament',
        resourceId: input.tournamentId,
        detail: {
          from: 'IN_PROGRESS',
          to: 'COMPLETED',
          trigger: 'final_completed',
          finalMatchId: input.match.id,
          winnerTeamId: input.winnerTeamId,
          runnerUpTeamId: input.loserTeamId,
        },
      },
      ctx,
      tx,
    );
    return { nextMatchId: null, tournamentCompleted: true };
  }

  const nextRef = await tx.match.findUniqueOrThrow({
    where: { bracketSlotId: slot.nextSlotId },
    select: { id: true },
  });
  const next = await lockMatch(tx, nextRef.id);
  if (!next) throw new Error('next match vanished');
  if (next.status !== 'CREATED') {
    throw new Error(`next match ${next.id} is ${next.status}; cannot place a team`);
  }
  const position = slot.nextSlotPosition;
  const occupant = position === 'A' ? next.teamAId : next.teamBId;
  if (occupant !== null) {
    throw new Error(`next match ${next.id} position ${position} is already filled`);
  }
  await tx.match.update({
    where: { id: next.id },
    data: position === 'A' ? { teamAId: input.winnerTeamId } : { teamBId: input.winnerTeamId },
  });
  await audit.write(
    {
      action: 'match.advance',
      actorUserId: input.actorUserId,
      resourceType: 'match',
      resourceId: next.id,
      detail: {
        tournamentId: input.tournamentId,
        fromMatchId: input.match.id,
        teamId: input.winnerTeamId,
        position,
      },
    },
    ctx,
    tx,
  );
  return { nextMatchId: next.id, tournamentCompleted: false };
}
