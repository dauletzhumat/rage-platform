'use client';

import { useId, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MutationError } from '@/components/states/mutation-error';
import { Button } from '@/components/ui/button';
import { FieldError, FieldHint, Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { createTournament, updateTournament } from '@/lib/api/browser';
import type { AdminTournamentDto, ApiFailure } from '@/lib/api/types';
import { MATCH_FORMATS } from '@/lib/api/types';
import { DISPLAY_TIMEZONE_LABEL, isoToZonedInput } from '@/lib/display-time';
import { UUID_PATTERN_CLIENT } from '@/lib/tournaments/slug';
import { textLength } from '@/lib/teams/validation';
import {
  MAP_POOL_SIZE,
  MAX_TEAMS_MAX,
  MAX_TEAMS_MIN,
  TOURNAMENT_DESCRIPTION_MAX,
  TOURNAMENT_NAME_MAX,
  tournamentFieldOf,
  validateTournamentForm,
  type MapPoolErrorCode,
  type TournamentErrorCode,
  type TournamentField,
  type TournamentFormInput,
} from '@/lib/tournaments/validation';

type FieldErrors = Partial<
  Record<TournamentField, { code?: TournamentErrorCode; server?: string }>
>;

const EMPTY: TournamentFormInput = {
  name: '',
  defaultMatchFormat: 'BO1',
  finalMatchFormat: '',
  maxTeams: '16',
  registrationOpenAt: '',
  registrationCloseAt: '',
  startsAt: '',
  description: '',
  // No defaults: the CS2 active pool changes; the admin supplies all 7 names.
  mapPool: Array.from({ length: MAP_POOL_SIZE }, () => ''),
};

function fromTournament(t: AdminTournamentDto): TournamentFormInput {
  return {
    name: t.name,
    defaultMatchFormat: t.defaultMatchFormat,
    finalMatchFormat: t.finalMatchFormat ?? '',
    maxTeams: t.maxTeams !== null ? String(t.maxTeams) : '',
    registrationOpenAt: isoToZonedInput(t.registrationOpenAt),
    registrationCloseAt: isoToZonedInput(t.registrationCloseAt),
    startsAt: isoToZonedInput(t.startsAt),
    description: t.description ?? '',
    mapPool: Array.from({ length: MAP_POOL_SIZE }, (_, i) => t.mapPool?.[i] ?? ''),
  };
}

const FIELD_ORDER: TournamentField[] = [
  'name',
  'defaultMatchFormat',
  'finalMatchFormat',
  'maxTeams',
  'registrationOpenAt',
  'registrationCloseAt',
  'startsAt',
  'description',
  'mapPool',
];

/**
 * Create (`POST /admin/tournaments`) or edit (`PATCH /admin/tournaments/:id`) a tournament
 * (docs/TOURNAMENTS.md §3.1). Single elimination only; exactly 7 admin-supplied map names.
 * Times are entered and shown in the platform display time zone (UTC+5 by default) and sent
 * as ISO instants with an explicit offset.
 */
export function TournamentForm({ tournament }: { tournament?: AdminTournamentDto }) {
  const t = useTranslations('adminTournaments');
  const te = useTranslations('apiErrors');
  const router = useRouter();
  const id = useId();
  const [values, setValues] = useState<TournamentFormInput>(() =>
    tournament ? fromTournament(tournament) : EMPTY,
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [mapErrors, setMapErrors] = useState<Array<MapPoolErrorCode | null>>([]);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof TournamentFormInput>(key: K, value: TournamentFormInput[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setSaved(false);
  }

  function setMap(index: number, value: string) {
    setValues((v) => {
      const mapPool = [...v.mapPool];
      mapPool[index] = value;
      return { ...v, mapPool };
    });
    setSaved(false);
  }

  function focusFirst(fieldErrors: FieldErrors, maps: Array<MapPoolErrorCode | null>) {
    const field = FIELD_ORDER.find((f) => fieldErrors[f]);
    if (!field) return;
    if (field === 'mapPool') {
      const index = Math.max(
        0,
        maps.findIndex((e) => e !== null),
      );
      document.getElementById(`${id}-map-${index}`)?.focus();
    } else {
      document.getElementById(`${id}-${field}`)?.focus();
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFailure(null);
    setSaved(false);
    const validation = validateTournamentForm(values);
    if (!validation.ok) {
      const next: FieldErrors = {};
      for (const [field, code] of Object.entries(validation.errors)) {
        next[field as TournamentField] = { code };
      }
      setErrors(next);
      setMapErrors(validation.mapErrors);
      focusFirst(next, validation.mapErrors);
      return;
    }
    setErrors({});
    setMapErrors([]);
    startTransition(async () => {
      const result = tournament
        ? await updateTournament(tournament.id, validation.value)
        : await createTournament(validation.value);
      if (result.ok) {
        if (!tournament && UUID_PATTERN_CLIENT.test(result.data.id)) {
          router.push(`/admin/tournaments/${encodeURIComponent(result.data.id)}`);
          return;
        }
        setSaved(true);
        router.refresh();
        return;
      }
      const next: FieldErrors = {};
      if (result.kind === 'validation' && result.details) {
        for (const detail of result.details) {
          const field = tournamentFieldOf(detail.field);
          if (field && !next[field]) next[field] = { server: detail.message };
        }
      }
      if (result.code === 'TOURNAMENT_NAME_TAKEN')
        next.name = { server: te('TOURNAMENT_NAME_TAKEN') };
      setErrors(next);
      focusFirst(next, []);
      setFailure(result);
    });
  }

  function errorText(field: TournamentField): string | null {
    const error = errors[field];
    if (!error) return null;
    return error.code ? t(`errors.${error.code}`) : (error.server ?? null);
  }

  function a11y(field: TournamentField, withHint = true) {
    const ids = [
      withHint ? `${id}-${field}-hint` : null,
      errors[field] ? `${id}-${field}-error` : null,
    ]
      .filter(Boolean)
      .join(' ');
    return {
      id: `${id}-${field}`,
      'aria-invalid': errors[field] ? (true as const) : undefined,
      'aria-describedby': ids || undefined,
    };
  }

  const descriptionLength = textLength(values.description);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6" data-testid="tournament-form">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-name`}>{t('name')}</Label>
        <Input
          {...a11y('name')}
          autoComplete="off"
          value={values.name}
          maxLength={TOURNAMENT_NAME_MAX + 8}
          required
          onChange={(e) => set('name', e.target.value)}
        />
        <FieldHint id={`${id}-name-hint`}>{t('nameHint')}</FieldHint>
        <FieldError id={`${id}-name-error`}>{errorText('name')}</FieldError>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-format`}>{t('bracketFormat')}</Label>
          <Input id={`${id}-format`} value={t('singleElimination')} readOnly aria-readonly="true" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-defaultMatchFormat`}>{t('defaultMatchFormat')}</Label>
          <NativeSelect
            {...a11y('defaultMatchFormat', false)}
            value={values.defaultMatchFormat}
            onChange={(e) => set('defaultMatchFormat', e.target.value)}
          >
            {MATCH_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </NativeSelect>
          <FieldError id={`${id}-defaultMatchFormat-error`}>
            {errorText('defaultMatchFormat')}
          </FieldError>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-finalMatchFormat`}>{t('finalMatchFormat')}</Label>
          <NativeSelect
            {...a11y('finalMatchFormat', false)}
            value={values.finalMatchFormat}
            onChange={(e) => set('finalMatchFormat', e.target.value)}
          >
            <option value="">{t('sameAsDefault')}</option>
            {MATCH_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </NativeSelect>
          <FieldError id={`${id}-finalMatchFormat-error`}>
            {errorText('finalMatchFormat')}
          </FieldError>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-maxTeams`}>{t('maxTeams')}</Label>
        <Input
          {...a11y('maxTeams')}
          className="w-28"
          type="number"
          inputMode="numeric"
          min={MAX_TEAMS_MIN}
          max={MAX_TEAMS_MAX}
          value={values.maxTeams}
          onChange={(e) => set('maxTeams', e.target.value)}
        />
        <FieldHint id={`${id}-maxTeams-hint`}>
          {t('maxTeamsHint', { min: MAX_TEAMS_MIN, max: MAX_TEAMS_MAX })}
        </FieldHint>
        <FieldError id={`${id}-maxTeams-error`}>{errorText('maxTeams')}</FieldError>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{t('schedule')}</legend>
        <p className="text-xs text-muted">{t('scheduleHint', { tz: DISPLAY_TIMEZONE_LABEL })}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          {(['registrationOpenAt', 'registrationCloseAt', 'startsAt'] as const).map((field) => (
            <div key={field} className="space-y-1.5">
              <Label htmlFor={`${id}-${field}`}>{t(field, { tz: DISPLAY_TIMEZONE_LABEL })}</Label>
              <Input
                {...a11y(field, false)}
                type="datetime-local"
                value={values[field]}
                onChange={(e) => set(field, e.target.value)}
              />
              <FieldError id={`${id}-${field}-error`}>{errorText(field)}</FieldError>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset
        className="space-y-3"
        aria-describedby={`${id}-mapPool-hint${errors.mapPool ? ` ${id}-mapPool-error` : ''}`}
      >
        <legend className="text-sm font-medium">{t('mapPool')}</legend>
        <FieldHint id={`${id}-mapPool-hint`}>
          {t('mapPoolHint', { count: MAP_POOL_SIZE })}
        </FieldHint>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {values.mapPool.map((value, index) => {
            const error = mapErrors[index] ?? null;
            const inputId = `${id}-map-${index}`;
            return (
              <li key={index} className="space-y-1">
                <Label htmlFor={inputId} className="text-xs text-muted">
                  {t('mapSlot', { n: index + 1 })}
                </Label>
                <Input
                  id={inputId}
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  value={value}
                  maxLength={40}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${inputId}-error` : undefined}
                  onChange={(e) => setMap(index, e.target.value)}
                />
                <FieldError id={`${inputId}-error`}>
                  {error ? t(`errors.${error}`) : null}
                </FieldError>
              </li>
            );
          })}
        </ol>
        <FieldError id={`${id}-mapPool-error`}>{errorText('mapPool')}</FieldError>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-description`}>{t('descriptionLabel')}</Label>
        <Textarea
          {...a11y('description')}
          rows={5}
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
        />
        <FieldHint id={`${id}-description-hint`}>
          <span
            className={descriptionLength > TOURNAMENT_DESCRIPTION_MAX ? 'text-danger' : undefined}
          >
            {t('charCount', { count: descriptionLength, max: TOURNAMENT_DESCRIPTION_MAX })}
          </span>
        </FieldHint>
        <FieldError id={`${id}-description-error`}>{errorText('description')}</FieldError>
      </div>

      <MutationError failure={failure} />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
          {pending ? t('saving') : tournament ? t('save') : t('create')}
        </Button>
        <p role="status" className="text-sm text-success">
          {saved ? t('saved') : null}
        </p>
      </div>
    </form>
  );
}
