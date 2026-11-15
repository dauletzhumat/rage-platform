import { useTranslations } from 'next-intl';
import { BadgeCheck, Flag, ShieldAlert } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import type {
  MatchResultSource,
  RegistrationStatus,
  RosterEntryRole,
  TournamentRosterStatus,
} from '@/lib/api/types';

const registrationTone: Record<RegistrationStatus, BadgeTone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  WITHDRAWN: 'neutral',
};

const rosterTone: Record<TournamentRosterStatus, BadgeTone> = {
  DRAFT: 'warning',
  LOCKED: 'success',
  SUPERSEDED: 'neutral',
};

/** Registration status as text + colour (never colour alone). Unknown values render neutrally. */
export function RegistrationStatusBadge({ status }: { status: RegistrationStatus }) {
  const t = useTranslations('registrationStatus');
  const tone = registrationTone[status];
  return (
    <Badge tone={tone ?? 'neutral'} data-status={status}>
      {tone ? t(status) : status}
    </Badge>
  );
}

export function RosterStatusBadge({ status }: { status: TournamentRosterStatus }) {
  const t = useTranslations('rosterStatus');
  const tone = rosterTone[status];
  return (
    <Badge tone={tone ?? 'neutral'} data-status={status}>
      {tone ? t(status) : status}
    </Badge>
  );
}

export function RosterRoleBadge({ role }: { role: RosterEntryRole }) {
  const t = useTranslations('rosterEntryRole');
  return (
    <Badge tone={role === 'STARTER' ? 'outline' : 'neutral'}>
      {role === 'STARTER' || role === 'SUBSTITUTE' ? t(role) : role}
    </Badge>
  );
}

/**
 * How a match result was decided (docs/TOURNAMENTS.md §1, §9). Admin overrides and forfeits are
 * never presented as server-verified. `compact` shows a short label with the full text for
 * screen readers and as a tooltip.
 */
export function ResultSourceBadge({
  source,
  compact = false,
}: {
  source: MatchResultSource | null;
  compact?: boolean;
}) {
  const t = useTranslations('resultSource');
  if (source === 'ADMIN_OVERRIDE') {
    return (
      <Badge tone="warning" data-result-source={source} title={t('ADMIN_OVERRIDE')}>
        <ShieldAlert aria-hidden="true" />
        {compact ? (
          <>
            <span aria-hidden="true">{t('adminShort')}</span>
            <span className="sr-only">{t('ADMIN_OVERRIDE')}</span>
          </>
        ) : (
          t('ADMIN_OVERRIDE')
        )}
      </Badge>
    );
  }
  if (source === 'FORFEIT') {
    return (
      <Badge tone="danger" data-result-source={source}>
        <Flag aria-hidden="true" />
        {t('FORFEIT')}
      </Badge>
    );
  }
  if (source === 'SERVER') {
    return (
      <Badge tone="success" data-result-source={source}>
        <BadgeCheck aria-hidden="true" />
        {t('SERVER')}
      </Badge>
    );
  }
  return null;
}
