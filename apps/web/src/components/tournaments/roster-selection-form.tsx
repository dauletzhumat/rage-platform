'use client';

import { useId, useMemo, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MutationError } from '@/components/states/mutation-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { createRegistration, updateRegistrationRoster } from '@/lib/api/browser';
import type { ApiFailure, RosterRole } from '@/lib/api/types';
import {
  ineligiblePlayers,
  selectionToLists,
  STARTERS_REQUIRED,
  SUBSTITUTES_MAX,
  validateRosterSelection,
  type RosterChoice,
  type RosterSelectionErrorCode,
} from '@/lib/tournaments/validation';
import { cn } from '@/lib/utils';

export interface RosterCandidate {
  userId: string;
  nickname: string;
  /** Role on the team roster (CAPTAIN / PLAYER / SUBSTITUTE / …). */
  teamRole: RosterRole;
}

export interface RosterSelectionFormProps {
  tournamentId: string;
  teamId: string;
  /** Current ACTIVE team roster (`GET /teams/:slug`). */
  candidates: RosterCandidate[];
  /** Pre-selected choices (existing roster snapshot when editing). */
  initial: Record<string, RosterChoice>;
  /** Editing a PENDING registration (PUT) instead of creating one (POST). */
  registrationId?: string;
}

const CHOICES: RosterChoice[] = ['STARTER', 'SUBSTITUTE', 'NONE'];

/**
 * Operator picks exactly 5 starters and up to 2 substitutes from the team's current active roster
 * (docs/TOURNAMENTS.md §4). Each player is a radio group (keyboard: arrow keys within a group).
 * Per-player eligibility errors come from 409 PLAYER_INELIGIBLE details; the API snapshots
 * SteamID64 + nickname and re-validates everything.
 */
export function RosterSelectionForm({
  tournamentId,
  teamId,
  candidates,
  initial,
  registrationId,
}: RosterSelectionFormProps) {
  const t = useTranslations('tournamentRegister');
  const tr = useTranslations('rosterEntryRole');
  const ti = useTranslations('ineligibleReason');
  const troles = useTranslations('roles');
  const router = useRouter();
  const id = useId();
  const [choices, setChoices] = useState<Record<string, RosterChoice>>(() => {
    const next: Record<string, RosterChoice> = {};
    for (const c of candidates) next[c.userId] = initial[c.userId] ?? 'NONE';
    return next;
  });
  const [errors, setErrors] = useState<RosterSelectionErrorCode[]>([]);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const order = useMemo(() => candidates.map((c) => c.userId), [candidates]);
  const { starters, substitutes } = selectionToLists(order, choices);
  const ineligible = ineligiblePlayers(failure);

  function choose(userId: string, choice: RosterChoice) {
    setChoices((prev) => ({ ...prev, [userId]: choice }));
    setSaved(false);
    setErrors([]);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFailure(null);
    setSaved(false);
    const validation = validateRosterSelection(teamId, starters, substitutes);
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }
    setErrors([]);
    startTransition(async () => {
      const result = registrationId
        ? await updateRegistrationRoster(tournamentId, registrationId, validation.value)
        : await createRegistration(tournamentId, validation.value);
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  const startersOk = starters.length === STARTERS_REQUIRED;
  const subsOk = substitutes.length <= SUBSTITUTES_MAX;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" data-testid="roster-selection-form">
      <div
        className="flex flex-wrap gap-3 text-sm"
        aria-live="polite"
        data-testid="roster-counters"
      >
        <span
          className={cn(
            'rounded-md border px-2 py-1',
            startersOk ? 'border-success/40 text-success' : 'border-border text-muted',
          )}
        >
          {t('startersCount', { count: starters.length, required: STARTERS_REQUIRED })}
        </span>
        <span
          className={cn(
            'rounded-md border px-2 py-1',
            subsOk ? 'border-border text-muted' : 'border-danger/40 text-danger',
          )}
        >
          {t('substitutesCount', { count: substitutes.length, max: SUBSTITUTES_MAX })}
        </span>
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {candidates.map((candidate) => {
          const reason = ineligible[candidate.userId.toLowerCase()];
          const errorId = `${id}-${candidate.userId}-error`;
          const nameId = `${id}-${candidate.userId}-name`;
          return (
            <li key={candidate.userId} className="px-3 py-2.5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span id={nameId} className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <span className="truncate">{candidate.nickname}</span>
                  <Badge tone={candidate.teamRole === 'CAPTAIN' ? 'accent' : 'neutral'}>
                    {troles(candidate.teamRole)}
                  </Badge>
                </span>
                <div
                  role="radiogroup"
                  aria-labelledby={nameId}
                  aria-describedby={reason ? errorId : undefined}
                  aria-invalid={reason ? true : undefined}
                  className="flex flex-wrap gap-1.5"
                >
                  {CHOICES.map((choice) => {
                    const inputId = `${id}-${candidate.userId}-${choice}`;
                    const checked = choices[candidate.userId] === choice;
                    return (
                      <label
                        key={choice}
                        htmlFor={inputId}
                        className={cn(
                          'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
                          checked
                            ? choice === 'NONE'
                              ? 'border-border-strong bg-raised text-foreground'
                              : 'border-accent bg-accent/10 text-foreground'
                            : 'border-border text-muted hover:text-foreground',
                        )}
                      >
                        <input
                          id={inputId}
                          type="radio"
                          name={`${id}-${candidate.userId}`}
                          value={choice}
                          checked={checked}
                          onChange={() => choose(candidate.userId, choice)}
                          className="sr-only"
                        />
                        {choice === 'NONE' ? t('notSelected') : tr(choice)}
                      </label>
                    );
                  })}
                </div>
              </div>
              {reason ? (
                <p id={errorId} className="mt-1 text-xs font-medium text-danger">
                  {ti(reason)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {errors.length > 0 ? (
        <ul
          role="alert"
          className="space-y-1 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
        >
          {errors.map((code) => (
            <li key={code}>
              {t(`errors.${code}`, { required: STARTERS_REQUIRED, max: SUBSTITUTES_MAX })}
            </li>
          ))}
        </ul>
      ) : null}

      <MutationError failure={failure} />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
          {pending ? t('saving') : registrationId ? t('saveRoster') : t('submitRegistration')}
        </Button>
        <p role="status" className="text-sm text-success">
          {saved ? (registrationId ? t('rosterSaved') : t('registrationSubmitted')) : null}
        </p>
      </div>
    </form>
  );
}
