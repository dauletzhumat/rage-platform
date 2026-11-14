import { Controller, Delete, Get, Module, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { AllowUnguardedUnsafeRoute } from '../../src/auth/auth.decorators.js';
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
import {
  type DiscoveredHandler,
  discoverControllers,
  discoverHandlers,
  unsafeHandlerViolations,
} from '../support/route-wiring.js';

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

describe('security gate L-4: every unsafe handler in the app is session + CSRF guarded', () => {
  // M1 unsafe handlers predate the idempotency layer (TEAMS.md §7 applies to M2 endpoints).
  const NOT_IDEMPOTENT_BY_DESIGN = new Set([
    'AuthController.logout',
    'MeController.update',
    'AdminUsersController.grant',
    'AdminUsersController.revoke',
  ]);
  let handlers: DiscoveredHandler[] = [];
  let controllerNames: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(parseEnv(steamEnv))],
    }).compile();
    try {
      const controllers = discoverControllers(moduleRef);
      controllerNames = controllers.map((c) => c.name);
      handlers = controllers.flatMap(discoverHandlers);
    } finally {
      await moduleRef.close();
    }
  });

  it('discovers controllers from the compiled module graph (not a hard-coded list)', () => {
    // Sanity only: discovery must see M1 and M2 controllers, i.e. it is really walking modules.
    expect(controllerNames).toEqual(
      expect.arrayContaining(['AuthController', 'MeController', 'TeamManagementController']),
    );
    expect(handlers.filter((h) => h.unsafe).length).toBeGreaterThanOrEqual(15);
  });

  it('no unsafe handler lacks SessionGuard → CsrfGuard (in that order)', () => {
    expect(unsafeHandlerViolations(handlers)).toEqual([]);
  });

  it('allowlisted unsafe handlers are rare and documented (none today)', () => {
    expect(handlers.filter((h) => h.unsafe && h.allowlistReason).map((h) => h.name)).toEqual([]);
  });

  it('every @Idempotent handler runs SessionGuard (keys are scoped per user; gate I-8)', () => {
    const idempotent = handlers.filter((h) => h.idempotent);
    expect(idempotent.length).toBeGreaterThanOrEqual(11);
    const withoutSession = idempotent
      .filter((h) => !h.guards.includes(SessionGuard) || !h.guards.includes(CsrfGuard))
      .map((h) => `${h.controller.name}.${h.name}`);
    expect(withoutSession).toEqual([]);
  });

  it('every M2 unsafe handler accepts Idempotency-Key (@Idempotent)', () => {
    const missing = handlers
      .filter((h) => h.unsafe && !h.idempotent)
      .map((h) => `${h.controller.name}.${h.name}`)
      .filter((id) => !NOT_IDEMPOTENT_BY_DESIGN.has(id));
    expect(missing).toEqual([]);
  });
});

describe('L-4 meta-test: the wiring check catches broken controllers', () => {
  @Controller('fixture-unguarded')
  class UnguardedFixtureController {
    @Post()
    create(): void {}
    @Get()
    read(): void {}
  }

  @Controller('fixture-wrong-order')
  class WrongOrderFixtureController {
    @Patch()
    @UseGuards(CsrfGuard, SessionGuard)
    update(): void {}
    @Delete()
    @UseGuards(SessionGuard)
    remove(): void {}
    @Put()
    @UseGuards(CsrfGuard)
    replace(): void {}
  }

  @Controller('fixture-ok')
  @UseGuards(SessionGuard)
  class OkFixtureController {
    @Post()
    @UseGuards(CsrfGuard)
    classThenHandler(): void {}
    @Post('hook')
    @AllowUnguardedUnsafeRoute('fixture: signed webhook without cookies')
    allowlisted(): void {}
  }

  class InheritedFixtureController extends UnguardedFixtureController {}
  Controller('fixture-inherited')(InheritedFixtureController);

  @Module({
    controllers: [
      UnguardedFixtureController,
      WrongOrderFixtureController,
      OkFixtureController,
      InheritedFixtureController,
    ],
  })
  class FixtureModule {}

  it('flags unguarded, half-guarded and mis-ordered unsafe handlers found via discovery', async () => {
    // Fixtures are compiled into the real app graph (the guards' dependencies come from it).
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(parseEnv(steamEnv)), FixtureModule],
    }).compile();
    try {
      const handlers = discoverControllers(moduleRef).flatMap(discoverHandlers);
      expect(unsafeHandlerViolations(handlers).sort()).toEqual(
        [
          'InheritedFixtureController.create: no guards at all',
          'UnguardedFixtureController.create: no guards at all',
          'WrongOrderFixtureController.remove: missing CsrfGuard',
          'WrongOrderFixtureController.replace: missing SessionGuard',
          'WrongOrderFixtureController.update: CsrfGuard runs before SessionGuard',
        ].sort(),
      );
    } finally {
      await moduleRef.close();
    }
  });

  it('the allowlist decorator demands a reason', () => {
    expect(() => AllowUnguardedUnsafeRoute('')).toThrow();
  });
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
