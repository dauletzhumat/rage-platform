'use client';

import { useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MutationError } from '@/components/states/mutation-error';
import { Button } from '@/components/ui/button';
import { FieldError, FieldHint, Input, Label, Textarea } from '@/components/ui/input';
import { updateProfile } from '@/lib/api/browser';
import type { ApiFailure } from '@/lib/api/types';
import {
  BIOGRAPHY_MAX,
  NICKNAME_MAX,
  profileFieldOf,
  validateProfile,
  type ProfileErrorCode,
  type ProfileField,
  type ProfileFormInput,
} from '@/lib/auth/validation';

type FieldErrors = Partial<Record<ProfileField, { code?: ProfileErrorCode; server?: string }>>;

/**
 * Edit the RAGE profile (`PATCH /me/profile`, credentials + CSRF). Client-side checks mirror the
 * API rules for fast feedback; the API re-validates and its `details[]` are shown per field.
 */
export function ProfileForm({ initial }: { initial: ProfileFormInput }) {
  const t = useTranslations('me');
  const router = useRouter();
  const id = useId();
  const [values, setValues] = useState<ProfileFormInput>(initial);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const nicknameRef = useRef<HTMLInputElement>(null);
  const countryRef = useRef<HTMLInputElement>(null);
  const biographyRef = useRef<HTMLTextAreaElement>(null);

  function set<K extends keyof ProfileFormInput>(key: K, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    setSaved(false);
  }

  /** Move focus to the first invalid field (event handlers only). */
  function focusFirst(errors: FieldErrors) {
    if (errors.nickname) nicknameRef.current?.focus();
    else if (errors.countryCode) countryRef.current?.focus();
    else if (errors.biography) biographyRef.current?.focus();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    setFailure(null);
    const validation = validateProfile(values);
    if (!validation.ok) {
      const errors: FieldErrors = {};
      for (const [field, code] of Object.entries(validation.errors)) {
        errors[field as ProfileField] = { code };
      }
      setFieldErrors(errors);
      focusFirst(errors);
      return;
    }
    setFieldErrors({});
    startTransition(async () => {
      const result = await updateProfile(validation.value);
      if (result.ok) {
        setValues({
          nickname: result.data.profile.nickname,
          countryCode: result.data.profile.countryCode ?? '',
          biography: result.data.profile.biography ?? '',
        });
        setSaved(true);
        router.refresh();
        return;
      }
      if (result.kind === 'validation' && result.details) {
        const errors: FieldErrors = {};
        for (const detail of result.details) {
          const field = profileFieldOf(detail.field);
          if (field && !errors[field]) errors[field] = { server: detail.message };
        }
        setFieldErrors(errors);
        focusFirst(errors);
      }
      setFailure(result);
    });
  }

  function errorText(field: ProfileField): string | null {
    const error = fieldErrors[field];
    if (!error) return null;
    return error.code ? t(`errors.${error.code}`) : (error.server ?? null);
  }

  function describedBy(field: ProfileField): string {
    return `${id}-${field}-hint${fieldErrors[field] ? ` ${id}-${field}-error` : ''}`;
  }

  const bioLength = Array.from(values.biography).length;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5" aria-describedby={`${id}-status`}>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-nickname`}>{t('nickname')}</Label>
        <Input
          ref={nicknameRef}
          id={`${id}-nickname`}
          name="nickname"
          autoComplete="nickname"
          value={values.nickname}
          maxLength={NICKNAME_MAX + 8}
          required
          aria-invalid={fieldErrors.nickname ? true : undefined}
          aria-describedby={describedBy('nickname')}
          onChange={(e) => set('nickname', e.target.value)}
        />
        <FieldHint id={`${id}-nickname-hint`}>{t('nicknameHint')}</FieldHint>
        <FieldError id={`${id}-nickname-error`}>{errorText('nickname')}</FieldError>
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
        <Label htmlFor={`${id}-biography`}>{t('biography')}</Label>
        <Textarea
          ref={biographyRef}
          id={`${id}-biography`}
          name="biography"
          rows={4}
          value={values.biography}
          aria-invalid={fieldErrors.biography ? true : undefined}
          aria-describedby={describedBy('biography')}
          onChange={(e) => set('biography', e.target.value)}
        />
        <FieldHint id={`${id}-biography-hint`}>
          {t('biographyHint')}{' '}
          <span className={bioLength > BIOGRAPHY_MAX ? 'text-danger' : undefined}>
            {t('charCount', { count: bioLength, max: BIOGRAPHY_MAX })}
          </span>
        </FieldHint>
        <FieldError id={`${id}-biography-error`}>{errorText('biography')}</FieldError>
      </div>

      <MutationError failure={failure} conflictMessage={t('saveConflict')} />

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
          {pending ? t('saving') : t('save')}
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setValues(initial);
            setFieldErrors({});
            setFailure(null);
            setSaved(false);
          }}
        >
          {t('reset')}
        </Button>
        <p id={`${id}-status`} role="status" className="text-sm text-success">
          {saved ? t('saved') : null}
        </p>
      </div>
    </form>
  );
}
