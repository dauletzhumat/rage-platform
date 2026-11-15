import type { MatchFormat, VetoStateDto, VetoTurnAction } from '@/lib/api/types';

/** One planned step of the veto (docs/TOURNAMENTS.md §8; team A = better seed starts). */
export interface VetoStep {
  team: 'A' | 'B';
  action: VetoTurnAction;
}

const B = (team: 'A' | 'B'): VetoStep => ({ team, action: 'BAN' });
const P = (team: 'A' | 'B'): VetoStep => ({ team, action: 'PICK' });

/** Fixed sequences; the remaining map after the last step is the decider. */
export const VETO_SEQUENCES: Readonly<Record<MatchFormat, readonly VetoStep[]>> = {
  BO1: [B('A'), B('B'), B('A'), B('B'), B('A'), B('B')],
  BO3: [B('A'), B('B'), P('A'), P('B'), B('A'), B('B')],
  BO5: [B('A'), B('B'), P('A'), P('B'), P('A'), P('B')],
};

export interface VetoTurnView {
  /** Side whose turn it is, or null when complete / unknown. */
  actingSide: 'A' | 'B' | null;
  action: VetoTurnAction | null;
  /** Whether the viewer may submit (UX only — the API decides). */
  viewerCanAct: boolean;
  /** The viewer acts only through the audited SUPER_ADMIN override (not an operator). */
  asOverride: boolean;
  /** Index of the current step in the planned sequence (actions taken so far). */
  stepIndex: number;
  complete: boolean;
}

/**
 * Derive whose turn it is from the API's `next` (authoritative) and the match teams.
 * The viewer can act only when the API names a next turn for a team they operate, both teams are
 * known and the match is still CREATED. The client never infers a turn the API did not announce.
 */
export function vetoTurn(
  state: Pick<VetoStateDto, 'next' | 'complete' | 'actions'>,
  teams: { teamAId: string | null; teamBId: string | null },
  operatedTeamIds: ReadonlySet<string>,
  matchOpen: boolean,
  /** SUPER_ADMIN may veto for the acting team as an audited override. */
  canOverride = false,
): VetoTurnView {
  const stepIndex = state.actions.filter((a) => a.action !== 'DECIDER').length;
  if (state.complete || !state.next) {
    return {
      actingSide: null,
      action: null,
      viewerCanAct: false,
      asOverride: false,
      stepIndex,
      complete: true,
    };
  }
  const { teamId, action } = state.next;
  const actingSide =
    teams.teamAId !== null && teamId === teams.teamAId
      ? 'A'
      : teams.teamBId !== null && teamId === teams.teamBId
        ? 'B'
        : null;
  const open = matchOpen && actingSide !== null && teams.teamAId !== null && teams.teamBId !== null;
  const isOperator = operatedTeamIds.has(teamId);
  const viewerCanAct = open && (isOperator || canOverride);
  return {
    actingSide,
    action,
    viewerCanAct,
    asOverride: viewerCanAct && !isOperator,
    stepIndex,
    complete: false,
  };
}

/** Status of each pool map for display: banned / picked (with order) / decider / available. */
export type MapState =
  | { kind: 'available' }
  | { kind: 'banned'; teamId: string | null }
  | { kind: 'picked'; teamId: string | null; order: number }
  | { kind: 'decider'; order: number };

export function mapStates(state: Pick<VetoStateDto, 'pool' | 'actions'>): Map<string, MapState> {
  const result = new Map<string, MapState>();
  for (const name of state.pool) result.set(name, { kind: 'available' });
  let order = 0;
  for (const action of [...state.actions].sort((a, b) => a.sequence - b.sequence)) {
    if (action.action === 'BAN')
      result.set(action.mapName, { kind: 'banned', teamId: action.teamId });
    else if (action.action === 'PICK') {
      order += 1;
      result.set(action.mapName, { kind: 'picked', teamId: action.teamId, order });
    } else {
      order += 1;
      result.set(action.mapName, { kind: 'decider', order });
    }
  }
  return result;
}
