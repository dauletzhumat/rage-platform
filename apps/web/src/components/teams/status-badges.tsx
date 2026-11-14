import { useTranslations } from 'next-intl';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import type { InvitationStatus, TeamApplicationStatus } from '@/lib/api/types';

const applicationTone: Record<TeamApplicationStatus, BadgeTone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'neutral',
};

const invitationTone: Record<InvitationStatus, BadgeTone> = {
  PENDING: 'warning',
  ACCEPTED: 'success',
  DECLINED: 'neutral',
  REVOKED: 'danger',
  EXPIRED: 'neutral',
};

/** Application status as text + colour (never colour alone). Unknown values render neutrally. */
export function ApplicationStatusBadge({ status }: { status: TeamApplicationStatus }) {
  const t = useTranslations('applicationStatus');
  const tone = applicationTone[status];
  return (
    <Badge tone={tone ?? 'neutral'} data-status={status}>
      {tone ? t(status) : status}
    </Badge>
  );
}

export function InvitationStatusBadge({ status }: { status: InvitationStatus }) {
  const t = useTranslations('invitationStatus');
  const tone = invitationTone[status];
  return (
    <Badge tone={tone ?? 'neutral'} data-status={status}>
      {tone ? t(status) : status}
    </Badge>
  );
}
