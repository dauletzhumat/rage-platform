import { isIndividualSteamId64, isSampleSteamId64 } from '@rage/db';
import type { SteamAuthSettings } from '../config/env.js';
import { LoginError } from './auth.constants.js';
import { type NonceStore } from './nonce-store.js';
import { OPENID_NS, type OpenIdTransport, STEAM_OP_ENDPOINT } from './openid-transport.js';

export const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select';
export const CLAIMED_ID_PATTERN = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
export const REQUIRED_SIGNED_FIELDS = [
  'op_endpoint',
  'claimed_id',
  'identity',
  'return_to',
  'response_nonce',
  'assoc_handle',
] as const;
export const NONCE_MAX_SKEW_MS = 5 * 60_000;
const NONCE_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)[\x21-\x7e]{0,235}$/;
const MAX_PARAM_LENGTH = 2048;
const MAX_OPENID_PARAMS = 40;

export type Clock = () => number;

/** DI token; resolves to `null` while Steam sign-in is unconfigured. */
export const STEAM_OPENID = Symbol('STEAM_OPENID');

/**
 * Extracts `openid.*` parameters from a raw query string. Duplicate `openid.*` keys
 * (HTTP parameter pollution) or oversized values reject the whole assertion.
 */
export function extractOpenIdParams(rawQuery: string): Map<string, string> {
  const params = new URLSearchParams(rawQuery);
  const out = new Map<string, string>();
  for (const [key, value] of params) {
    if (!key.startsWith('openid.')) continue;
    if (out.has(key)) throw new LoginError('invalid_assertion');
    if (value.length > MAX_PARAM_LENGTH) throw new LoginError('invalid_assertion');
    out.set(key, value);
  }
  if (out.size > MAX_OPENID_PARAMS) throw new LoginError('invalid_assertion');
  return out;
}

/** Parses an OpenID key-value form response (`key:value\n`). Duplicate keys → undefined. */
export function parseKeyValueForm(body: string): Map<string, string> | undefined {
  const out = new Map<string, string>();
  for (const line of body.split('\n')) {
    const trimmed = line.replace(/\r$/, '');
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx);
    if (out.has(key)) return undefined;
    out.set(key, trimmed.slice(idx + 1));
  }
  return out;
}

/**
 * Steam OpenID 2.0 relying party (docs/AUTH.md §3, ADR-015). Stateless verification via
 * `check_authentication`; every rule fails closed with a `LoginError`.
 */
export class SteamOpenIdService {
  constructor(
    private readonly settings: SteamAuthSettings,
    private readonly transport: OpenIdTransport,
    private readonly nonces: NonceStore,
    private readonly now: Clock = Date.now,
  ) {}

  /** `openid.return_to` for a given state (exact string compared on callback). */
  returnToFor(state: string): string {
    return `${this.settings.returnUrl}?state=${encodeURIComponent(state)}`;
  }

  /** checkid_setup redirect URL. */
  buildAuthRedirectUrl(state: string): string {
    const params = new URLSearchParams({
      'openid.ns': OPENID_NS,
      'openid.mode': 'checkid_setup',
      'openid.claimed_id': IDENTIFIER_SELECT,
      'openid.identity': IDENTIFIER_SELECT,
      'openid.realm': this.settings.realm,
      'openid.return_to': this.returnToFor(state),
    });
    return `${STEAM_OP_ENDPOINT}?${params.toString()}`;
  }

  /**
   * Verifies a positive assertion. `state` must already have been validated against the
   * signed `rage_oidc` cookie by the caller. Returns the verified SteamID64.
   */
  async verifyAssertion(params: Map<string, string>, state: string): Promise<string> {
    const get = (k: string) => params.get(`openid.${k}`);

    const mode = get('mode');
    if (mode === 'cancel') throw new LoginError('cancelled');
    if (mode !== 'id_res') throw new LoginError('invalid_assertion');
    if (get('ns') !== OPENID_NS) throw new LoginError('invalid_assertion');
    if (get('op_endpoint') !== STEAM_OP_ENDPOINT) throw new LoginError('invalid_assertion');
    if (get('return_to') !== this.returnToFor(state)) throw new LoginError('invalid_assertion');

    const claimedId = get('claimed_id');
    const identity = get('identity');
    if (!claimedId || claimedId !== identity) throw new LoginError('invalid_assertion');
    const match = CLAIMED_ID_PATTERN.exec(claimedId);
    if (!match?.[1]) throw new LoginError('invalid_assertion');
    const steamId64 = match[1];

    if (!get('sig') || !get('assoc_handle')) throw new LoginError('invalid_assertion');
    const signed = new Set((get('signed') ?? '').split(','));
    for (const field of REQUIRED_SIGNED_FIELDS) {
      if (!signed.has(field)) throw new LoginError('invalid_assertion');
    }
    for (const field of signed) {
      if (!field || get(field) === undefined) throw new LoginError('invalid_assertion');
    }

    const nonce = get('response_nonce') ?? '';
    const nonceMatch = NONCE_PATTERN.exec(nonce);
    if (!nonceMatch?.[1]) throw new LoginError('invalid_assertion');
    const issuedAt = Date.parse(nonceMatch[1]);
    if (Number.isNaN(issuedAt) || Math.abs(this.now() - issuedAt) > NONCE_MAX_SKEW_MS) {
      throw new LoginError('replay');
    }
    // Claim the nonce BEFORE asking the OP: concurrent replays of one assertion race on an
    // atomic SET NX, so at most one request can ever proceed.
    let fresh: boolean;
    try {
      fresh = await this.nonces.claim(STEAM_OP_ENDPOINT, nonce);
    } catch {
      // Store unavailable (or any unexpected error): fail closed.
      throw new LoginError('provider_unavailable');
    }
    if (!fresh) throw new LoginError('replay');

    const body = new URLSearchParams();
    for (const [key, value] of params) body.append(key, value);
    body.set('openid.mode', 'check_authentication');

    let response;
    try {
      response = await this.transport.checkAuthentication(STEAM_OP_ENDPOINT, body);
    } catch {
      throw new LoginError('provider_unavailable');
    }
    if (response.status >= 500) throw new LoginError('provider_unavailable');
    if (response.status !== 200) throw new LoginError('invalid_assertion');
    const kv = parseKeyValueForm(response.body);
    if (!kv || kv.get('is_valid') !== 'true') throw new LoginError('invalid_assertion');
    if (kv.has('ns') && kv.get('ns') !== OPENID_NS) throw new LoginError('invalid_assertion');

    if (!isIndividualSteamId64(steamId64) || isSampleSteamId64(steamId64)) {
      throw new LoginError('unsupported_account', steamId64);
    }
    return steamId64;
  }
}
