import { type Prisma } from '@rage/db';
import { matchSummarySelect, toMatchSummary } from '../matches/match-view.js';
import type { BracketDto, BracketRoundDto } from '../tournaments/tournaments.dto.js';
import { roundName } from './bracket.js';

type Db = Prisma.TransactionClient;

/** Reads the current bracket (stage 1, latest generation) of a tournament, or null. */
export async function loadBracket(
  db: Db,
  tournamentId: string,
  format: string,
): Promise<BracketDto | null> {
  const bracket = await db.bracket.findFirst({
    where: { stage: { tournamentId, sequence: 1 } },
    orderBy: { generationVersion: 'desc' },
    select: { id: true },
  });
  if (!bracket) return null;
  const [slots, seeds] = await Promise.all([
    db.bracketSlot.findMany({
      where: { bracketId: bracket.id },
      orderBy: [{ roundNumber: 'asc' }, { slotNumber: 'asc' }],
      select: {
        id: true,
        roundNumber: true,
        slotNumber: true,
        nextSlotId: true,
        match: { select: matchSummarySelect },
      },
    }),
    db.tournamentRegistration.findMany({
      where: { tournamentId, status: 'APPROVED', seed: { not: null } },
      select: { teamId: true, seed: true },
    }),
  ]);
  const seedOf = new Map(seeds.map((s) => [s.teamId, s.seed]));
  const matchIdOfSlot = new Map(slots.map((s) => [s.id, s.match?.id ?? null]));
  const size = slots.length + 1;
  const rounds = Math.round(Math.log2(size));
  const byRound = new Map<number, BracketRoundDto>();
  for (const slot of slots) {
    if (!slot.match) continue;
    let round = byRound.get(slot.roundNumber);
    if (!round) {
      round = {
        roundNumber: slot.roundNumber,
        name: roundName(slot.roundNumber, rounds),
        matches: [],
      };
      byRound.set(slot.roundNumber, round);
    }
    const m = slot.match;
    round.matches.push({
      ...toMatchSummary(m),
      slotNumber: slot.slotNumber,
      teamASeed: m.teamA ? (seedOf.get(m.teamA.id) ?? null) : null,
      teamBSeed: m.teamB ? (seedOf.get(m.teamB.id) ?? null) : null,
      isBye: m.status === 'CANCELLED' && m.statusReason === 'bye',
      nextMatchId: slot.nextSlotId ? (matchIdOfSlot.get(slot.nextSlotId) ?? null) : null,
    });
  }
  return {
    format,
    size,
    rounds: [...byRound.values()].sort((a, b) => a.roundNumber - b.roundNumber),
  };
}
