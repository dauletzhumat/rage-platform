import { Inject, Injectable, Logger } from '@nestjs/common';
import { type SteamPrivacyStatus } from '@rage/db';
import { ENV } from '../config/config.module.js';
import { type Env } from '../config/env.js';
import { errorSummary, PrismaService } from '../infra/prisma/prisma.service.js';
import { readLimitedText } from './openid-transport.js';
import { defaultNickname, nicknameFromDisplayName } from './profile-rules.js';

export interface SteamPlayerSummary {
  steamid: string;
  personaname?: unknown;
  avatarfull?: unknown;
  profileurl?: unknown;
  communityvisibilitystate?: unknown;
}

/** Steam Web API client (GetPlayerSummaries). Injectable for tests; throws on failure. */
export interface SteamWebApiClient {
  getPlayerSummary(apiKey: string, steamId64: string): Promise<SteamPlayerSummary | null>;
}

export const STEAM_WEB_API_CLIENT = Symbol('STEAM_WEB_API_CLIENT');
export const STEAM_WEB_API_TIMEOUT_MS = 5000;

export class FetchSteamWebApiClient implements SteamWebApiClient {
  constructor(
    private readonly fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
    private readonly timeoutMs = STEAM_WEB_API_TIMEOUT_MS,
  ) {}

  async getPlayerSummary(apiKey: string, steamId64: string): Promise<SteamPlayerSummary | null> {
    const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamids', steamId64);
    const response = await this.fetchImpl(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { accept: 'application/json' },
    });
    if (response.status !== 200) throw new Error(`GetPlayerSummaries HTTP ${response.status}`);
    const json = JSON.parse(await readLimitedText(response, 64 * 1024)) as {
      response?: { players?: SteamPlayerSummary[] };
    };
    const player = json.response?.players?.find((p) => p?.steamid === steamId64);
    return player ?? null;
  }
}

/** Exact Steam CDN hosts allowed for avatars (AUTH.md §3 step 5). */
export const STEAM_AVATAR_HOSTS = new Set([
  'avatars.steamstatic.com',
  'avatars.akamai.steamstatic.com',
  'avatars.cloudflare.steamstatic.com',
]);

function httpsUrlOnHost(value: unknown, allowed: (host: string) => boolean): string | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    return allowed(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function safeAvatarUrl(value: unknown): string | null {
  return httpsUrlOnHost(value, (h) => STEAM_AVATAR_HOSTS.has(h));
}

export function safeProfileUrl(value: unknown): string | null {
  return httpsUrlOnHost(value, (h) => h === 'steamcommunity.com');
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u{0}-\u{1f}\u{7f}-\u{9f}\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}]/gu;

export function safeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(CONTROL, '').trim().slice(0, 64);
  return cleaned.length > 0 ? cleaned : null;
}

export function privacyFrom(value: unknown): SteamPrivacyStatus {
  if (value === 3) return 'PUBLIC';
  if (value === 1) return 'PRIVATE';
  if (value === 2) return 'FRIENDS_ONLY';
  return 'UNKNOWN';
}

/**
 * Best-effort display name / avatar sync after a committed login. Never used for
 * authorization; values are validated (Steam hosts only, https) before storage.
 */
@Injectable()
export class SteamProfileSyncService {
  private readonly logger = new Logger(SteamProfileSyncService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(STEAM_WEB_API_CLIENT) private readonly client: SteamWebApiClient,
    private readonly prisma: PrismaService,
  ) {}

  get enabled(): boolean {
    return !!this.env.STEAM_WEB_API_KEY;
  }

  /** Never throws. Returns true when a profile row was written. */
  async sync(userId: string, steamId64: string, isNewUser: boolean): Promise<boolean> {
    const apiKey = this.env.STEAM_WEB_API_KEY;
    if (!apiKey) return false;
    try {
      const summary = await this.client.getPlayerSummary(apiKey, steamId64);
      if (!summary || summary.steamid !== steamId64) return false;
      const data = {
        steamDisplayName: safeDisplayName(summary.personaname),
        avatarUrl: safeAvatarUrl(summary.avatarfull),
        profileUrl: safeProfileUrl(summary.profileurl),
        privacyStatus: privacyFrom(summary.communityvisibilitystate),
        syncedAt: new Date(),
      };
      const db = this.prisma.client;
      await db.steamProfile.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
      // First login: replace the generated nickname with the Steam name when it is valid.
      const nickname = nicknameFromDisplayName(data.steamDisplayName);
      if (isNewUser && nickname) {
        await db.playerProfile.updateMany({
          where: { userId, nickname: defaultNickname(steamId64) },
          data: { nickname },
        });
      }
      return true;
    } catch (err) {
      // Defence in depth: never let the API key reach logs via an error message.
      const summary = errorSummary(err).split(apiKey).join('[redacted]');
      this.logger.warn({ err: summary }, 'steam profile sync failed');
      return false;
    }
  }
}
