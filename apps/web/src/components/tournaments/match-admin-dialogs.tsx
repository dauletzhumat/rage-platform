'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FieldError, FieldHint, Input, Label, Textarea } from '@/components/ui/input';
import { forfeitMatch, overrideMatchResult } from '@/lib/api/browser';
import type { MatchFormat, MatchTeamRefM3 } from '@/lib/api/types';
import { isValidReason, REASON_MAX } from '@/lib/auth/validation';
import { validateSeriesScore, winsNeeded, type ScoreErrorCode } from '@/lib/tournaments/validation';
import { FormDialog } from './form-dialog';

interface MatchAdminProps {
  matchId: string;
  format: MatchFormat;
  teamA: MatchTeamRefM3;
  teamB: MatchTeamRefM3;
}

function ReasonField({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
}) {
  const ta = useTranslations('teamActions');
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{ta('reasonLabel')}</Label>
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

/**
 * `POST /admin/matches/:id/result-override` (docs/TOURNAMENTS.md §9). Scores are maps won and must
 * fit the format; the result is labelled ADMIN_OVERRIDE and never shown as server-verified.
 */
export function ResultOverrideDialog({ matchId, format, teamA, teamB }: MatchAdminProps) {
  const t = useTranslations('adminMatches');
  const ta = useTranslations('teamActions');
  const id = useId();
  const [winner, setWinner] = useState<'A' | 'B' | null>(null);
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  const [reason, setReason] = useState('');
  const [scoreError, setScoreError] = useState<ScoreErrorCode | null>(null);
  const [reasonInvalid, setReasonInvalid] = useState(false);

  function reset() {
    setWinner(null);
    setScoreA('');
    setScoreB('');
    setReason('');
    setScoreError(null);
    setReasonInvalid(false);
  }

  function submit() {
    const score = validateSeriesScore(format, winner, scoreA, scoreB);
    const reasonOk = isValidReason(reason);
    setScoreError(score.ok ? null : score.error);
    setReasonInvalid(!reasonOk);
    if (!score.ok) {
      document.getElementById(`${id}-a`)?.focus();
      return null;
    }
    if (!reasonOk) {
      document.getElementById(`${id}-reason`)?.focus();
      return null;
    }
    const winnerTeamId = winner === 'A' ? teamA.id : teamB.id;
    return overrideMatchResult(matchId, {
      winnerTeamId,
      teamAScore: score.teamAScore,
      teamBScore: score.teamBScore,
      reason: reason.trim(),
    });
  }

  const need = winsNeeded(format);

  return (
    <FormDialog
      triggerLabel={t('override')}
      triggerAriaLabel={t('overrideNamed', { teamA: teamA.name, teamB: teamB.name })}
      title={t('overrideTitle', { teamA: teamA.name, teamB: teamB.name })}
      description={t('overrideDescription', { format, need })}
      warning={t('notVerifiedWarning')}
      confirmLabel={t('overrideConfirm')}
      pendingLabel={ta('working')}
      destructive
      onSubmit={submit}
      onReset={reset}
      testId={`override-${matchId}`}
    >
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
      <ReasonField
        id={`${id}-reason`}
        value={reason}
        onChange={setReason}
        invalid={reasonInvalid}
      />
    </FormDialog>
  );
}

/** `POST /admin/matches/:id/forfeit`: the other team wins; no scores; labelled FORFEIT. */
export function ForfeitDialog({ matchId, teamA, teamB }: MatchAdminProps) {
  const t = useTranslations('adminMatches');
  const ta = useTranslations('teamActions');
  const id = useId();
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
      />
    </FormDialog>
  );
}
