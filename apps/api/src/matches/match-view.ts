import { type Prisma } from '@rage/db';
import { iso } from '../common/http/dto.js';
import { PUBLIC_TOURNAMENT_STATUSES } from '../tournaments/tournaments.dto.js';
import { roundName } from '../tournament-domain/bracket.js';
import type {
  MatchDetailDto,
  MatchFormatValue,
  MatchStatusValue,
  MatchSummaryDto,
} from './matches.dto.js';

/** Matches of unpublished (DRAFT) tournaments are not public. */
export const publicMatchWhere = {
  OR: [{ tournamentId: null }, { tournament: { status: { in: [...PUBLIC_TOURNAMENT_STATUSES] } } }],
} satisfies Prisma.MatchWhereInput;

const teamRef = { select: { id: true, slug: true, name: true, tag: true } } as const;

export const matchSummarySelect = {
  id: true,
  status: true,
  format: true,
  scheduledAt: true,
  isSample: true,
  teamAScore: true,
  teamBScore: true,
  winnerTeamId: true,
  resultSource: true,
  resultVerifiedAt: true,
  statusReason: true,
  teamA: teamRef,
  teamB: teamRef,
  winnerTeam: { select: { slug: true } },
  tournament: { select: { slug: true, name: true } },
  bracketSlot: {
    select: {
      roundNumber: true,
      slotNumber: true,
      bracket: { select: { _count: { select: { slots: true } } } },
    },
  },
} satisfies Prisma.MatchSelect;

export type MatchSummaryRow = Prisma.MatchGetPayload<{ select: typeof matchSummarySelect }>;

export const matchDetailSelect = {
  ...matchSummarySelect,
  maps: {
    orderBy: { mapOrder: 'asc' },
    select: { mapOrder: true, mapName: true, status: true, teamAScore: true, teamBScore: true },
  },
} satisfies Prisma.MatchSelect;

export type MatchDetailRow = Prisma.MatchGetPayload<{ select: typeof matchDetailSelect }>;

/**
 * A winner is public when the series is COMPLETED and its result has a provenance: an admin
 * result (ADMIN_OVERRIDE / FORFEIT, labelled via `resultSource`, never shown as verified) or a
 * verified server result. A stray `winner_team_id` on a running match is never published.
 */
export function isWinnerPublic(row: {
  status: string;
  resultSource: string | null;
  resultVerifiedAt: Date | null;
}): boolean {
  if (row.status !== 'COMPLETED' || !row.resultSource) return false;
  return row.resultSource === 'SERVER' ? row.resultVerifiedAt !== null : true;
}

/** Total rounds of a single-elimination bracket from its slot count (S − 1 slots). */
function roundsFromSlotCount(slotCount: number): number {
  return Math.round(Math.log2(slotCount + 1));
}

export function toMatchSummary(row: MatchSummaryRow): MatchSummaryDto {
  const winnerPublic = isWinnerPublic(row);
  const slot = row.bracketSlot;
  return {
    id: row.id,
    status: row.status as MatchStatusValue,
    format: row.format as MatchFormatValue,
    scheduledAt: iso(row.scheduledAt),
    teamA: row.teamA ?? null,
    teamB: row.teamB ?? null,
    tournament: row.tournament ?? null,
    round: slot
      ? {
          roundNumber: slot.roundNumber,
          name: roundName(slot.roundNumber, roundsFromSlotCount(slot.bracket._count.slots)),
        }
      : null,
    teamAScore: row.teamAScore,
    teamBScore: row.teamBScore,
    winnerTeamSlug: winnerPublic ? (row.winnerTeam?.slug ?? null) : null,
    winnerTeamId: winnerPublic ? row.winnerTeamId : null,
    resultSource: row.resultSource,
    resultVerifiedAt: iso(row.resultVerifiedAt),
    statusReason: row.statusReason,
    isSample: row.isSample,
  };
}

export function toMatchDetail(row: MatchDetailRow): MatchDetailDto {
  return {
    ...toMatchSummary(row),
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
