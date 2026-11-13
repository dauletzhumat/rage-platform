import { STEAM_AVATAR_HOSTS } from '@/lib/steam-hosts';

export interface CspOptions {
  nonce: string;
  isDev: boolean;
  /** Origin of the browser-facing API (`connect-src`, `form-action`), or null if unknown. */
  apiOrigin: string | null;
  /** Add `upgrade-insecure-requests` (only when the site itself is served over https). */
  upgradeInsecureRequests?: boolean;
}

/** Origin of a URL, or null if it cannot be parsed. */
export function originOf(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** Fresh, unpredictable per-request nonce (128 bits, base64). */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Strict nonce-based CSP (security SEC-M0-M3), following the Next.js nonce guide:
 * Next reads the nonce from this header during SSR and applies it to its own scripts.
 *  - scripts: nonce + 'strict-dynamic'; no 'unsafe-inline'; 'unsafe-eval' only in development.
 *  - styles: 'unsafe-inline' is kept (React/Radix use style attributes; not a script vector).
 *  - images: self, data: and the exact Steam avatar CDN hosts.
 *  - form-action: self + the API origin (logout/login navigations).
 */
export function buildContentSecurityPolicy({
  nonce,
  isDev,
  apiOrigin,
  upgradeInsecureRequests = false,
}: CspOptions): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (isDev) scriptSrc.push("'unsafe-eval'");
  const connectSrc = ["'self'"];
  if (apiOrigin) connectSrc.push(apiOrigin);
  if (isDev) connectSrc.push('ws:', 'wss:');
  const formAction = ["'self'"];
  if (apiOrigin) formAction.push(apiOrigin);
  const imgSrc = ["'self'", 'data:', ...STEAM_AVATAR_HOSTS.map((host) => `https://${host}`)];

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc.join(' ')}`,
    "font-src 'self'",
    `connect-src ${connectSrc.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    `form-action ${formAction.join(' ')}`,
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ];
  if (upgradeInsecureRequests) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}
