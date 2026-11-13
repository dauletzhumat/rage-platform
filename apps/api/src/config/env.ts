import { existsSync } from 'node:fs';
import path from 'node:path';
import { isIndividualSteamId64 } from '@rage/db';
import { z } from 'zod';

/**
 * Environment schema. Validated once at boot; the app refuses to start on invalid config.
 * Secrets are never logged: only key names appear in validation errors.
 */
const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const booleanish = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

/** Fixed callback path (docs/AUTH.md §2). */
export const STEAM_CALLBACK_PATH = '/api/v1/auth/steam/callback';
/** Minimum secret length in bytes (UTF-8) for SESSION_SECRET / INTERNAL_SSR_TOKEN. */
export const MIN_SECRET_BYTES = 32;

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_CORS_ORIGINS: csv.pipe(z.array(z.url())),
  API_DOCS_ENABLED: booleanish.default(false),
  /** Number of trusted reverse-proxy hops (for client IP / rate limiting). 0 = trust none. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
  /** Stricter per-IP, per-route limit for `/auth/*` (login start + callback). */
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must be a postgresql:// URL'),
  REDIS_URL: z
    .string()
    .min(1)
    .refine((v) => /^rediss?:\/\//.test(v), 'must be a redis:// or rediss:// URL'),
  APP_VERSION: z.string().optional(),

  // ---- Steam OpenID / sessions (M1, docs/AUTH.md §2) ----
  STEAM_OPENID_REALM: z.string().optional(),
  STEAM_OPENID_RETURN_URL: z.string().optional(),
  /** Web origin; post-login redirect target. Defaults to http://localhost:3000 outside production. */
  WEB_PUBLIC_URL: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .default(336),
  SESSION_IDLE_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .default(72),
  /** Default: true in production, false otherwise. */
  COOKIE_SECURE: booleanish.optional(),
  STEAM_WEB_API_KEY: z.string().optional(),
  BOOTSTRAP_SUPER_ADMIN_STEAM_ID64: z.string().optional(),
  INTERNAL_SSR_TOKEN: z.string().optional(),
});

type RawEnv = z.infer<typeof envSchema>;

/** Fully validated Steam sign-in settings; present only when every piece is valid. */
export interface SteamAuthSettings {
  /** Normalized realm (origin, no trailing slash), sent as `openid.realm`. */
  realm: string;
  /** Normalized callback URL (origin + fixed path), base of `openid.return_to`. */
  returnUrl: string;
  /** Web origin (no trailing slash). */
  webPublicUrl: string;
  sessionSecret: string;
}

export type Env = Omit<RawEnv, 'COOKIE_SECURE'> & {
  COOKIE_SECURE: boolean;
  /** `null` ⇒ `/meta` reports `unconfigured` and Steam auth routes answer 503. */
  steamAuth: SteamAuthSettings | null;
};

