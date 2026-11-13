'use client';

import { useTranslations } from 'next-intl';
import {
  acceptInvitation,
  approveTeamApplication,
  declineInvitation,
  leaveTeam,
  rejectTeamApplication,
  removeTeamMember,
  revokeTeamInvitation,
  transferCaptain,
  withdrawTeamApplication,
} from '@/lib/api/browser';
import { isValidReason } from '@/lib/auth/validation';
import { isValidOptionalNote } from '@/lib/teams/validation';
import { ActionDialog } from './action-dialog';

/**
 * Per-item mutation buttons for M2 (docs/TEAMS.md §4). Each confirmation is one user intent;
 * the browser client attaches CSRF + a fresh Idempotency-Key, the API authorises and audits.
 * On success the route's Server Components are refreshed (no optimistic fake state).
 */

export function WithdrawApplicationButton({
  applicationId,
  teamName,
}: {
  applicationId: string;
  teamName: string;
}) {
  const t = useTranslations('teamActions');
  return (
    <ActionDialog
      triggerLabel={t('withdraw')}
      triggerAriaLabel={t('withdrawNamed', { name: teamName })}
      title={t('withdrawTitle', { name: teamName })}
      description={t('withdrawDescription')}
      confirmLabel={t('withdraw')}
      pendingLabel={t('working')}
      destructive
      onConfirm={() => withdrawTeamApplication(applicationId)}
    />
  );
}

export function AcceptInvitationButton({
  invitationId,
  teamName,
}: {
  invitationId: string;
  teamName: string;
}) {
  const t = useTranslations('teamActions');
  return (
    <ActionDialog
      triggerLabel={t('accept')}
      triggerAriaLabel={t('acceptNamed', { name: teamName })}
      triggerVariant="primary"
      title={t('acceptTitle', { name: teamName })}
      description={t('acceptDescription')}
      confirmLabel={t('accept')}
      pendingLabel={t('working')}
      onConfirm={() => acceptInvitation(invitationId)}
    />
  );
}

export function DeclineInvitationButton({
  invitationId,
  teamName,
}: {
  invitationId: string;
  teamName: string;
}) {
  const t = useTranslations('teamActions');
  return (
    <ActionDialog
      triggerLabel={t('decline')}
      triggerAriaLabel={t('declineNamed', { name: teamName })}
      triggerVariant="ghost"
      title={t('declineTitle', { name: teamName })}
      description={t('declineDescription')}
      confirmLabel={t('decline')}
      pendingLabel={t('working')}
      destructive
      onConfirm={() => declineInvitation(invitationId)}
    />
  );
}

export function LeaveTeamButton({ teamId, teamName }: { teamId: string; teamName: string }) {
  const t = useTranslations('teamActions');
  return (
    <ActionDialog
      triggerLabel={t('leave')}
      triggerAriaLabel={t('leaveNamed', { name: teamName })}
      triggerVariant="destructive"
      title={t('leaveTitle', { name: teamName })}
      description={t('leaveDescription')}
      confirmLabel={t('leave')}
      pendingLabel={t('working')}
      destructive
      onConfirm={() => leaveTeam(teamId)}
      testId="leave-team"
    />
  );
}

/** Read-only application text inside review dialogs (the table hides it on small screens). */
function ApplicationSummary({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <p className="max-h-40 overflow-y-auto whitespace-pre-line break-words rounded-md border border-border bg-raised p-3 text-sm">
      {text}
    </p>
  );
}

export function ApproveApplicationButton({
  applicationId,
  teamName,
  teamTag,
  summary,
}: {
  applicationId: string;
  teamName: string;
  teamTag: string;
  summary?: string | null;
}) {
  const t = useTranslations('teamActions');
  return (
    <ActionDialog
      triggerLabel={t('approve')}
      triggerAriaLabel={t('approveNamed', { name: teamName })}
      triggerVariant="primary"
      title={t('approveTitle', { name: teamName, tag: teamTag })}
      description={t('approveDescription')}
      confirmLabel={t('approve')}
      pendingLabel={t('working')}
      reason={{
        label: t('noteLabel'),
        hint: t('noteHint'),
        invalidMessage: t('noteInvalid'),
        validate: isValidOptionalNote,
      }}
      onConfirm={(note) => approveTeamApplication(applicationId, note ? { note } : {})}
    >
      <ApplicationSummary text={summary} />
    </ActionDialog>
  );
}

export function RejectApplicationButton({
  applicationId,
  teamName,
  summary,
}: {
  applicationId: string;
  teamName: string;
  summary?: string | null;
}) {
  const t = useTranslations('teamActions');
  return (
    <ActionDialog
      triggerLabel={t('reject')}
      triggerAriaLabel={t('rejectNamed', { name: teamName })}
      triggerVariant="destructive"
      title={t('rejectTitle', { name: teamName })}
      description={t('rejectDescription')}
      confirmLabel={t('reject')}
      pendingLabel={t('working')}
      destructive
      reason={{
        label: t('reasonLabel'),
        hint: t('reasonHint'),
        invalidMessage: t('reasonInvalid'),
        validate: isValidReason,
      }}
      onConfirm={(reason) => rejectTeamApplication(applicationId, { reason })}
    >
      <ApplicationSummary text={summary} />
    </ActionDialog>
  );
}

export function RevokeInvitationButton({
  teamId,
  invitationId,
  nickname,
}: {
  teamId: string;
  invitationId: string;
  nickname: string;
}) {
  const t = useTranslations('teamActions');
  return (
    <ActionDialog
      triggerLabel={t('revoke')}
      triggerAriaLabel={t('revokeNamed', { name: nickname })}
      triggerVariant="ghost"
      title={t('revokeTitle', { name: nickname })}
      description={t('revokeDescription')}
      confirmLabel={t('revoke')}
      pendingLabel={t('working')}
      destructive
      reason={{
        label: t('optionalReasonLabel'),
        hint: t('noteHint'),
        invalidMessage: t('noteInvalid'),
        validate: isValidOptionalNote,
      }}
      onConfirm={(reason) => revokeTeamInvitation(teamId, invitationId, reason ? { reason } : {})}
    />
  );
}

export function RemoveMemberButton({
  teamId,
  userId,
  nickname,
}: {
  teamId: string;
  userId: string;
  nickname: string;
}) {
  const t = useTranslations('teamActions');
  return (
    <ActionDialog
      triggerLabel={t('remove')}
      triggerAriaLabel={t('removeNamed', { name: nickname })}
      triggerVariant="ghost"
      title={t('removeTitle', { name: nickname })}
      description={t('removeDescription')}
      confirmLabel={t('remove')}
      pendingLabel={t('working')}
      destructive
      reason={{
        label: t('reasonLabel'),
        hint: t('reasonHint'),
        invalidMessage: t('reasonInvalid'),
        validate: isValidReason,
      }}
      onConfirm={(reason) => removeTeamMember(teamId, userId, { reason })}
    />
  );
}

export function MakeCaptainButton({
  teamId,
  userId,
  nickname,
}: {
  teamId: string;
  userId: string;
  nickname: string;
}) {
  const t = useTranslations('teamActions');
  return (
    <ActionDialog
      triggerLabel={t('makeCaptain')}
      triggerAriaLabel={t('makeCaptainNamed', { name: nickname })}
      triggerVariant="secondary"
      title={t('makeCaptainTitle', { name: nickname })}
      description={t('makeCaptainDescription')}
      confirmLabel={t('makeCaptain')}
      pendingLabel={t('working')}
      onConfirm={() => transferCaptain(teamId, { newCaptainUserId: userId })}
    />
  );
}
