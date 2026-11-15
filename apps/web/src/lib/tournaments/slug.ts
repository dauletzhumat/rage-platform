/**
 * Identifier patterns usable from client components (`lib/api/server` is server-only).
 * Same rules as the API (SLUG_PATTERN / ParseUUIDPipe); hrefs are built only from values that pass.
 */
export const SLUG_PATTERN_CLIENT = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const UUID_PATTERN_CLIENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