export class EnvValidationError extends Error {
  constructor(readonly issues: { key: string; message: string }[]) {
    super(
      `Invalid environment configuration:\n${issues.map((i) => `  - ${i.key}: ${i.message}`).join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function hasNoExtras(raw: string, url: URL): boolean {
  return (
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    !raw.includes('#') &&
    !raw.includes('?')
  );
}

/** Origin-only URL: no userinfo, path `/`, no query, no fragment. */
function isOriginOnly(raw: string, url: URL): boolean {
  return hasNoExtras(raw, url) && url.pathname === '/';
}

const secretBytes = (v: string | undefined) => (v ? Buffer.byteLength(v, 'utf8') : 0);

/** Parse and validate env. Pure: does not read files. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings as "unset" so `.env` templates with blank keys use defaults.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ''),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => ({
        key: i.path.join('.') || '(root)',
        message: i.message,
      })),
    );
  }
  const raw = result.data;
  const production = raw.NODE_ENV === 'production';
  const issues: { key: string; message: string }[] = [];

  if (production && raw.API_CORS_ORIGINS.some((o) => o.startsWith('http://'))) {
    issues.push({ key: 'API_CORS_ORIGINS', message: 'production origins must use https://' });
  }

  // Steam OpenID URLs: malformed values are boot errors (typos must fail fast);
  // missing values only leave Steam sign-in `unconfigured`.
  let realm: URL | undefined;
  if (raw.STEAM_OPENID_REALM) {
    realm = parseHttpUrl(raw.STEAM_OPENID_REALM);
    if (!realm || !isOriginOnly(raw.STEAM_OPENID_REALM, realm)) {
      issues.push({
        key: 'STEAM_OPENID_REALM',
        message: 'must be an absolute http(s) URL without path, query, fragment or credentials',
      });
      realm = undefined;
    } else if (production && realm.protocol !== 'https:') {
      issues.push({ key: 'STEAM_OPENID_REALM', message: 'must use https:// in production' });
    }
  }

  let returnUrl: URL | undefined;
  if (raw.STEAM_OPENID_RETURN_URL) {
    returnUrl = parseHttpUrl(raw.STEAM_OPENID_RETURN_URL);
    if (
      !returnUrl ||
      !hasNoExtras(raw.STEAM_OPENID_RETURN_URL, returnUrl) ||
      returnUrl.pathname !== STEAM_CALLBACK_PATH
    ) {
      issues.push({
        key: 'STEAM_OPENID_RETURN_URL',
        message: `must be an absolute http(s) URL with path ${STEAM_CALLBACK_PATH} and no query/fragment`,
      });
      returnUrl = undefined;
    } else if (production && returnUrl.protocol !== 'https:') {
      issues.push({ key: 'STEAM_OPENID_RETURN_URL', message: 'must use https:// in production' });
    }
  }
  if (realm && returnUrl && returnUrl.origin !== realm.origin) {
    issues.push({
      key: 'STEAM_OPENID_RETURN_URL',
      message: 'must be under STEAM_OPENID_REALM (same scheme, host and port)',
    });
  }

  const webRaw = raw.WEB_PUBLIC_URL ?? (production ? undefined : 'http://localhost:3000');
  let web: URL | undefined;
  if (webRaw) {
    web = parseHttpUrl(webRaw);
    if (!web || !isOriginOnly(webRaw, web)) {
      issues.push({ key: 'WEB_PUBLIC_URL', message: 'must be an absolute http(s) origin' });
      web = undefined;
    } else if (production && web.protocol !== 'https:') {
      issues.push({ key: 'WEB_PUBLIC_URL', message: 'must use https:// in production' });
    }
  }

  if (raw.SESSION_SECRET && secretBytes(raw.SESSION_SECRET) < MIN_SECRET_BYTES) {
    issues.push({ key: 'SESSION_SECRET', message: `must be at least ${MIN_SECRET_BYTES} bytes` });
  }
  if (raw.INTERNAL_SSR_TOKEN && secretBytes(raw.INTERNAL_SSR_TOKEN) < MIN_SECRET_BYTES) {
    issues.push({
      key: 'INTERNAL_SSR_TOKEN',
      message: `must be at least ${MIN_SECRET_BYTES} bytes`,
    });
  }
  if (
    raw.BOOTSTRAP_SUPER_ADMIN_STEAM_ID64 &&
    !isIndividualSteamId64(raw.BOOTSTRAP_SUPER_ADMIN_STEAM_ID64)
  ) {
    issues.push({
      key: 'BOOTSTRAP_SUPER_ADMIN_STEAM_ID64',
      message: 'must be an individual SteamID64 (17 digits)',
    });
  }
  if (raw.SESSION_IDLE_HOURS > raw.SESSION_TTL_HOURS) {
    issues.push({ key: 'SESSION_IDLE_HOURS', message: 'must not exceed SESSION_TTL_HOURS' });
  }

  if (production) {
    if (!raw.SESSION_SECRET) {
      issues.push({ key: 'SESSION_SECRET', message: 'is required in production' });
    }
    if (!raw.INTERNAL_SSR_TOKEN) {
      issues.push({ key: 'INTERNAL_SSR_TOKEN', message: 'is required in production' });
    }
    if (raw.API_DOCS_ENABLED) {
      issues.push({
        key: 'API_DOCS_ENABLED',
        message: 'must not be true in production (docs authentication does not exist yet)',
      });
    }
    if (raw.COOKIE_SECURE === false) {
      issues.push({ key: 'COOKIE_SECURE', message: 'must not be false in production' });
    }
  }

  let steamAuth: SteamAuthSettings | null = null;
  const secretOk = secretBytes(raw.SESSION_SECRET) >= MIN_SECRET_BYTES;
  if (realm && returnUrl && web && secretOk && issues.length === 0) {
    const webOrigin = web.origin;
    if (!raw.API_CORS_ORIGINS.some((o) => parseHttpUrl(o)?.origin === webOrigin)) {
      issues.push({
        key: 'WEB_PUBLIC_URL',
        message: 'must be listed in API_CORS_ORIGINS when Steam sign-in is configured',
      });
    } else {
      steamAuth = {
        realm: realm.origin,
        returnUrl: `${returnUrl.origin}${STEAM_CALLBACK_PATH}`,
        webPublicUrl: webOrigin,
        sessionSecret: raw.SESSION_SECRET as string,
      };
    }
  }

  if (issues.length > 0) throw new EnvValidationError(issues);

  return {
    ...raw,
    WEB_PUBLIC_URL: web?.origin,
    COOKIE_SECURE: raw.COOKIE_SECURE ?? production,
    steamAuth,
  };
}

/**
 * Outside production, load the repository-root `.env` (if present) into process.env
 * without overriding variables that are already set.
 */
export function loadDotEnvForDevelopment(startDir = process.cwd()): void {
  if (process.env.NODE_ENV === 'production') return;
  let dir = path.resolve(startDir);
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, '.env');
    if (existsSync(candidate) && existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
