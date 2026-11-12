import { existsSync } from 'node:fs';
import path from 'node:path';
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
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must be a postgresql:// URL'),
  REDIS_URL: z
    .string()
    .min(1)
    .refine((v) => /^rediss?:\/\//.test(v), 'must be a redis:// or rediss:// URL'),
  APP_VERSION: z.string().optional(),
  /** Steam OpenID settings (M1). Presence only influences /meta in M0. */
  STEAM_OPENID_REALM: z.string().optional(),
  STEAM_OPENID_RETURN_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: { key: string; message: string }[]) {
    super(
      `Invalid environment configuration:\n${issues.map((i) => `  - ${i.key}: ${i.message}`).join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

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
  const env = result.data;
  if (env.NODE_ENV === 'production' && env.API_CORS_ORIGINS.some((o) => o.startsWith('http://'))) {
    throw new EnvValidationError([
      { key: 'API_CORS_ORIGINS', message: 'production origins must use https://' },
    ]);
  }
  return env;
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
