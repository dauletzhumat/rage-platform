import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { CalendarClock, Lock } from 'lucide-react';
import { FormattedDate, InitialsAvatar } from '@/components/domain/formatting';
import { Badge } from '@/components/ui/badge';
import { SampleDataBadge } from '@/components/ui/sample-data-badge';
import type { PublicTournamentTeamDto, TournamentStatus } from '@/lib/api/types';
import { DISPLAY_TIMEZONE_LABEL } from '@/lib/display-time';
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

export type RegistrationWindowState =
  'open' | 'notYetOpen' | 'closedWindow' | 'unavailable' | 'notOpenStatus';

/**
 * Why registration is (not) accepting entries, from the API's `registrationOpen` (status
 * REGISTRATION_OPEN and now() inside the optional window) plus the window bounds.
 */
export function registrationWindowState(
  t: {
    status: TournamentStatus;
    registrationOpen: boolean;
    registrationOpenAt: string | null;
    registrationCloseAt: string | null;
  },
  now: number,
): RegistrationWindowState {
  if (t.status !== 'REGISTRATION_OPEN') return 'notOpenStatus';
  if (t.registrationOpen) return 'open';
  const openAt = t.registrationOpenAt ? Date.parse(t.registrationOpenAt) : NaN;
  const closeAt = t.registrationCloseAt ? Date.parse(t.registrationCloseAt) : NaN;
  if (!Number.isNaN(openAt) && now < openAt) return 'notYetOpen';
  if (!Number.isNaN(closeAt) && now >= closeAt) return 'closedWindow';
  return 'unavailable';
}

/**
 * Notice for a REGISTRATION_OPEN tournament whose window is not currently accepting entries
 * ("opens at …" / "closed at …"), with the display time zone label. Server-rendered only.
 */
export function RegistrationWindowNotice({
  state,
  registrationOpenAt,
  registrationCloseAt,
}: {
  state: RegistrationWindowState;
  registrationOpenAt: string | null;
  registrationCloseAt: string | null;
}) {
  const t = useTranslations('tournaments');
  const format = useFormatter();
  if (state === 'open' || state === 'notOpenStatus') return null;
  const at = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const text =
    state === 'notYetOpen'
      ? t('registrationOpensAt', { time: at(registrationOpenAt), tz: DISPLAY_TIMEZONE_LABEL })
      : state === 'closedWindow'
        ? t('registrationClosedAt', { time: at(registrationCloseAt), tz: DISPLAY_TIMEZONE_LABEL })
        : t('registrationUnavailable');
  return (
    <p
      role="note"
      data-testid="registration-window"
      data-state={state}
      className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
    >
      <CalendarClock aria-hidden="true" className="size-4 shrink-0 text-warning" />
      {text}
    </p>
  );
}
