import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 random bytes, base64url (43 chars). Used for session tokens and OpenID state. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * HMAC-SHA256 with an explicit purpose label for domain separation, so a value signed for
 * one purpose (e.g. OpenID state) can never be replayed as another (e.g. CSRF token).
 */
export function hmacBase64Url(secret: string, purpose: string, value: string): string {
  return createHmac('sha256', secret).update(`${purpose}\n${value}`, 'utf8').digest('base64url');
}

/** Constant-time string comparison (length leak only; inputs are fixed-length tokens). */
export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // Compare digests so differing lengths do not short-circuit before the timing-safe compare.
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db) && a.length === b.length;
}
