import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { FormattedDate, InitialsAvatar } from '@/components/domain/formatting';
import { Badge } from '@/components/ui/badge';
import { SampleDataBadge } from '@/components/ui/sample-data-badge';
import type { PublicTournamentTeamDto } from '@/lib/api/types';
import { SLUG_PATTERN_CLIENT } from '@/lib/tournaments/slug';

/** The tournament's 7-map pool (admin-supplied; the platform ships no default pool). */
export function MapPoolList({ maps }: { maps: readonly string[] }) {
  const t = useTranslations('tournaments');
  return (
    <ul aria-label={t('mapPool')} className="flex flex-wrap gap-2" data-testid="map-pool">
      {maps.map((map) => (
        <li
          key={map}
          className="rounded-md border border-border bg-raised px-2.5 py-1 font-mono text-xs text-foreground"
        >
          {map}
        </li>
      ))}
    </ul>
  );
}

/**
 * Approved teams with their current LOCKED roster snapshot (nickname at registration time).
 * Snapshot nicknames are shown as stored, even if the player renamed later (A5).
 */
export function ApprovedTeams({ teams }: { teams: readonly PublicTournamentTeamDto[] }) {
  const t = useTranslations('tournaments');
  const sorted = [...teams].sort(
    (a, b) => (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER),
  );
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="approved-teams">
      {sorted.map((entry) => {
        const starters = entry.roster.entries.filter((e) => e.role === 'STARTER');
        const subs = entry.roster.entries.filter((e) => e.role === 'SUBSTITUTE');
        const teamHref = SLUG_PATTERN_CLIENT.test(entry.team.slug)
          ? `/teams/${encodeURIComponent(entry.team.slug)}`
          : null;
        const headingId = `team-${entry.registrationId}`;
        return (
          <li
            key={entry.registrationId}
            aria-labelledby={headingId}
            className="rounded-lg border border-border bg-surface"
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              {entry.seed !== null ? (
                <span className="font-mono text-xs text-muted" title={t('seed')}>
                  #{entry.seed}
                  <span className="sr-only"> {t('seed')}</span>
                </span>
              ) : null}
              <InitialsAvatar label={entry.team.name} size="sm" square />
              <h3 id={headingId} className="min-w-0 truncate text-sm font-semibold">
                {teamHref ? (
                  <Link href={teamHref} className="hover:text-accent-text hover:underline">
                    {entry.team.name}
                  </Link>
                ) : (
                  entry.team.name
                )}
              </h3>
              <Badge tone="outline" className="font-mono">
                {entry.team.tag}
              </Badge>
              {entry.isSample ? <SampleDataBadge /> : null}
            </div>
            <div className="space-y-2 px-3 py-2">
              <RosterList entries={starters} label={t('starters')} />
              {subs.length > 0 ? <RosterList entries={subs} label={t('substitutes')} /> : null}
              <p className="flex items-center gap-1 text-[11px] text-muted">
                <Lock aria-hidden="true" className="size-3" />
                {t('rosterLocked', { version: entry.roster.version })}{' '}
                <FormattedDate value={entry.roster.lockedAt} />
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function RosterList({
  entries,
  label,
}: {
  entries: PublicTournamentTeamDto['roster']['entries'];
  label: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {entries.map((player) => (
          <li
            key={`${player.playerSlug}-${player.role}`}
            className="inline-flex items-center gap-1"
          >
            {SLUG_PATTERN_CLIENT.test(player.playerSlug) ? (
              <Link
                href={`/players/${encodeURIComponent(player.playerSlug)}`}
                className="hover:text-accent-text hover:underline"
              >
                {player.nicknameSnapshot}
              </Link>
            ) : (
              player.nicknameSnapshot
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
