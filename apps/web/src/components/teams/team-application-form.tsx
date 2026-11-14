'use client';

import { useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MutationError } from '@/components/states/mutation-error';
import { Button } from '@/components/ui/button';
import { FieldError, FieldHint, Input, Label, Textarea } from '@/components/ui/input';
import { submitTeamApplication } from '@/lib/api/browser';
import { isKnownErrorCode, type KnownErrorCode } from '@/lib/api/error-codes';
import type { ApiFailure } from '@/lib/api/types';
import {
  applicationFieldOf,
  TEAM_DESCRIPTION_MAX,
  TEAM_NAME_MAX,
  TEAM_TAG_MAX,
  textLength,
  validateTeamApplication,
  type ApplicationErrorCode,
  type ApplicationField,
  type ApplicationFormInput,
} from '@/lib/teams/validation';

type FieldErrors = Partial<
  Record<ApplicationField, { code?: ApplicationErrorCode; server?: string }>
>;

const EMPTY: ApplicationFormInput = { name: '', tag: '', countryCode: '', description: '' };

/** API error codes that belong to one form field (shown inline, focus moves there). */
const CODE_FIELD: Partial<Record<KnownErrorCode, ApplicationField>> = {
  TEAM_NAME_TAKEN: 'name',
  TEAM_TAG_TAKEN: 'tag',
};

/**
 * Team creation application (`POST /team-applications`). Client checks mirror TEAMS.md §2;
 * the API re-validates. A team is created only when an administrator approves.
 */
export function TeamApplicationForm() {
  const t = useTranslations('teamApply');
  const te = useTranslations('apiErrors');
  const router = useRouter();
  const id = useId();
  const [values, setValues] = useState<ApplicationFormInput>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pending, startTransition] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);
  const tagRef = useRef<HTMLInputElement>(null);
  const countryRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  function set<K extends keyof ApplicationFormInput>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    setSubmitted(false);
  }

  /** Move focus to the first invalid field (event handlers only). */
  function focusFirst(errors: FieldErrors) {
    if (errors.name) nameRef.current?.focus();
    else if (errors.tag) tagRef.current?.focus();
    else if (errors.countryCode) countryRef.current?.focus();
    else if (errors.description) descriptionRef.current?.focus();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFailure(null);
    setSubmitted(false);
    const validation = validateTeamApplication(values);
    if (!validation.ok) {
      const errors: FieldErrors = {};
      for (const [field, code] of Object.entries(validation.errors)) {
        errors[field as ApplicationField] = { code };
      }
      setFieldErrors(errors);
      focusFirst(errors);
      return;
    }
    setFieldErrors({});
    startTransition(async () => {
      const result = await submitTeamApplication(validation.value);
      if (result.ok) {
        setValues(EMPTY);
        setSubmitted(true);
        router.refresh();
        return;
      }
      const errors: FieldErrors = {};
      if (result.kind === 'validation' && result.details) {
        for (const detail of result.details) {
          const field = applicationFieldOf(detail.field);
          if (field && !errors[field]) errors[field] = { server: detail.message };
        }
      }
      if (isKnownErrorCode(result.code)) {
        const codeField = CODE_FIELD[result.code];
        if (codeField) errors[codeField] = { server: te(result.code) };
      }
      setFieldErrors(errors);
      focusFirst(errors);
      setFailure(result);
    });
  }

  function errorText(field: ApplicationField): string | null {
    const error = fieldErrors[field];
    if (!error) return null;
    return error.code ? t(`errors.${error.code}`) : (error.server ?? null);
  }

  function describedBy(field: ApplicationField): string {
    return `${id}-${field}-hint${fieldErrors[field] ? ` ${id}-${field}-error` : ''}`;
  }

  const descriptionLength = textLength(values.description);

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-5"
      aria-describedby={`${id}-status`}
      data-testid="team-application-form"
    >
      <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>{t('name')}</Label>
          <Input
            ref={nameRef}
            id={`${id}-name`}
            name="name"
            autoComplete="off"
            value={values.name}
            maxLength={TEAM_NAME_MAX + 8}
            required
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={describedBy('name')}
            onChange={(e) => set('name', e.target.value)}
          />
          <FieldHint id={`${id}-name-hint`}>{t('nameHint')}</FieldHint>
          <FieldError id={`${id}-name-error`}>{errorText('name')}</FieldError>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-tag`}>{t('tag')}</Label>
          <Input
            ref={tagRef}
            id={`${id}-tag`}
            name="tag"
            autoComplete="off"
            className="w-full font-mono sm:w-32"
            value={values.tag}
            maxLength={TEAM_TAG_MAX + 2}
            required
            aria-invalid={fieldErrors.tag ? true : undefined}
            aria-describedby={describedBy('tag')}
            onChange={(e) => set('tag', e.target.value)}
          />
          <FieldHint id={`${id}-tag-hint`}>{t('tagHint')}</FieldHint>
          <FieldError id={`${id}-tag-error`}>{errorText('tag')}</FieldError>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-countryCode`}>{t('country')}</Label>
        <Input
          ref={countryRef}
          id={`${id}-countryCode`}
          name="countryCode"
          autoComplete="country"
          className="w-24 font-mono uppercase"
          value={values.countryCode}
          maxLength={2}
          aria-invalid={fieldErrors.countryCode ? true : undefined}
          aria-describedby={describedBy('countryCode')}
          onChange={(e) => set('countryCode', e.target.value.toUpperCase())}
        />
        <FieldHint id={`${id}-countryCode-hint`}>{t('countryHint')}</FieldHint>
        <FieldError id={`${id}-countryCode-error`}>{errorText('countryCode')}</FieldError>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-description`}>{t('descriptionLabel')}</Label>
        <Textarea
          ref={descriptionRef}
          id={`${id}-description`}
          name="description"
          rows={4}
          value={values.description}
          aria-invalid={fieldErrors.description ? true : undefined}
          aria-describedby={describedBy('description')}
          onChange={(e) => set('description', e.target.value)}
        />
        <FieldHint id={`${id}-description-hint`}>
          {t('descriptionHint')}{' '}
          <span className={descriptionLength > TEAM_DESCRIPTION_MAX ? 'text-danger' : undefined}>
            {t('charCount', { count: descriptionLength, max: TEAM_DESCRIPTION_MAX })}
          </span>
        </FieldHint>
        <FieldError id={`${id}-description-error`}>{errorText('description')}</FieldError>
      </div>

      <MutationError failure={failure} conflictMessage={t('submitConflict')} />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
          {pending ? t('submitting') : t('submit')}
        </Button>
        <p id={`${id}-status`} role="status" className="text-sm text-success">
          {submitted ? t('submitted') : null}
        </p>
      </div>
    </form>
  );
}
