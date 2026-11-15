import { type MatchStatus, type Prisma } from '@rage/db';
import { assertTransition, type SeriesStatus, type TransitionSource } from './state-machine.js';

type Tx = Prisma.TransactionClient;

export interface LockedMatch {
  id: string;
  tournamentId: string | null;
  bracketSlotId: string | null;
  teamAId: string | null;
  teamBId: string | null;
  format: 'BO1' | 'BO3' | 'BO5';
  status: SeriesStatus;
  version: number;
  isSample: boolean;
}

/** `SELECT … FROM matches WHERE id = $1 FOR UPDATE` (always after the tournament lock). */
export async function lockMatch(tx: Tx, matchId: string): Promise<LockedMatch | null> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      tournament_id: string | null;
      bracket_slot_id: string | null;
      team_a_id: string | null;
      team_b_id: string | null;
      format: 'BO1' | 'BO3' | 'BO5';
      status: SeriesStatus;
      version: number;
      is_sample: boolean;
    }[]
  >`
    SELECT id, tournament_id, bracket_slot_id, team_a_id, team_b_id, format, status, version,
           is_sample
    FROM matches WHERE id = ${matchId}::uuid FOR UPDATE`;
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    tournamentId: r.tournament_id,
    bracketSlotId: r.bracket_slot_id,
    teamAId: r.team_a_id,
    teamBId: r.team_b_id,
    format: r.format,
    status: r.status,
    version: r.version,
    isSample: r.is_sample,
  };
}

/**
 * Applies a validated series transition (docs/TOURNAMENTS.md §7): checks the state machine,
 * updates `status` (+ `data`, e.g. result fields — COMPLETED must be written together with
 * `result_source` and `winner_team_id`) guarded by the expected `version`, bumps `version`, and
 * appends a `match_state_transitions` row. The caller must hold the match row lock.
 */
export async function transitionMatch(
  tx: Tx,
  match: { id: string; status: SeriesStatus; version: number },
  to: SeriesStatus,
  options: {
    source: TransitionSource;
    actorUserId: string | null;
    reason: string | null;
    data?: Omit<Prisma.MatchUncheckedUpdateManyInput, 'status' | 'version'>;
    now?: Date;
  },
): Promise<{ version: number }> {
  assertTransition(match.status, to, options.source);
  const now = options.now ?? new Date();
  const updated = await tx.match.updateMany({
    where: { id: match.id, status: match.status as MatchStatus, version: match.version },
    data: { ...(options.data ?? {}), status: to, version: { increment: 1 } },
  });
  if (updated.count !== 1) {
    // Callers lock the row first; a mismatch means a programming error, never a user error.
    throw new Error(`match ${match.id} changed concurrently (expected version ${match.version})`);
  }
  await tx.matchStateTransition.create({
    data: {
      matchId: match.id,
      fromStatus: match.status,
      toStatus: to,
      source: options.source,
      actorUserId: options.actorUserId,
      reason: options.reason,
      createdAt: now,
    },
  });
  return { version: match.version + 1 };
}

/** Initial log row for a newly created match (`from_status` NULL; version stays 0). */
export function initialTransition(
  matchId: string,
  status: SeriesStatus,
  reason: string,
  actorUserId: string | null,
  now: Date,
): Prisma.MatchStateTransitionCreateManyInput {
  return {
    matchId,
    fromStatus: null,
    toStatus: status,
    source: actorUserId ? 'ADMIN' : 'SYSTEM',
    actorUserId,
    reason,
    createdAt: now,
  };
}
