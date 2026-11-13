/** Exact Steam CDN hosts allowed for avatars (docs/AUTH.md §3.5) — also used by the CSP img-src. */
export const STEAM_AVATAR_HOSTS = [
  'avatars.steamstatic.com',
  'avatars.akamai.steamstatic.com',
  'avatars.cloudflare.steamstatic.com',
] as const;

function parseHttps(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : null;
  } catch {
    return null;
  }
}

/** The avatar URL if it is https on an allowlisted Steam CDN host, else null (render initials). */
export function safeSteamAvatarUrl(value: string | null | undefined): string | null {
  const url = parseHttps(value);
  return url && (STEAM_AVATAR_HOSTS as readonly string[]).includes(url.hostname) ? url.href : null;
}

/** The profile URL if it is https on steamcommunity.com, else null. */
export function safeSteamProfileUrl(value: string | null | undefined): string | null {
  const url = parseHttps(value);
  return url && url.hostname === 'steamcommunity.com' ? url.href : null;
}
