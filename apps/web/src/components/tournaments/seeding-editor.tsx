'use client';

import { useId, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MutationError } from '@/components/states/mutation-error';
import { Button } from '@/components/ui/button';
import { FieldError, Input } from '@/components/ui/input';
import { setTournamentSeeds } from '@/lib/api/browser';
import type { ApiFailure } from '@/lib/api/types';
import { validateSeeds, type SeedErrorCode } from '@/lib/tournaments/validation';

export interface SeedRow {
  registrationId: string;
  teamName: string;
  teamTag: string;
  seed: number | null;
}

/**
 * Seeds for every APPROVED registration, 1..N unique (docs/TOURNAMENTS.md §6). Only while
 * REGISTRATION_CLOSED; the API rejects anything else with SEEDS_INVALID.
 */
export function SeedingEditor({ tournamentId, rows }: { tournamentId: string; rows: SeedRow[] }) {
  const t = useTranslations('adminTournaments');
  const router = useRouter();
  const id = useId();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.registrationId, r.seed !== null ? String(r.seed) : ''])),
  );
  const [errors, setErrors] = useState<Record<string, SeedErrorCode>>({});
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const ids = rows.map((r) => r.registrationId);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFailure(null);
    setSaved(false);
    const validation = validateSeeds(ids, values);
    if (!validation.ok) {
      setErrors(validation.errors);
      const firstInvalid = ids.find((rid) => validation.errors[rid]);
      if (firstInvalid) document.getElementById(`${id}-${firstInvalid}`)?.focus();
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await setTournamentSeeds(tournamentId, { seeds: validation.value });
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3" data-testid="seeding-editor">
      <p className="text-sm text-muted">{t('seedingHint', { count: rows.length })}</p>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {rows.map((row) => {
          const inputId = `${id}-${row.registrationId}`;
          const error = errors[row.registrationId];
          return (
            <li key={row.registrationId} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <label htmlFor={inputId} className="min-w-0 flex-1 text-sm font-medium">
                {row.teamName} <span className="font-mono text-xs text-muted">[{row.teamTag}]</span>
              </label>
              <Input
                id={inputId}
                className="w-20 text-right font-mono"
                inputMode="numeric"
                value={values[row.registrationId] ?? ''}
                maxLength={2}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${inputId}-error` : undefined}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [row.registrationId]: e.target.value }));
                  setSaved(false);
                }}
              />
              <FieldError id={`${inputId}-error`}>
                {error ? t(`errors.${error}`, { max: rows.length }) : null}
              </FieldError>
            </li>
          );
        })}
      </ul>
      <MutationError failure={failure} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="secondary"
          disabled={pending}
          aria-busy={pending || undefined}
        >
          {pending ? t('saving') : t('saveSeeds')}
        </Button>
        <p role="status" className="text-sm text-success">
          {saved ? t('seedsSaved') : null}
        </p>
      </div>
    </form>
  );
}
