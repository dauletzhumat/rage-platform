import { Injectable } from '@nestjs/common';
import { RedisService } from '../infra/redis/redis.service.js';
import { withTimeout } from '../infra/prisma/prisma.service.js';
import { sha256Hex } from './crypto.js';

/** Nonce retention: longer than the ±5 min freshness window (docs/AUTH.md §3). */
export const NONCE_TTL_SECONDS = 900;

/**
 * Single-use OpenID response nonces. `claim` returns true exactly once per (endpoint, nonce)
 * and THROWS when the store is unavailable — callers must fail closed.
 */
export interface NonceStore {
  claim(opEndpoint: string, nonce: string): Promise<boolean>;
}

export const NONCE_STORE = Symbol('NONCE_STORE');

export class NonceStoreUnavailableError extends Error {
  constructor() {
    super('nonce store unavailable');
    this.name = 'NonceStoreUnavailableError';
  }
}

export function nonceKey(opEndpoint: string, nonce: string): string {
  return `rage:oidc:nonce:${sha256Hex(`${opEndpoint}|${nonce}`)}`;
}

@Injectable()
export class RedisNonceStore implements NonceStore {
  constructor(private readonly redis: RedisService) {}

  async claim(opEndpoint: string, nonce: string): Promise<boolean> {
    try {
      await this.redis.ensureConnected();
      const result = await withTimeout(
        this.redis.client.set(nonceKey(opEndpoint, nonce), '1', 'EX', NONCE_TTL_SECONDS, 'NX'),
        2000,
      );
      return result === 'OK';
    } catch {
      throw new NonceStoreUnavailableError();
    }
  }
}
