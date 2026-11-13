import { isWellFormedToken, SESSION_COOKIE } from '@/lib/auth/cookies';

/** Headers understood by the API for SSR calls (docs/AUTH.md §8). */
export const SSR_TOKEN_HEADER = 'x-rage-ssr-token';
export const CLIENT_IP_HEADER = 'x-rage-client-ip';

/** IPv4 / IPv6 literal (loose shape check; the API validates again). */
const IP_PATTERN = /^[0-9A-Fa-f:.]{2,45}$/;
const MAX_TRUSTED_HOPS = 10;

/** `WEB_TRUST_PROXY_HOPS` → integer 0..10; anything else → 0 (trust no forwarding headers). */
export function parseTrustedHops(raw: string | undefined): number {
  if (!raw || !/^\d{1,2}$/.test(raw.trim())) return 0;
  return Math.min(Number(raw.trim()), MAX_TRUSTED_HOPS);
}

/**
 * Visitor IP from the incoming request, trusting exactly `trustedHops` reverse proxies in
 * front of the web server (security gate M1, finding M-2):
 *  - 0 (default): forwarding headers are client-controlled → null (API uses its shared `ssr`
 *    bucket for SSR traffic).
 *  - N ≥ 1: the N-th entry from the RIGHT of `x-forwarded-for` (each trusted proxy appends the
 *    address it saw; anything further left was supplied by the client). Falls back to
 *    `x-real-ip` (set by the nearest proxy) only when `x-forwarded-for` is absent.
 * Returns null when unknown or malformed.
 */
export function clientIpFrom(
  forwardedFor: string | null | undefined,
  realIp: string | null | undefined,
  trustedHops: number,
): string | null {
  if (!Number.isInteger(trustedHops) || trustedHops < 1) return null;
  if (forwardedFor && forwardedFor.trim()) {
    const hops = forwardedFor.split(',').map((h) => h.trim());
    const candidate = hops.length >= trustedHops ? hops[hops.length - trustedHops] : undefined;
    return candidate && IP_PATTERN.test(candidate) ? candidate : null;
  }
  const real = realIp?.trim();
  return real && IP_PATTERN.test(real) ? real : null;
}

export interface ServerHeaderInput {
  /** `process.env.INTERNAL_SSR_TOKEN` — header omitted when unset/empty. */
  ssrToken: string | undefined;
  forwardedFor: string | null | undefined;
  realIp: string | null | undefined;
  /** `WEB_TRUST_PROXY_HOPS` (parsed); 0 = do not forward a client IP. */
  trustedHops: number;
  /** Value of the visitor's `rage_session` cookie (forwarded only when `withSession`). */
  sessionToken: string | null | undefined;
  /** Forward the session cookie (only for /me and admin reads). */
  withSession: boolean;
}

/**
 * Headers for a server-side API call. Only `rage_session` is ever forwarded (never the whole
 * Cookie header), and only when requested and well-formed.
 */
export function buildServerHeaders(input: ServerHeaderInput): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = input.ssrToken?.trim();
  if (token) headers[SSR_TOKEN_HEADER] = token;
  const ip = clientIpFrom(input.forwardedFor, input.realIp, input.trustedHops);
  if (ip) headers[CLIENT_IP_HEADER] = ip;
  if (input.withSession && isWellFormedToken(input.sessionToken)) {
    headers.cookie = `${SESSION_COOKIE}=${input.sessionToken}`;
  }
  return headers;
}
