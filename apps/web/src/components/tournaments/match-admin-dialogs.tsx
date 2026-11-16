'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FieldError, FieldHint, Input, Label, Textarea } from '@/components/ui/input';
import { forfeitMatch, overrideMatchResult } from '@/lib/api/browser';
import type { MatchFormat, MatchTeamRefM3 } from '@/lib/api/types';
import { isValidReason, REASON_MAX } from '@/lib/auth/validation';
import {
  validateMapScores,
  type MapScoreInput,
  type MapScoreSlot,
} from '@/lib/tournaments/map-scores';
import { validateSeriesScore, winsNeeded, type ScoreErrorCode } from '@/lib/tournaments/validation';
import { cn } from '@/lib/utils';
import { FormDialog } from './form-dialog';
import { ReasonPresetChips, useReasonPresets } from './reason-presets';

interface MatchAdminProps {
  matchId: string;
  format: MatchFormat;
  teamA: MatchTeamRefM3;
  teamB: MatchTeamRefM3;
  /** Demo mode on a sample match: start with the "Demo test" reason. */
  demoPrefill?: boolean;
}

function ReasonField({
  id,
  value,
  onChange,
  invalid,
  presets,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  presets: readonly string[];
}) {
  const ta = useTranslations('teamActions');
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{ta('reasonLabel')}</Label>
      <ReasonPresetChips presets={presets} current={value} onPick={onChange} />
      <Textarea
        id={id}
        value={value}
        required
        maxLength={REASON_MAX + 16}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-hint${invalid ? ` ${id}-error` : ''}`}
        onChange={(e) => onChange(e.target.value)}
      />
      <FieldHint id={`${id}-hint`}>{ta('reasonHint')}</FieldHint>
      <FieldError id={`${id}-error`}>{invalid ? ta('reasonInvalid') : null}</FieldError>
    </div>
  );
}

function TeamRadio({
  name,
  value,
  current,
  label,
  onChange,
}: {
  name: string;
  value: 'A' | 'B';
  current: 'A' | 'B' | null;
  label: string;
  onChange: (value: 'A' | 'B') => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10">
      <input
        type="radio"
        name={name}
        value={value}
        checked={current === value}
        onChange={() => onChange(value)}
        className="accent-[var(--color-accent)]"
      />
      {label}
    </label>
  );
}

const emptyRows = (n: number): MapScoreInput[] =>
  Array.from({ length: n }, () => ({ teamAScore: '', teamBScore: '' }));

/**
 * `POST /admin/matches/:id/result-override` (docs/TOURNAMENTS.md §9).
 * After the veto (`maps` known) the admin enters round scores per map and the series score and
 * winner are derived live; the API derives the series from `maps`. Before the veto only the
 * series (maps won) can be entered. Always labelled ADMIN_OVERRIDE, never server-verified.
 */
export function ResultOverrideDialog({
  matchId,
  format,
  teamA,
  teamB,
  maps = [],
  demoPrefill = false,
}: MatchAdminProps & {
  /** Match maps in veto order (PENDING rows); empty when the veto is not complete. */
  maps?: MapScoreSlot[];
}) {
  const t = useTranslations('adminMatches');
  const ta = useTranslations('teamActions');
  const id = useId();
  const presets = useReasonPresets('result', demoPrefill);
  const slots = [...maps].sort((a, b) => a.mapOrder - b.mapOrder);
  const mapMode = slots.length > 0;
  const need = winsNeeded(format);

  const [winner, setWinner] = useState<'A' | 'B' | null>(null);
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  const [rows, setRows] = useState<MapScoreInput[]>(() => emptyRows(slots.length));
  const [showMapErrors, setShowMapErrors] = useState(false);
  const [reason, setReason] = useState('');
  const [scoreError, setScoreError] = useState<ScoreErrorCode | null>(null);
  const [reasonInvalid, setReasonInvalid] = useState(false);

  const mapResult = validateMapScores(format, slots, rows);
  const summary = mapResult.summary;

  function reset() {
    setWinner(null);
    setScoreA('');
    setScoreB('');
    setRows(emptyRows(slots.length));
    setShowMapErrors(false);
    setReason('');
    setScoreError(null);
    setReasonInvalid(false);
  }

  function setRow(index: number, side: keyof MapScoreInput, value: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [side]: value } : r)));
  }

  function submit() {
    const reasonOk = isValidReason(reason);
    setReasonInvalid(!reasonOk);
    if (mapMode) {
      setShowMapErrors(true);
      if (!mapResult.ok) {
        const firstBad = mapResult.rowErrors.findIndex((e) => e !== null);
        document.getElementById(`${id}-map-${Math.max(firstBad, 0)}-a`)?.focus();
        return null;
      }
      if (!reasonOk) {
        document.getElementById(`${id}-reason`)?.focus();
        return null;
      }
      // Only per-map scores: the API derives the series score and winner.
      return overrideMatchResult(matchId, { maps: mapResult.maps, reason: reason.trim() });
    }
    const score = validateSeriesScore(format, winner, scoreA, scoreB);
    setScoreError(score.ok ? null : score.error);
    if (!score.ok) {
      document.getElementById(`${id}-a`)?.focus();
      return null;
    }
    if (!reasonOk) {
      document.getElementById(`${id}-reason`)?.focus();
      return null;
    }
    return overrideMatchResult(matchId, {
      winnerTeamId: winner === 'A' ? teamA.id : teamB.id,
      teamAScore: score.teamAScore,
      teamBScore: score.teamBScore,
      reason: reason.trim(),
    });
  }

  const seriesWinnerName =
    summary.seriesWinner === 'A' ? teamA.name : summary.seriesWinner === 'B' ? teamB.name : null;

  return (
    <FormDialog
      triggerLabel={t('override')}
      triggerAriaLabel={t('overrideNamed', { teamA: teamA.name, teamB: teamB.name })}
      title={t('overrideTitle', { teamA: teamA.name, teamB: teamB.name })}
      description={
        mapMode
          ? t('overrideMapsDescription', { format, need })
          : t('overrideDescription', { format, need })
      }
      warning={t('notVerifiedWarning')}
      confirmLabel={t('overrideConfirm')}
      pendingLabel={ta('working')}
      destructive
      onSubmit={submit}
      onReset={reset}
      onOpen={() => {
        setReason(presets.initial);
        setRows(emptyRows(slots.length));
      }}
      testId={`override-${matchId}`}
    >
      {mapMode ? (
        <fieldset className="space-y-2" data-testid="map-scores">
          <legend className="text-sm font-medium">{t('mapScoresLegend')}</legend>
          <ol className="space-y-2">
            {slots.map((slot, i) => {
              const error = showMapErrors && !mapResult.ok ? mapResult.rowErrors[i] : null;
              const row = rows[i] ?? { teamAScore: '', teamBScore: '' };
              const rowWinner = summary.rowWinners[i];
              const notNeeded =
                summary.decidedAt !== null &&
                i > summary.decidedAt &&
                row.teamAScore === '' &&
                row.teamBScore === '';
              const errorId = `${id}-map-${i}-error`;
              return (
                <li key={slot.mapOrder} className="rounded-md border border-border p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 text-sm">
                      {t('mapRowLabel', { n: slot.mapOrder })}{' '}
                      <span className="font-mono text-muted">· {slot.mapName}</span>
                    </span>
                    <Input
                      id={`${id}-map-${i}-a`}
                      className="w-16 text-right font-mono"
                      inputMode="numeric"
                      maxLength={2}
                      value={row.teamAScore}
                      disabled={notNeeded}
                      aria-label={t('roundsFor', { team: teamA.name, n: slot.mapOrder })}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? errorId : undefined}
                      onChange={(e) => setRow(i, 'teamAScore', e.target.value)}
                    />
                    <span aria-hidden="true" className="text-muted">
                      :
                    </span>
                    <Input
                      id={`${id}-map-${i}-b`}
                      className="w-16 font-mono"
                      inputMode="numeric"
                      maxLength={2}
                      value={row.teamBScore}
                      disabled={notNeeded}
                      aria-label={t('roundsFor', { team: teamB.name, n: slot.mapOrder })}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? errorId : undefined}
                      onChange={(e) => setRow(i, 'teamBScore', e.target.value)}
                    />
                    <span className="w-28 truncate text-xs text-muted">
                      {notNeeded
                        ? t('mapNotNeeded')
                        : rowWinner
                          ? t('mapWinner', { team: rowWinner === 'A' ? teamA.name : teamB.name })
                          : ''}
                    </span>
                  </div>
                  <FieldError id={errorId}>
                    {error ? t(`mapErrors.${error}`, { max: 99 }) : null}
                  </FieldError>
                </li>
              );
            })}
          </ol>
          <p
            aria-live="polite"
            data-testid="derived-series"
            className={cn(
              'rounded-md border px-3 py-2 text-sm',
              seriesWinnerName ? 'border-accent/50 bg-accent/10' : 'border-border',
            )}
          >
            {t('derivedSeries', {
              teamA: teamA.name,
              scoreA: summary.winsA,
              teamB: teamB.name,
              scoreB: summary.winsB,
            })}{' '}
            {seriesWinnerName
              ? t('derivedWinner', { team: seriesWinnerName })
              : t('derivedUndecided', { need })}
          </p>
          <FieldError id={`${id}-series-error`}>
            {showMapErrors && !mapResult.ok && mapResult.seriesError
              ? t(`mapErrors.${mapResult.seriesError}`, { need })
              : null}
          </FieldError>
        </fieldset>
      ) : (
        <>
          <p className="text-xs text-muted" role="note">
            {t('mapScoresAfterVeto')}
          </p>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('winner')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <TeamRadio
                name={`${id}-winner`}
                value="A"
                current={winner}
                label={teamA.name}
                onChange={setWinner}
              />
              <TeamRadio
                name={`${id}-winner`}
                value="B"
                current={winner}
                label={teamB.name}
                onChange={setWinner}
              />
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-a`}>{t('mapsWon', { team: teamA.name })}</Label>
              <Input
                id={`${id}-a`}
                inputMode="numeric"
                value={scoreA}
                maxLength={1}
                aria-invalid={scoreError ? true : undefined}
                aria-describedby={`${id}-score-hint${scoreError ? ` ${id}-score-error` : ''}`}
                onChange={(e) => setScoreA(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-b`}>{t('mapsWon', { team: teamB.name })}</Label>
              <Input
                id={`${id}-b`}
                inputMode="numeric"
                value={scoreB}
                maxLength={1}
                aria-invalid={scoreError ? true : undefined}
                aria-describedby={`${id}-score-hint${scoreError ? ` ${id}-score-error` : ''}`}
                onChange={(e) => setScoreB(e.target.value)}
              />
            </div>
          </div>
          <FieldHint id={`${id}-score-hint`}>{t('scoreHint', { format, need })}</FieldHint>
          <FieldError id={`${id}-score-error`}>
            {scoreError ? t(`scoreErrors.${scoreError}`, { format, need }) : null}
          </FieldError>
        </>
      )}
      <ReasonField
        id={`${id}-reason`}
        value={reason}
        onChange={setReason}
        invalid={reasonInvalid}
        presets={presets.presets}
      />
    </FormDialog>
  );
}

/** `POST /admin/matches/:id/forfeit`: the other team wins; no scores; labelled FORFEIT. */
export function ForfeitDialog({ matchId, teamA, teamB, demoPrefill = false }: MatchAdminProps) {
  const t = useTranslations('adminMatches');
  const ta = useTranslations('teamActions');
  const id = useId();
  const presets = useReasonPresets('forfeit', demoPrefill);
  const [side, setSide] = useState<'A' | 'B' | null>(null);
  const [reason, setReason] = useState('');
  const [sideInvalid, setSideInvalid] = useState(false);
  const [reasonInvalid, setReasonInvalid] = useState(false);

  function reset() {
    setSide(null);
    setReason('');
    setSideInvalid(false);
    setReasonInvalid(false);
  }

  function submit() {
    const reasonOk = isValidReason(reason);
    setSideInvalid(side === null);
    setReasonInvalid(!reasonOk);
    if (side === null || !reasonOk) return null;
    return forfeitMatch(matchId, {
      forfeitingTeamId: side === 'A' ? teamA.id : teamB.id,
      reason: reason.trim(),
    });
  }

  return (
    <FormDialog
      triggerLabel={t('forfeit')}
      triggerAriaLabel={t('forfeitNamed', { teamA: teamA.name, teamB: teamB.name })}
      triggerVariant="destructive"
      title={t('forfeitTitle', { teamA: teamA.name, teamB: teamB.name })}
      description={t('forfeitDescription')}
      warning={t('notVerifiedWarning')}
      confirmLabel={t('forfeitConfirm')}
      pendingLabel={ta('working')}
      destructive
      onSubmit={submit}
      onReset={reset}
      onOpen={() => setReason(presets.initial)}
      testId={`forfeit-${matchId}`}
    >
      <fieldset
        className="space-y-2"
        aria-describedby={sideInvalid ? `${id}-side-error` : undefined}
      >
        <legend className="text-sm font-medium">{t('forfeitingTeam')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <TeamRadio
            name={`${id}-side`}
            value="A"
            current={side}
            label={teamA.name}
            onChange={setSide}
          />
          <TeamRadio
            name={`${id}-side`}
            value="B"
            current={side}
            label={teamB.name}
            onChange={setSide}
          />
        </div>
        <FieldError id={`${id}-side-error`}>
          {sideInvalid ? t('forfeitingRequired') : null}
        </FieldError>
      </fieldset>
      <ReasonField
        id={`${id}-reason`}
        value={reason}
        onChange={setReason}
        invalid={reasonInvalid}
        presets={presets.presets}
      />
    </FormDialog>
  );
}
