/**
 * Platform display time zone (owner decision: UTC+5, no DST).
 *
 * `NEXT_PUBLIC_*` values are inlined at build time, so the server render and the browser bundle
 * always use the same zone (no hydration mismatch). Note the inverted sign of `Etc/GMT±N` zones:
 * `Etc/GMT-5` is UTC+5.
 */
export const DEFAULT_DISPLAY_TIMEZONE = 'Etc/GMT-5';
export const DEFAULT_DISPLAY_TIMEZONE_LABEL = 'UTC+5';

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Resolve the configured zone; an invalid IANA name falls back to the default. */
export function resolveDisplayTimeZone(raw: string | undefined): string {
  const zone = raw?.trim();
  return zone && zone.length <= 64 && isValidTimeZone(zone) ? zone : DEFAULT_DISPLAY_TIMEZONE;
}

/** Short label shown next to times ("UTC+5"); plain text, max 16 chars. */
export function resolveDisplayTimeZoneLabel(raw: string | undefined): string {
  const label = raw?.trim();
  return label && label.length <= 16 && /^[\p{L}\p{N} +:-]+$/u.test(label)
    ? label
    : DEFAULT_DISPLAY_TIMEZONE_LABEL;
}

export const DISPLAY_TIMEZONE = resolveDisplayTimeZone(process.env.NEXT_PUBLIC_DISPLAY_TIMEZONE);
export const DISPLAY_TIMEZONE_LABEL = resolveDisplayTimeZoneLabel(
  process.env.NEXT_PUBLIC_DISPLAY_TIMEZONE_LABEL,
);

const pad = (n: number) => String(n).padStart(2, '0');

/** Wall-clock parts of `date` in `zone`. */
function zonedParts(date: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `zone` from UTC at instant `ms`, in milliseconds (UTC+5 → +18 000 000). */
function zoneOffsetMs(ms: number, zone: string): number {
  const p = zonedParts(new Date(ms), zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * `datetime-local` value entered in the display zone → ISO 8601 instant with an explicit offset
 * (`Z`). '' → null; malformed or impossible dates → undefined.
 */
export function zonedInputToIso(
  value: string,
  zone: string = DISPLAY_TIMEZONE,
): string | null | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) return undefined;
  const [y, mo, d, h, mi] = match.slice(1, 6).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const sec = match[6] ? Number(match[6]) : 0;
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || sec > 59) return undefined;
  const wall = Date.UTC(y, mo - 1, d, h, mi, sec);
  const check = new Date(wall);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return undefined;
  // Two passes handle zones whose offset differs around the guess (DST); fixed zones need one.
  let instant = wall - zoneOffsetMs(wall, zone);
  instant = wall - zoneOffsetMs(instant, zone);
  return new Date(instant).toISOString();
}

/** ISO instant → `datetime-local` value (YYYY-MM-DDTHH:mm) in the display zone; '' if invalid. */
export function isoToZonedInput(
  iso: string | null | undefined,
  zone: string = DISPLAY_TIMEZONE,
): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const p = zonedParts(date, zone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Current instant for server-rendered comparisons (kept out of component bodies). */
export function requestTime(): number {
  return Date.now();
}
