import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { AdminAuditController, AdminUsersController } from '../../src/admin/admin.controller.js';
import { AppModule } from '../../src/app.module.js';
import { AuthController } from '../../src/auth/auth.controller.js';
import { CsrfGuard, SessionGuard } from '../../src/auth/guards.js';
import { FetchOpenIdTransport, OPENID_TRANSPORT } from '../../src/auth/openid-transport.js';
import { STEAM_OPENID, SteamOpenIdService } from '../../src/auth/steam-openid.service.js';
import {
  FetchSteamWebApiClient,
  privacyFrom,
  safeAvatarUrl,
  safeDisplayName,
  safeProfileUrl,
  STEAM_WEB_API_CLIENT,
  SteamProfileSyncService,
} from '../../src/auth/steam-profile-sync.js';
import { parseEnv } from '../../src/config/env.js';
import { MeController } from '../../src/me/me.controller.js';

// Placeholders only: Prisma/Redis connect lazily, so compiling the module contacts nothing.
const baseEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://unit:unused@127.0.0.1:1/unused',
  REDIS_URL: 'redis://127.0.0.1:1',
};
const steamEnv = {
  ...baseEnv,
  API_CORS_ORIGINS: 'http://localhost:3000',
  STEAM_OPENID_REALM: 'http://localhost:4000',
  STEAM_OPENID_RETURN_URL: 'http://localhost:4000/api/v1/auth/steam/callback',
  WEB_PUBLIC_URL: 'http://localhost:3000',
  SESSION_SECRET: 'x'.repeat(43),
};

describe('provider wiring', () => {
  it('uses the real HTTPS transports when nothing is overridden (no network call)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(parseEnv(steamEnv))],
    }).compile();
    try {
      expect(moduleRef.get(OPENID_TRANSPORT)).toBeInstanceOf(FetchOpenIdTransport);
      expect(moduleRef.get(STEAM_WEB_API_CLIENT)).toBeInstanceOf(FetchSteamWebApiClient);
      expect(moduleRef.get(STEAM_OPENID)).toBeInstanceOf(SteamOpenIdService);
    } finally {
      await moduleRef.close();
    }
  });

  it('Steam OpenID service is absent while unconfigured', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(parseEnv(baseEnv))],
    }).compile();
    try {
      expect(moduleRef.get(STEAM_OPENID)).toBeNull();
    } finally {
      await moduleRef.close();
    }
  });
});

describe('every unsafe authenticated handler is CSRF-guarded', () => {
  const controllers = [AuthController, MeController, AdminUsersController, AdminAuditController];
  const unsafe = new Set([
    RequestMethod.POST,
    RequestMethod.PUT,
    RequestMethod.PATCH,
    RequestMethod.DELETE,
  ]);
  for (const ctrl of controllers) {
    const proto = ctrl.prototype as unknown as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method === undefined || !unsafe.has(method)) continue;
      it(`${ctrl.name}.${name}`, () => {
        const guards = [
          ...((Reflect.getMetadata(GUARDS_METADATA, ctrl) as unknown[]) ?? []),
          ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) ?? []),
        ];
        expect(guards).toContain(SessionGuard);
        expect(guards).toContain(CsrfGuard);
        expect(guards.indexOf(SessionGuard)).toBeLessThan(guards.indexOf(CsrfGuard));
      });
    }
  }
});

describe('Steam profile sync validation', () => {
  it('accepts only https avatars on allowlisted Steam CDN hosts', () => {
    expect(safeAvatarUrl('https://avatars.steamstatic.com/abc_full.jpg')).toBe(
      'https://avatars.steamstatic.com/abc_full.jpg',
    );
    expect(safeAvatarUrl('https://avatars.akamai.steamstatic.com/a.jpg')).not.toBeNull();
    expect(safeAvatarUrl('https://avatars.cloudflare.steamstatic.com/a.jpg')).not.toBeNull();
    for (const bad of [
      'http://avatars.steamstatic.com/a.jpg',
      'https://evil.example/a.jpg',
      'https://avatars.steamstatic.com.evil.example/a.jpg',
      'https://user@avatars.steamstatic.com/a.jpg',
      'https://avatars.steamstatic.com:8443/a.jpg',
      'javascript:alert(1)',
      42,
    ]) {
      expect(safeAvatarUrl(bad)).toBeNull();
    }
  });
  it('profile URL must be https steamcommunity.com', () => {
    expect(safeProfileUrl('https://steamcommunity.com/id/x/')).not.toBeNull();
    expect(safeProfileUrl('http://steamcommunity.com/id/x/')).toBeNull();
    expect(safeProfileUrl('https://steamcommunity.com.evil.example/')).toBeNull();
  });
  it('display names are stripped of control / bidi characters and bounded', () => {
    expect(safeDisplayName('  a‮b\u0000c ')).toBe('abc');
    expect(safeDisplayName('x'.repeat(100))).toHaveLength(64);
    expect(safeDisplayName('​')).toBeNull();
    expect(safeDisplayName(5)).toBeNull();
  });
  it('privacy mapping', () => {
    expect(privacyFrom(3)).toBe('PUBLIC');
    expect(privacyFrom(1)).toBe('PRIVATE');
    expect(privacyFrom('3')).toBe('UNKNOWN');
  });

  it('sync is skipped without an API key and never throws on client failure', async () => {
    const prisma = {
      client: { steamProfile: { upsert: vi.fn() }, playerProfile: { updateMany: vi.fn() } },
    };
    const client = {
      getPlayerSummary: vi.fn(async () => {
        throw new Error('boom KEY123');
      }),
    };
    const noKey = new SteamProfileSyncService(parseEnv(baseEnv), client, prisma as never);
    expect(noKey.enabled).toBe(false);
    await expect(noKey.sync('u', '76561198000000001', true)).resolves.toBe(false);
    expect(client.getPlayerSummary).not.toHaveBeenCalled();

    const withKey = new SteamProfileSyncService(
      parseEnv({ ...baseEnv, STEAM_WEB_API_KEY: 'KEY123' }),
      client,
      prisma as never,
    );
    await expect(withKey.sync('u', '76561198000000001', true)).resolves.toBe(false);
    expect(prisma.client.steamProfile.upsert).not.toHaveBeenCalled();
  });

  it('sync stores validated values and ignores a summary for another SteamID', async () => {
    const upsert = vi.fn();
    const updateMany = vi.fn();
    const prisma = { client: { steamProfile: { upsert }, playerProfile: { updateMany } } };
    const env = parseEnv({ ...baseEnv, STEAM_WEB_API_KEY: 'KEY123' });
    const other = new SteamProfileSyncService(
      env,
      { getPlayerSummary: async () => ({ steamid: '76561198000000002', personaname: 'x' }) },
      prisma as never,
    );
    expect(await other.sync('u', '76561198000000001', true)).toBe(false);

    const svc = new SteamProfileSyncService(
      env,
      {
        getPlayerSummary: async () => ({
          steamid: '76561198000000001',
          personaname: 'Real Name',
          avatarfull: 'https://evil.example/tracker.gif',
          profileurl: 'https://steamcommunity.com/id/real/',
          communityvisibilitystate: 3,
        }),
      },
      prisma as never,
    );
    expect(await svc.sync('u', '76561198000000001', true)).toBe(true);
    const data = upsert.mock.calls[0]![0].update;
    expect(data).toMatchObject({
      steamDisplayName: 'Real Name',
      avatarUrl: null,
      profileUrl: 'https://steamcommunity.com/id/real/',
      privacyStatus: 'PUBLIC',
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'u', nickname: 'player-000001' },
      data: { nickname: 'Real Name' },
    });
  });
});
