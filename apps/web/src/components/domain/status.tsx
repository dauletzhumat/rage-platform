import { useTranslations } from 'next-intl';
import { matchStatusTone, StatusPill, tournamentStatusTone } from '@/components/ui/status-pill';
import type { MatchStatus, TournamentStatus } from '@/lib/api/types';

export function MatchStatusPill({ status }: { status: MatchStatus }) {
  const t = useTranslations('matchStatus');
  return <StatusPill tone={matchStatusTone(status)} label={t(status)} pulse={status === 'LIVE'} />;
}

export function TournamentStatusPill({ status }: { status: TournamentStatus }) {
  const t = useTranslations('tournamentStatus');
  return <StatusPill tone={tournamentStatusTone(status)} label={t(status)} />;
}
