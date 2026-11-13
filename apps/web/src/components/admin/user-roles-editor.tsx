'use client';

import { useId, useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { RoleChip } from '@/components/domain/role-chip';
import { MutationError } from '@/components/states/mutation-error';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FieldError, FieldHint, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { grantRole, revokeRole } from '@/lib/api/browser';
import type { ApiFailure, RoleGrantDto, RoleType } from '@/lib/api/types';
import { GRANTABLE_ROLES } from '@/lib/auth/roles';
import { isValidReason, REASON_MAX } from '@/lib/auth/validation';

interface EditorUser {
  id: string;
  nickname: string;
}

/**
 * Active role grants of one user with Grant / Revoke dialogs (SUPER_ADMIN UI).
 * Every mutation sends the CSRF header; the API authorises, audits and may reject (409).
 */
export function UserRolesEditor({ user, grants }: { user: EditorUser; grants: RoleGrantDto[] }) {
  const t = useTranslations('admin');
  const active = grants.filter((g) => g.revokedAt === null);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {active.length === 0 ? <span className="text-xs text-muted">{t('noRoles')}</span> : null}
      {active.map((grant) => (
        <span key={grant.id} className="inline-flex items-center gap-0.5">
          <RoleChip role={grant.role} scopeType={grant.scopeType} />
          <RevokeRoleDialog user={user} grant={grant} />
        </span>
      ))}
      <GrantRoleDialog user={user} />
    </div>
  );
}

function useMutation() {
  const router = useRouter();
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [pending, startTransition] = useTransition();
  return { router, failure, setFailure, pending, startTransition };
}

function GrantRoleDialog({ user }: { user: EditorUser }) {
  const t = useTranslations('admin');
  const tr = useTranslations('roleNames');
  const ts = useTranslations('scopeNames');
  const id = useId();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<RoleType>('TOURNAMENT_ADMIN');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const { router, failure, setFailure, pending, startTransition } = useMutation();

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setReason('');
      setReasonError(false);
      setFailure(null);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidReason(reason)) {
      setReasonError(true);
      return;
    }
    setReasonError(false);
    startTransition(async () => {
      const result = await grantRole(user.id, { role, scopeType: 'GLOBAL', reason: reason.trim() });
      if (result.ok) {
        reset(false);
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5"
          aria-label={t('grantRoleTo', { name: user.nickname })}
        >
          <Plus aria-hidden="true" />
          <span className="hidden xl:inline">{t('grantRole')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('cancel')}>
        <DialogTitle>{t('grantRoleTo', { name: user.nickname })}</DialogTitle>
        <DialogDescription>{t('grantDescription')}</DialogDescription>
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-role`}>{t('role')}</Label>
            <NativeSelect
              id={`${id}-role`}
              value={role}
              onChange={(e) => setRole(e.target.value as RoleType)}
            >
              {GRANTABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {tr(r)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <span className="text-sm font-medium">{t('scope')}</span>
            <p className="text-sm text-muted">{ts('GLOBAL')}</p>
          </div>
          <ReasonField
            id={`${id}-reason`}
            value={reason}
            onChange={setReason}
            invalid={reasonError}
          />
          <MutationError failure={failure} conflictMessage={t('grantConflict')} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => reset(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
              {pending ? t('granting') : t('grant')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RevokeRoleDialog({ user, grant }: { user: EditorUser; grant: RoleGrantDto }) {
  const t = useTranslations('admin');
  const tr = useTranslations('roleNames');
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const { router, failure, setFailure, pending, startTransition } = useMutation();
  const label = t('revokeRole', { role: tr(grant.role), name: user.nickname });

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setReason('');
      setReasonError(false);
      setFailure(null);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidReason(reason)) {
      setReasonError(true);
      return;
    }
    setReasonError(false);
    startTransition(async () => {
      const result = await revokeRole(user.id, grant.id, { reason: reason.trim() });
      if (result.ok) {
        reset(false);
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-6" aria-label={label}>
          <X aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('cancel')}>
        <DialogTitle>{label}</DialogTitle>
        <DialogDescription>{t('revokeDescription')}</DialogDescription>
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <ReasonField
            id={`${id}-reason`}
            value={reason}
            onChange={setReason}
            invalid={reasonError}
          />
          <MutationError failure={failure} conflictMessage={t('revokeConflict')} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => reset(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={pending}
              aria-busy={pending || undefined}
            >
              {pending ? t('revoking') : t('revoke')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
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
  const t = useTranslations('admin');
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t('reason')}</Label>
      <Textarea
        id={id}
        value={value}
        required
        maxLength={REASON_MAX}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-hint${invalid ? ` ${id}-error` : ''}`}
        onChange={(e) => onChange(e.target.value)}
      />
      <FieldHint id={`${id}-hint`}>{t('reasonHint')}</FieldHint>
      <FieldError id={`${id}-error`}>{invalid ? t('reasonInvalid') : null}</FieldError>
    </div>
  );
}
