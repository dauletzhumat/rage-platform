import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV } from '../../config/config.module.js';
import { type Env } from '../../config/env.js';
import { errorSummary, withTimeout } from '../prisma/prisma.service.js';

/**
 * Shared Redis connection (cache / future BullMQ producer). Lazy-connects and does not
 * queue commands while offline, so a Redis outage surfaces as fast failures, not hangs.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    // Without a listener ioredis would print unhandled error events.
    this.client.on('error', (err) => this.logger.debug({ err: errorSummary(err) }, 'redis error'));
  }

  async ping(timeoutMs = 2000): Promise<boolean> {
    try {
      if (this.client.status === 'wait' || this.client.status === 'end') {
        await withTimeout(this.client.connect(), timeoutMs);
      }
      const pong = await withTimeout(this.client.ping(), timeoutMs);
      return pong === 'PONG';
    } catch (err) {
      this.logger.warn({ err: errorSummary(err) }, 'redis ping failed');
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
