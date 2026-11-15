'use client';

import { useTranslations } from 'next-intl';
import { Ban, Check, Hourglass, Star } from 'lucide-react';
import { ActionDialog } from '@/components/teams/action-dialog';
import { submitVeto } from '@/lib/api/browser';
import type { MatchFormat, MatchTeamRefM3, VetoStateDto } from '@/lib/api/types';
import { mapStates, VETO_SEQUENCES, vetoTurn } from '@/lib/tournaments/veto';
import { cn } from '@/lib/utils';

export interface VetoBoardProps {
  matchId: string;
  format: MatchFormat;
  teamA: MatchTeamRefM3 | null;
  teamB: MatchTeamRefM3 | null;
  state: VetoStateDto;
  /** Team ids the viewer operates (captain / TEAM_MANAGER) — UX only, the API decides. */
  operatedTeamIds: string[];
  /** Match is CREATED with both teams known (§8). */
  matchOpen: boolean;
  /** SUPER_ADMIN: may act for the acting team as an audited override. */
  canOverride?: boolean;
}

/**
 * Map veto board (docs/TOURNAMENTS.md §8): pool grid, planned sequence with the actions taken,
 * whose turn it is, and Ban/Pick buttons only for the operator of the acting team. State comes
 * from the API on each render; there is no live push in M3 — the "refresh" re-reads it.
 */
export function VetoBoard({
  matchId,
  format,
  teamA,
  teamB,
  state,
  operatedTeamIds,
  matchOpen,
  canOverride = false,
}: VetoBoardProps) {
  const t = useTranslations('veto');
  const ta = useTranslations('teamActions');
  const turn = vetoTurn(
    state,
    { teamAId: teamA?.id ?? null, teamBId: teamB?.id ?? null },
    new Set(operatedTeamIds),
    matchOpen,
    canOverride,
  );
  const maps = mapStates(state);
  const teamName = (id: string | null) =>
    id && teamA && id === teamA.id
      ? teamA.name
      : id && teamB && id === teamB.id
        ? teamB.name
        : t('unknownTeam');
  const actingTeam = turn.actingSide === 'A' ? teamA : turn.actingSide === 'B' ? teamB : null;
  const remaining = new Set(state.remaining);
  const sequence = VETO_SEQUENCES[format] ?? [];
  const taken = [...state.actions]
    .filter((a) => a.action !== 'DECIDER')
    .sort((a, b) => a.sequence - b.sequence);
  const decider = state.actions.find((a) => a.action === 'DECIDER') ?? null;

  let banner: string;
  if (turn.complete) banner = t('complete');
  else if (turn.asOverride && actingTeam && turn.action)
    banner = t(turn.action === 'BAN' ? 'overrideTurnBan' : 'overrideTurnPick', {
      team: actingTeam.name,
    });
  else if (turn.viewerCanAct && turn.action)
    banner = t(turn.action === 'BAN' ? 'yourTurnBan' : 'yourTurnPick');
  else if (actingTeam && turn.action)
    banner = t(turn.action === 'BAN' ? 'waitingBan' : 'waitingPick', { team: actingTeam.name });
  else banner = t('notStarted');

  return (
    <div className="space-y-4" data-testid="veto-board">
      <p
        role="status"
        data-testid="veto-turn"
        className={cn(
          'flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium',
          turn.viewerCanAct
            ? 'border-accent bg-accent/10 text-foreground'
            : 'border-border bg-surface text-muted',
        )}
      >
        {turn.complete ? (
          <Check aria-hidden="true" className="size-4 text-success" />
        ) : (
          <Hourglass aria-hidden="true" className="size-4" />
        )}
        {banner}
      </p>

      <ul
        aria-label={t('poolLabel')}
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
        data-testid="veto-pool"
      >
        {state.pool.map((map) => {
          const s = maps.get(map) ?? { kind: 'available' as const };
          const action = turn.viewerCanAct && remaining.has(map) ? turn.action : null;
          return (
            <li
              key={map}
              data-map-state={s.kind}
              className={cn(
                'flex flex-col gap-2 rounded-md border p-3',
                s.kind === 'banned' && 'border-border bg-surface/40 text-muted',
                s.kind === 'picked' && 'border-accent/60 bg-accent/10',
                s.kind === 'decider' && 'border-info/50 bg-info/10',
                s.kind === 'available' && 'border-border bg-surface',
              )}
            >
              <span className={cn('font-mono text-sm', s.kind === 'banned' && 'line-through')}>
                {map}
              </span>
              <span className="flex items-center gap-1 text-xs">
                {s.kind === 'banned' ? (
                  <>
                    <Ban aria-hidden="true" className="size-3" />
                    {t('bannedBy', { team: teamName(s.teamId) })}
                  </>
                ) : s.kind === 'picked' ? (
                  <>
                    <Star aria-hidden="true" className="size-3 text-accent-text" />
                    {t('pickedBy', { team: teamName(s.teamId), order: s.order })}
                  </>
                ) : s.kind === 'decider' ? (
                  t('deciderMap', { order: s.order })
                ) : (
                  <span className="text-muted">{t('available')}</span>
                )}
              </span>
              {action ? (
                <ActionDialog
                  triggerLabel={action === 'BAN' ? t('ban') : t('pick')}
                  triggerAriaLabel={t(action === 'BAN' ? 'banNamed' : 'pickNamed', { map })}
                  triggerVariant={action === 'BAN' ? 'destructive' : 'primary'}
                  title={t(action === 'BAN' ? 'banTitle' : 'pickTitle', { map })}
                  description={
                    turn.asOverride ? t('overrideConfirmDescription') : t('confirmDescription')
                  }
                  confirmLabel={action === 'BAN' ? t('ban') : t('pick')}
                  pendingLabel={ta('working')}
                  destructive={action === 'BAN'}
                  onConfirm={() => submitVeto(matchId, { action, mapName: map })}
                  testId={`veto-${action.toLowerCase()}-${map}`}
                />
              ) : null}
            </li>
          );
        })}
      </ul>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
          {t('sequenceTitle')}
        </h3>
        <ol className="space-y-1 text-sm" data-testid="veto-sequence">
          {sequence.map((step, index) => {
            const done = taken[index];
            const team = step.team === 'A' ? teamA : teamB;
            const current = !turn.complete && index === turn.stepIndex;
            return (
              <li
                key={index}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'flex flex-wrap items-center gap-2 rounded-md px-2 py-1',
                  current && 'bg-accent/10 font-medium',
                  !done && !current && 'text-muted',
                )}
              >
                <span className="w-5 font-mono text-xs text-muted">{index + 1}.</span>
                <span>
                  {t(step.action === 'BAN' ? 'stepBan' : 'stepPick', {
                    team: team?.name ?? t('unknownTeam'),
                  })}
                </span>
                {done ? (
                  <span className="font-mono text-xs">→ {done.mapName}</span>
                ) : current ? (
                  <span className="text-xs">{t('current')}</span>
                ) : null}
              </li>
            );
          })}
          <li
            className={cn(
              'flex flex-wrap items-center gap-2 rounded-md px-2 py-1',
              !decider && 'text-muted',
            )}
          >
            <span className="w-5 font-mono text-xs text-muted">{sequence.length + 1}.</span>
            <span>{t('stepDecider')}</span>
            {decider ? <span className="font-mono text-xs">→ {decider.mapName}</span> : null}
          </li>
        </ol>
      </div>
    </div>
  );
}
