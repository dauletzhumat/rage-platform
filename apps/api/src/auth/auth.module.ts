import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module.js';
import { type Env } from '../config/env.js';
import { AuthController } from './auth.controller.js';
import { CsrfGuard, RolesGuard, SessionGuard } from './guards.js';
import { LoginService } from './login.service.js';
import { NONCE_STORE, type NonceStore, RedisNonceStore } from './nonce-store.js';
import {
  FetchOpenIdTransport,
  OPENID_TRANSPORT,
  type OpenIdTransport,
} from './openid-transport.js';
import { SessionService } from './session.service.js';
import { STEAM_OPENID, SteamOpenIdService } from './steam-openid.service.js';
import {
  FetchSteamWebApiClient,
  STEAM_WEB_API_CLIENT,
  SteamProfileSyncService,
} from './steam-profile-sync.js';

/**
 * Steam OpenID sign-in, sessions, CSRF and RBAC guards. Global so feature modules can use
 * `SessionGuard`/`CsrfGuard`/`RolesGuard` without re-importing.
 *
 * `OPENID_TRANSPORT` and `STEAM_WEB_API_CLIENT` default to real HTTPS clients; tests may
 * override them (Nest `overrideProvider`). There is no bypass flag in production code.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [
    { provide: OPENID_TRANSPORT, useFactory: () => new FetchOpenIdTransport() },
    { provide: STEAM_WEB_API_CLIENT, useFactory: () => new FetchSteamWebApiClient() },
    { provide: NONCE_STORE, useClass: RedisNonceStore },
    {
      provide: STEAM_OPENID,
      inject: [ENV, OPENID_TRANSPORT, NONCE_STORE],
      useFactory: (env: Env, transport: OpenIdTransport, nonces: NonceStore) =>
        env.steamAuth ? new SteamOpenIdService(env.steamAuth, transport, nonces) : null,
    },
    SessionService,
    LoginService,
    SteamProfileSyncService,
    SessionGuard,
    CsrfGuard,
    RolesGuard,
  ],
  exports: [SessionService, SessionGuard, CsrfGuard, RolesGuard],
})
export class AuthModule {}
