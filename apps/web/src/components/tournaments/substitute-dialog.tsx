'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FieldError, FieldHint, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { substituteRegistrationPlayer } from '@/lib/api/browser';
import type { RosterEntryRole } from '@/lib/api/types';
import { isValidReason, REASON_MAX } from '@/lib/auth/validation';
import { FormDialog } from './form-dialog';
import { ReasonPresetChips, useReasonPresets } from './reason-presets';

export interface SubstitutePlayer {
  userId: string;
  nickname: string;
}

/**
 * Admin substitution after lock (docs/TOURNAMENTS.md §4): replaces one snapshot entry with a
 * current team member, creating a new LOCKED roster version. Allowed only before the team's first
 * completed match — the API enforces (SUBSTITUTION_NOT_ALLOWED) and audits.
 */
export function SubstituteDialog({
  tournamentId,
  registrationId,
  teamName,
  roster,
  candidates,
  demoPrefill = false,
}: {
  tournamentId: string;
  registrationId: string;
  teamName: string;
  roster: Array<SubstitutePlayer & { role: RosterEntryRole }>;
  /** Current team members not on the locked roster. */
  candidates: SubstitutePlayer[];
  /** Demo mode on a sample tournament: start with the "Demo test" reason. */
  demoPrefill?: boolean;
}) {
  const t = useTranslations('adminTournaments');
  const ta = useTranslations('teamActions');
  const tr = useTranslations('rosterEntryRole');
  const id = useId();
  const presets = useReasonPresets('substitute', demoPrefill);
  const [outId, setOutId] = useState('');
  const [inId, setInId] = useState('');
  const [role, setRole] = useState<RosterEntryRole>('STARTER');
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState<{ out?: boolean; in?: boolean; reason?: boolean }>({});

  function reset() {
    setOutId('');
    setInId('');
    setRole('STARTER');
    setReason('');
    setInvalid({});
  }

  function submit() {
    const next = {
      out: !roster.some((p) => p.userId === outId),
      in: !candidates.some((p) => p.userId === inId),
      reason: !isValidReason(reason),
    };
    setInvalid(next);
    if (next.out || next.in || next.reason) return null;
    return substituteRegistrationPlayer(tournamentId, registrationId, {
      outUserId: outId,
      inUserId: inId,
      role,
      reason: reason.trim(),
    });
  }

  return (
    <FormDialog
      triggerLabel={t('substitute')}
      triggerAriaLabel={t('substituteNamed', { team: teamName })}
      title={t('substituteTitle', { team: teamName })}
      description={t('substituteDescription')}
      confirmLabel={t('substitute')}
      pendingLabel={ta('working')}
      triggerDisabled={candidates.length === 0}
      onSubmit={submit}
      onReset={reset}
      onOpen={() => setReason(presets.initial)}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-out`}>{t('playerOut')}</Label>
        <NativeSelect
          id={`${id}-out`}
          value={outId}
          aria-invalid={invalid.out || undefined}
          aria-describedby={invalid.out ? `${id}-out-error` : undefined}
          onChange={(e) => {
            setOutId(e.target.value);
            const entry = roster.find((p) => p.userId === e.target.value);
            if (entry) setRole(entry.role);
          }}
        >
          <option value="">{t('choosePlayer')}</option>
          {roster.map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.nickname} — {tr(p.role)}
            </option>
          ))}
        </NativeSelect>
        <FieldError id={`${id}-out-error`}>{invalid.out ? t('playerRequired') : null}</FieldError>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-in`}>{t('playerIn')}</Label>
        <NativeSelect
          id={`${id}-in`}
          value={inId}
          aria-invalid={invalid.in || undefined}
          aria-describedby={`${id}-in-hint${invalid.in ? ` ${id}-in-error` : ''}`}
          onChange={(e) => setInId(e.target.value)}
        >
          <option value="">{t('choosePlayer')}</option>
          {candidates.map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.nickname}
            </option>
          ))}
        </NativeSelect>
        <FieldHint id={`${id}-in-hint`}>{t('playerInHint')}</FieldHint>
        <FieldError id={`${id}-in-error`}>{invalid.in ? t('playerRequired') : null}</FieldError>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-role`}>{t('substituteRole')}</Label>
        <NativeSelect
          id={`${id}-role`}
          value={role}
          onChange={(e) => setRole(e.target.value === 'SUBSTITUTE' ? 'SUBSTITUTE' : 'STARTER')}
        >
          <option value="STARTER">{tr('STARTER')}</option>
          <option value="SUBSTITUTE">{tr('SUBSTITUTE')}</option>
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-reason`}>{ta('reasonLabel')}</Label>
        <ReasonPresetChips presets={presets.presets} current={reason} onPick={setReason} />
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
    </FormDialog>
  );
}
