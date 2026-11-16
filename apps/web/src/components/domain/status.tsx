import { useTranslations } from 'next-intl';
import { matchStatusTone, StatusPill, tournamentStatusTone } from '@/components/ui/status-pill';
import { isSeriesMatchStatus, type MatchStatus, type TournamentStatus } from '@/lib/api/types';

/** Series status pill. Non-series values (legacy `KNIFE` / `MAP_FINISHED`) render as "Unknown". */
export function MatchStatusPill({ status }: { status: MatchStatus }) {
  const t = useTranslations('matchStatus');
  const tm = useTranslations('matches');
  if (!isSeriesMatchStatus(status)) {
    return <StatusPill tone="neutral" label={tm('statusUnknown')} data-status={status} />;
  }
  return <StatusPill tone={matchStatusTone(status)} label={t(status)} pulse={status === 'LIVE'} />;
}

export function TournamentStatusPill({ status }: { status: TournamentStatus }) {
  const t = useTranslations('tournamentStatus');
  return <StatusPill tone={tournamentStatusTone(status)} label={t(status)} />;
}
