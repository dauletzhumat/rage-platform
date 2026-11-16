'use client';

import { useTranslations } from 'next-intl';
import { ActionDialog } from '@/components/teams/action-dialog';
import {
  approveRegistration,
  changeTournamentStatus,
  generateBracket,
  liftSteamBan,
  rejectRegistration,
  withdrawRegistration,
} from '@/lib/api/browser';
import type { TournamentStatus } from '@/lib/api/types';
import { isValidReason } from '@/lib/auth/validation';
import { isValidOptionalNote } from '@/lib/teams/validation';
import { useReasonPresets } from './reason-presets';

/**
 * M3 confirmation buttons (docs/TOURNAMENTS.md §3–§6). Each confirmation is one user intent: the
 * browser client attaches CSRF + a fresh Idempotency-Key; the API authorises, validates and
 * audits. On success Server Components are refreshed — no optimistic state.
 */

export function WithdrawRegistrationButton({
  tournamentId,
  registrationId,
  teamName,
}: {
  tournamentId: string;
  registrationId: string;
  teamName: string;
}) {
  const t = useTranslations('tournamentRegister');
  const ta = useTranslations('teamActions');
  return (
    <ActionDialog
      triggerLabel={t('withdraw')}
      triggerAriaLabel={t('withdrawNamed', { team: teamName })}
      triggerVariant="destructive"
      title={t('withdrawTitle', { team: teamName })}
      description={t('withdrawDescription')}
      confirmLabel={t('withdraw')}
      pendingLabel={ta('working')}
      destructive
      onConfirm={() => withdrawRegistration(tournamentId, registrationId)}
      testId="withdraw-registration"
    />
  );
}

export function ApproveRegistrationButton({
  tournamentId,
  registrationId,
  teamName,
}: {
  tournamentId: string;
  registrationId: string;
  teamName: string;
}) {
  const t = useTranslations('adminTournaments');
  const ta = useTranslations('teamActions');
  return (
    <ActionDialog
      triggerLabel={ta('approve')}
      triggerAriaLabel={t('approveNamed', { team: teamName })}
      triggerVariant="primary"
      title={t('approveTitle', { team: teamName })}
      description={t('approveDescription')}
      confirmLabel={ta('approve')}
      pendingLabel={ta('working')}
      reason={{
        label: ta('noteLabel'),
        hint: ta('noteHint'),
        invalidMessage: ta('noteInvalid'),
        validate: isValidOptionalNote,
      }}
      onConfirm={(note) => approveRegistration(tournamentId, registrationId, note ? { note } : {})}
    />
  );
}

export function RejectRegistrationButton({
  tournamentId,
  registrationId,
  teamName,
  demoPrefill = false,
}: {
  tournamentId: string;
  registrationId: string;
  teamName: string;
  /** Demo mode on a sample tournament: start with the "Demo test" reason. */
  demoPrefill?: boolean;
}) {
  const t = useTranslations('adminTournaments');
  const ta = useTranslations('teamActions');
  const presets = useReasonPresets('reject', demoPrefill);
  return (
    <ActionDialog
      triggerLabel={ta('reject')}
      triggerAriaLabel={t('rejectNamed', { team: teamName })}
      triggerVariant="destructive"
      title={t('rejectTitle', { team: teamName })}
      description={t('rejectDescription')}
      confirmLabel={ta('reject')}
      pendingLabel={ta('working')}
      destructive
      reason={{
        label: ta('reasonLabel'),
        hint: ta('reasonHint'),
        invalidMessage: ta('reasonInvalid'),
        validate: isValidReason,
        presets: presets.presets,
        initialValue: presets.initial,
      }}
      onConfirm={(reason) => rejectRegistration(tournamentId, registrationId, { reason })}
    />
  );
}

/** One allowed manual transition (§3). Cancelling requires a reason. */
export function TournamentStatusButton({
  tournamentId,
  tournamentName,
  to,
  demoPrefill = false,
}: {
  tournamentId: string;
  tournamentName: string;
  to: TournamentStatus;
  demoPrefill?: boolean;
}) {
  const t = useTranslations('adminTournaments');
  const ts = useTranslations('tournamentStatus');
  const ta = useTranslations('teamActions');
  const cancel = to === 'CANCELLED';
  const presets = useReasonPresets('cancel', demoPrefill);
  return (
    <ActionDialog
      triggerLabel={t('moveTo', { status: ts(to) })}
      triggerVariant={cancel ? 'destructive' : 'secondary'}
      title={t('moveToTitle', { name: tournamentName, status: ts(to) })}
      description={cancel ? t('cancelDescription') : t('moveToDescription')}
      confirmLabel={t('moveTo', { status: ts(to) })}
      pendingLabel={ta('working')}
      destructive={cancel}
      {...(cancel
        ? {
            reason: {
              label: ta('reasonLabel'),
              hint: ta('reasonHint'),
              invalidMessage: ta('reasonInvalid'),
              validate: isValidReason,
              presets: presets.presets,
              initialValue: presets.initial,
            },
          }
        : {})}
      onConfirm={(reason) => changeTournamentStatus(tournamentId, cancel ? { to, reason } : { to })}
      testId={`status-${to}`}
    />
  );
}

export function GenerateBracketButton({
  tournamentId,
  approvedCount,
}: {
  tournamentId: string;
  approvedCount: number;
}) {
  const t = useTranslations('adminTournaments');
  const ta = useTranslations('teamActions');
  return (
    <ActionDialog
      triggerLabel={t('generateBracket')}
      triggerVariant="primary"
      triggerDisabled={approvedCount < 2}
      title={t('generateBracketTitle')}
      description={t('generateBracketDescription', { count: approvedCount })}
      confirmLabel={t('generateBracket')}
      pendingLabel={ta('working')}
      onConfirm={() => generateBracket(tournamentId)}
      testId="generate-bracket"
    />
  );
}

export function LiftBanButton({ banId, steamId64 }: { banId: string; steamId64: string }) {
  const t = useTranslations('adminBans');
  const ta = useTranslations('teamActions');
  const presets = useReasonPresets('lift');
  return (
    <ActionDialog
      triggerLabel={t('lift')}
      triggerAriaLabel={t('liftNamed', { steamId: steamId64 })}
      triggerVariant="secondary"
      title={t('liftTitle', { steamId: steamId64 })}
      description={t('liftDescription')}
      confirmLabel={t('lift')}
      pendingLabel={ta('working')}
      reason={{
        label: ta('reasonLabel'),
        hint: ta('reasonHint'),
        invalidMessage: ta('reasonInvalid'),
        validate: isValidReason,
        presets: presets.presets,
      }}
      onConfirm={(reason) => liftSteamBan(banId, { reason })}
    />
  );
}
