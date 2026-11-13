'use client';

import { useId, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MutationError } from '@/components/states/mutation-error';
import { Button } from '@/components/ui/button';
import { FieldError, FieldHint, Input, Label, NativeSelect } from '@/components/ui/input';
import { inviteToTeam } from '@/lib/api/browser';
import { INVITATION_ROLES, type ApiFailure, type InvitationRole } from '@/lib/api/types';
import { validateInvitation } from '@/lib/teams/validation';

/**
 * Invite a registered player by verified SteamID64 (`POST /teams/:teamId/invitations`).
 * The player must have signed in once; they accept or decline in their own session.
 */
export function InviteForm({ teamId, disabled = false }: { teamId: string; disabled?: boolean }) {
  const t = useTranslations('teamManage');
  const tr = useTranslations('roles');
  const router = useRouter();
  const id = useId();
  const [steamId, setSteamId] = useState('');
  const [role, setRole] = useState<InvitationRole>('PLAYER');
  const [invalid, setInvalid] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || disabled) return;
    setFailure(null);
    setSent(false);
    const validation = validateInvitation(steamId, role);
    if (!validation.ok) {
      setInvalid(true);
      inputRef.current?.focus();
      return;
    }
    setInvalid(false);
    startTransition(async () => {
      const result = await inviteToTeam(teamId, validation.value);
      if (result.ok) {
        setSteamId('');
        setSent(true);
        router.refresh();
      } else {
        setFailure(result);
        inputRef.current?.focus();
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-4"
      aria-describedby={`${id}-status`}
      data-testid="invite-form"
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-steam`}>{t('inviteSteamId')}</Label>
          <Input
            ref={inputRef}
            id={`${id}-steam`}
            name="steamId64"
            inputMode="numeric"
            autoComplete="off"
            className="font-mono"
            value={steamId}
            maxLength={20}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={`${id}-steam-hint${invalid ? ` ${id}-steam-error` : ''}`}
            onChange={(e) => {
              setSteamId(e.target.value);
              setSent(false);
            }}
          />
          <FieldHint id={`${id}-steam-hint`}>{t('inviteSteamIdHint')}</FieldHint>
          <FieldError id={`${id}-steam-error`}>
            {invalid ? t('inviteSteamIdInvalid') : null}
          </FieldError>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-role`}>{t('inviteRole')}</Label>
          <NativeSelect
            id={`${id}-role`}
            name="role"
            className="sm:w-40"
            value={role}
            disabled={disabled}
            onChange={(e) => setRole(e.target.value as InvitationRole)}
          >
            {INVITATION_ROLES.map((r) => (
              <option key={r} value={r}>
                {tr(r)}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <MutationError failure={failure} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || disabled} aria-busy={pending || undefined}>
          {pending ? t('inviting') : t('invite')}
        </Button>
        <p id={`${id}-status`} role="status" className="text-sm text-success">
          {sent ? t('inviteSent') : null}
        </p>
      </div>
    </form>
  );
}
