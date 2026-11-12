import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@rage/db';
import { ENV } from '../../config/config.module.js';
import { type Env } from '../../config/env.js';

/**
 * Owns the single PrismaClient for the process. Connection is lazy (first query),
 * so the app boots — and reports "not ready" — even while the database is down.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly client: PrismaClient;

  constructor(@Inject(ENV) env: Env) {
    this.client = createPrismaClient({ databaseUrl: env.DATABASE_URL });
  }

  /** Readiness probe: a trivial round-trip with a hard timeout. */
  async ping(timeoutMs = 2000): Promise<boolean> {
    try {
      await withTimeout(this.client.$queryRaw`SELECT 1`, timeoutMs);
      return true;
    } catch (err) {
      this.logger.warn({ err: errorSummary(err) }, 'database ping failed');
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}

export function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    Promise.resolve(p),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Log-safe error summary (no connection strings / credentials). */
export function errorSummary(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message.split('\n')[0]?.slice(0, 200)}`;
  return 'unknown error';
}
