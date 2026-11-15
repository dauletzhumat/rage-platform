'use client';

import { useId, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MutationError } from '@/components/states/mutation-error';
import { Button } from '@/components/ui/button';
import { FieldError, FieldHint, Input, Label, Textarea } from '@/components/ui/input';
import { banSteamId } from '@/lib/api/browser';
import type { ApiFailure } from '@/lib/api/types';
import { isValidReason, REASON_MAX } from '@/lib/auth/validation';
import { isIndividualSteamId64 } from '@/lib/steam-id';

/**
 * SUPER_ADMIN: ban a SteamID64 (docs/TOURNAMENTS.md §5). Blocks new registrations, approvals and
 * substitutions containing it; locked rosters are not rewritten silently.
 */
export function BanForm() {
  const t = useTranslations('adminBans');
  const ta = useTranslations('teamActions');
  const router = useRouter();
  const id = useId();
  const [steamId, setSteamId] = useState('');
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState<{ steamId?: boolean; reason?: boolean }>({});
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFailure(null);
    setDone(false);
    const value = steamId.trim();
    const next = { steamId: !isIndividualSteamId64(value), reason: !isValidReason(reason) };
    setInvalid(next);
    if (next.steamId) {
      document.getElementById(`${id}-steam`)?.focus();
      return;
    }
    if (next.reason) {
      document.getElementById(`${id}-reason`)?.focus();
      return;
    }
    startTransition(async () => {
      const result = await banSteamId({ steamId64: value, reason: reason.trim() });
      if (result.ok) {
        setSteamId('');
        setReason('');
        setDone(true);
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" data-testid="ban-form">
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-steam`}>{t('steamId')}</Label>
        <Input
          id={`${id}-steam`}
          className="font-mono sm:w-64"
          inputMode="numeric"
          autoComplete="off"
          value={steamId}
          maxLength={20}
          aria-invalid={invalid.steamId || undefined}
          aria-describedby={`${id}-steam-hint${invalid.steamId ? ` ${id}-steam-error` : ''}`}
          onChange={(e) => setSteamId(e.target.value)}
        />
        <FieldHint id={`${id}-steam-hint`}>{t('steamIdHint')}</FieldHint>
        <FieldError id={`${id}-steam-error`}>
          {invalid.steamId ? t('steamIdInvalid') : null}
        </FieldError>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-reason`}>{ta('reasonLabel')}</Label>
        <Textarea
          id={`${id}-reason`}
          value={reason}
          maxLength={REASON_MAX + 16}
          aria-invalid={invalid.reason || undefined}
          aria-describedby={`${id}-reason-hint${invalid.reason ? ` ${id}-reason-error` : ''}`}
          onChange={(e) => setReason(e.target.value)}
        />
        <FieldHint id={`${id}-reason-hint`}>{ta('reasonHint')}</FieldHint>
        <FieldError id={`${id}-reason-error`}>
          {invalid.reason ? ta('reasonInvalid') : null}
        </FieldError>
      </div>
      <MutationError failure={failure} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="destructive"
          disabled={pending}
          aria-busy={pending || undefined}
        >
          {pending ? ta('working') : t('ban')}
        </Button>
        <p role="status" className="text-sm text-success">
          {done ? t('banned') : null}
        </p>
      </div>
    </form>
  );
}
