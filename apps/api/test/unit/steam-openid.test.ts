import { beforeEach, describe, expect, it } from 'vitest';
import { LoginError } from '../../src/auth/auth.constants.js';
import { type NonceStore } from '../../src/auth/nonce-store.js';
import { OPENID_NS, STEAM_OP_ENDPOINT } from '../../src/auth/openid-transport.js';
import {
  extractOpenIdParams,
  parseKeyValueForm,
  SteamOpenIdService,
} from '../../src/auth/steam-openid.service.js';
import type { SteamAuthSettings } from '../../src/config/env.js';
import { StubSteamProvider } from '../support/steam-stub.js';

const settings: SteamAuthSettings = {
  realm: 'http://localhost:4000',
  returnUrl: 'http://localhost:4000/api/v1/auth/steam/callback',
  webPublicUrl: 'http://localhost:3000',
  sessionSecret: 'x'.repeat(43),
};
const STATE = 'A'.repeat(43);
const RETURN_TO = `${settings.returnUrl}?state=${STATE}`;
const STEAM_ID = '76561198000000042';

class MemoryNonceStore implements NonceStore {
  readonly seen = new Set<string>();
  failing = false;
  async claim(op: string, nonce: string): Promise<boolean> {
    if (this.failing) throw new Error('redis down');
    const key = `${op}|${nonce}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}

const toMap = (p: Record<string, string>) => new Map(Object.entries(p));

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(LoginError);
    return (err as LoginError).code;
  }
  return 'ok';
}

describe('SteamOpenIdService', () => {
  let op: StubSteamProvider;
  let nonces: MemoryNonceStore;
  let svc: SteamOpenIdService;

  beforeEach(() => {
    op = new StubSteamProvider();
    nonces = new MemoryNonceStore();
    svc = new SteamOpenIdService(settings, op, nonces);
  });

  it('builds a checkid_setup redirect with identifier_select, realm and state-bound return_to', () => {
    const url = new URL(svc.buildAuthRedirectUrl(STATE));
    expect(`${url.origin}${url.pathname}`).toBe(STEAM_OP_ENDPOINT);
    const q = url.searchParams;
    expect(q.get('openid.ns')).toBe(OPENID_NS);
    expect(q.get('openid.mode')).toBe('checkid_setup');
    expect(q.get('openid.claimed_id')).toBe('http://specs.openid.net/auth/2.0/identifier_select');
    expect(q.get('openid.identity')).toBe('http://specs.openid.net/auth/2.0/identifier_select');
    expect(q.get('openid.realm')).toBe('http://localhost:4000');
    expect(q.get('openid.return_to')).toBe(RETURN_TO);
  });

  it('accepts a genuine assertion and calls check_authentication with all params', async () => {
    const a = op.assertion(STEAM_ID, RETURN_TO);
    await expect(svc.verifyAssertion(toMap(a), STATE)).resolves.toBe(STEAM_ID);
    expect(op.calls).toHaveLength(1);
    const sent = op.calls[0]!;
    expect(sent.get('openid.mode')).toBe('check_authentication');
    expect(sent.get('openid.sig')).toBe(a['openid.sig']);
    expect(sent.get('openid.claimed_id')).toBe(a['openid.claimed_id']);
  });

  it('accepts the http:// claimed_id form documented by Steam', async () => {
    const claimed = `http://steamcommunity.com/openid/id/${STEAM_ID}`;
    op.behaviour = 'always_valid';
    const a = op.assertion(STEAM_ID, RETURN_TO, {
      'openid.claimed_id': claimed,
      'openid.identity': claimed,
    });
    await expect(svc.verifyAssertion(toMap(a), STATE)).resolves.toBe(STEAM_ID);
  });

  it('cancel → cancelled (no OP call)', async () => {
    expect(await codeOf(svc.verifyAssertion(toMap({ 'openid.mode': 'cancel' }), STATE))).toBe(
      'cancelled',
    );
    expect(op.calls).toHaveLength(0);
  });

  const preNetwork: [string, Record<string, string | undefined>][] = [
    ['mode setup_needed', { 'openid.mode': 'setup_needed' }],
    ['missing mode', { 'openid.mode': undefined }],
    ['OpenID 1.x namespace', { 'openid.ns': 'http://openid.net/signon/1.1' }],
    ['foreign op_endpoint', { 'openid.op_endpoint': 'https://evil.example/openid/login' }],
    ['http op_endpoint', { 'openid.op_endpoint': 'http://steamcommunity.com/openid/login' }],
    ['wrong return_to host', { 'openid.return_to': `http://evil.example/cb?state=${STATE}` }],
    ['return_to without state', { 'openid.return_to': settings.returnUrl }],
    [
      'return_to with other state',
      { 'openid.return_to': `${settings.returnUrl}?state=${'B'.repeat(43)}` },
    ],
    [
      'return_to with extra param',
      { 'openid.return_to': `${RETURN_TO}&returnTo=https://evil.example` },
    ],
    [
      'claimed_id != identity',
      { 'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000043' },
    ],
    [
      'claimed_id on foreign host',
      {
        'openid.claimed_id': 'https://evil.example/openid/id/76561198000000042',
        'openid.identity': 'https://evil.example/openid/id/76561198000000042',
      },
    ],
    [
      'claimed_id host suffix trick',
      {
        'openid.claimed_id': 'https://steamcommunity.com.evil.example/openid/id/76561198000000042',
        'openid.identity': 'https://steamcommunity.com.evil.example/openid/id/76561198000000042',
      },
    ],
    [
      'claimed_id with trailing data',
      {
        'openid.claimed_id': 'https://steamcommunity.com/openid/id/76561198000000042/x',
        'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000042/x',
      },
    ],
    [
      'claimed_id with 16 digits',
      {
        'openid.claimed_id': 'https://steamcommunity.com/openid/id/7656119800000004',
        'openid.identity': 'https://steamcommunity.com/openid/id/7656119800000004',
      },
    ],
    ['missing sig', { 'openid.sig': undefined }],
    ['missing assoc_handle', { 'openid.assoc_handle': undefined }],
    [
      'claimed_id not signed',
      { 'openid.signed': 'op_endpoint,identity,return_to,response_nonce,assoc_handle' },
    ],
    [
      'return_to not signed',
      { 'openid.signed': 'op_endpoint,claimed_id,identity,response_nonce,assoc_handle' },
    ],
    [
      'nonce not signed',
      { 'openid.signed': 'op_endpoint,claimed_id,identity,return_to,assoc_handle' },
    ],
    [
      'signed lists an absent field',
      {
        'openid.signed':
          'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle,invalidate_handle',
      },
    ],
    ['malformed nonce', { 'openid.response_nonce': 'not-a-nonce' }],
    ['missing nonce', { 'openid.response_nonce': undefined }],
  ];

  it.each(preNetwork)('%s → invalid_assertion without contacting the OP', async (_n, overrides) => {
    const a = op.assertion(STEAM_ID, RETURN_TO, overrides);
    expect(await codeOf(svc.verifyAssertion(toMap(a), STATE))).toBe('invalid_assertion');
    expect(op.calls).toHaveLength(0);
  });

  it('stale nonce (> 5 min old) → replay', async () => {
    const a = op.assertion(STEAM_ID, RETURN_TO, {}, new Date(Date.now() - 6 * 60_000));
    expect(await codeOf(svc.verifyAssertion(toMap(a), STATE))).toBe('replay');
  });

  it('future nonce (> 5 min ahead) → replay', async () => {
    const a = op.assertion(STEAM_ID, RETURN_TO, {}, new Date(Date.now() + 6 * 60_000));
    expect(await codeOf(svc.verifyAssertion(toMap(a), STATE))).toBe('replay');
  });

  it('nonce within ±5 min is accepted (clock skew tolerance)', async () => {
    const a = op.assertion(STEAM_ID, RETURN_TO, {}, new Date(Date.now() - 4 * 60_000));
    await expect(svc.verifyAssertion(toMap(a), STATE)).resolves.toBe(STEAM_ID);
  });

  it('reused nonce → replay; the OP is contacted only once', async () => {
    const a = op.assertion(STEAM_ID, RETURN_TO);
    await svc.verifyAssertion(toMap(a), STATE);
    expect(await codeOf(svc.verifyAssertion(toMap(a), STATE))).toBe('replay');
    expect(op.calls).toHaveLength(1);
  });

  it('nonce store unavailable → provider_unavailable (fail closed, no OP call)', async () => {
    nonces.failing = true;
    const a = op.assertion(STEAM_ID, RETURN_TO);
    expect(await codeOf(svc.verifyAssertion(toMap(a), STATE))).toBe('provider_unavailable');
    expect(op.calls).toHaveLength(0);
  });

  it('forged claimed_id (signature no longer matches) → invalid_assertion', async () => {
    const victim = 'https://steamcommunity.com/openid/id/76561198000000099';
    const a = op.assertion(STEAM_ID, RETURN_TO, {
      'openid.claimed_id': victim,
      'openid.identity': victim,
    });
    expect(await codeOf(svc.verifyAssertion(toMap(a), STATE))).toBe('invalid_assertion');
  });

  it('invalid signature → invalid_assertion', async () => {
    const a = op.assertion(STEAM_ID, RETURN_TO, { 'openid.sig': 'Zm9yZ2Vk' });
    expect(await codeOf(svc.verifyAssertion(toMap(a), STATE))).toBe('invalid_assertion');
  });

  it.each([
    ['network_error', 'provider_unavailable'],
    ['http_500', 'provider_unavailable'],
    ['http_400', 'invalid_assertion'],
    ['garbage', 'invalid_assertion'],
  ] as const)('OP %s → %s', async (behaviour, code) => {
    op.behaviour = behaviour;
    const a = op.assertion(STEAM_ID, RETURN_TO);
    expect(await codeOf(svc.verifyAssertion(toMap(a), STATE))).toBe(code);
  });

  it('OP response with duplicate is_valid lines → invalid_assertion', async () => {
    const svc2 = new SteamOpenIdService(
      settings,
      {
        checkAuthentication: async () => ({ status: 200, body: 'is_valid:false\nis_valid:true\n' }),
      },
      nonces,
    );
    const a = op.assertion(STEAM_ID, RETURN_TO);
    expect(await codeOf(svc2.verifyAssertion(toMap(a), STATE))).toBe('invalid_assertion');
  });

  it.each([
    ['sample-range SteamID', '76561190000000001'],
    ['below individual range', '76561197960265727'],
    ['above individual range', '76561202255233024'],
  ])('%s → unsupported_account (after verification)', async (_n, id) => {
    op.behaviour = 'always_valid';
    const a = op.assertion(id, RETURN_TO);
    const err = await svc.verifyAssertion(toMap(a), STATE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LoginError);
    expect((err as LoginError).code).toBe('unsupported_account');
  });
});

describe('extractOpenIdParams', () => {
  it('keeps only openid.* params', () => {
    const m = extractOpenIdParams('state=abc&openid.mode=id_res&foo=bar');
    expect([...m.keys()]).toEqual(['openid.mode']);
  });

  it('rejects duplicated openid.* keys (parameter pollution)', () => {
    expect(() =>
      extractOpenIdParams('openid.claimed_id=https%3A%2F%2Fa&openid.claimed_id=https%3A%2F%2Fb'),
    ).toThrow(LoginError);
  });

  it('rejects oversized values', () => {
    expect(() => extractOpenIdParams(`openid.sig=${'a'.repeat(3000)}`)).toThrow(LoginError);
  });
});

describe('parseKeyValueForm', () => {
  it('parses Steam responses', () => {
    expect(parseKeyValueForm(`ns:${OPENID_NS}\nis_valid:true\n`)?.get('is_valid')).toBe('true');
  });
  it('rejects duplicate keys', () => {
    expect(parseKeyValueForm('is_valid:true\nis_valid:true\n')).toBeUndefined();
  });
});
