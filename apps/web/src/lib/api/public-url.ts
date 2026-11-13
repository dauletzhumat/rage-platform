import { safeReturnTo } from '@/lib/auth/return-to';
import { buildUrl, DEFAULT_API_BASE_URL } from './http';

/** Browser-facing API base URL (NEXT_PUBLIC_*, inlined at build time). */
export function publicApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL;
}

/**
 * Top-level navigation target that starts Steam OpenID sign-in on the API:
 * `{API}/auth/steam?returnTo=<sanitised relative path>`. Works without JavaScript.
 */
export function steamSignInUrl(returnTo: string | null | undefined): string {
  return buildUrl(publicApiBaseUrl(), '/auth/steam', { returnTo: safeReturnTo(returnTo) });
}
