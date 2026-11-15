import type { BracketMatchDto } from '@/lib/api/types';

export type RoundLabel =
  | { key: 'final' }
  | { key: 'semifinal' }
  | { key: 'quarterfinal' }
  | { key: 'roundOf'; teams: number };

/** Localisable round name from its position (the API's English `name` is not rendered). */
export function roundLabel(roundNumber: number, totalRounds: number): RoundLabel {
  const fromEnd = totalRounds - roundNumber;
  if (fromEnd <= 0) return { key: 'final' };
  if (fromEnd === 1) return { key: 'semifinal' };
  if (fromEnd === 2) return { key: 'quarterfinal' };
  return { key: 'roundOf', teams: 2 ** (fromEnd + 1) };
}

/** Bye slot: flagged by the API, or a CANCELLED match whose status reason is `bye` (§6). */
export function isByeMatch(match: Pick<BracketMatchDto, 'isBye' | 'status' | 'statusReason'>) {
  return match.isBye === true || (match.status === 'CANCELLED' && match.statusReason === 'bye');
}

/** Which side won, from the winner id (or slug); null when undecided. */
export function winnerSide(
  match: Pick<BracketMatchDto, 'winnerTeamSlug' | 'teamA' | 'teamB'> & {
    winnerTeamId?: string | null;
  },
): 'A' | 'B' | null {
  if (match.winnerTeamId) {
    if (match.teamA && match.teamA.id === match.winnerTeamId) return 'A';
    if (match.teamB && match.teamB.id === match.winnerTeamId) return 'B';
  }
  if (!match.winnerTeamSlug) return null;
  if (match.teamA && match.teamA.slug === match.winnerTeamSlug) return 'A';
  if (match.teamB && match.teamB.slug === match.winnerTeamSlug) return 'B';
  return null;
}
