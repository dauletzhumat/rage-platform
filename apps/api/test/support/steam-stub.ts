import { createHmac, randomBytes } from 'node:crypto';
import {
  OPENID_NS,
  type OpenIdTransport,
  type OpenIdTransportResponse,
  STEAM_OP_ENDPOINT,
} from '../../src/auth/openid-transport.js';

/**
 * TEST-ONLY stand-in for Steam's OpenID provider. It "signs" assertions with a private
 * HMAC key and answers `check_authentication` the way the real OP does: `is_valid:true`
 * only if every signed field still has the value it signed. Tampering with claimed_id,
 * return_to, etc. after issuance therefore yields `is_valid:false`, like the real OP.
 * Injected via Nest `overrideProvider(OPENID_TRANSPORT)` — never wired in production.
 */
export class StubSteamProvider implements OpenIdTransport {
  private readonly key = randomBytes(32);
  readonly calls: URLSearchParams[] = [];
  /** Failure injection. */
  behaviour: 'normal' | 'network_error' | 'http_500' | 'http_400' | 'garbage' | 'always_valid' =
    'normal';

  sign(params: Record<string, string>): string {
    const signed = (params['openid.signed'] ?? '').split(',');
    const material = signed.map((f) => `${f}:${params[`openid.${f}`] ?? ''}\n`).join('');
    return createHmac('sha256', this.key).update(material).digest('base64');
  }

  /** Builds a positive assertion as Steam would send it to the return_to URL. */
  assertion(
    steamId64: string,
    returnTo: string,
    overrides: Record<string, string | undefined> = {},
    nonceTime = new Date(),
  ): Record<string, string> {
    const claimed = `https://steamcommunity.com/openid/id/${steamId64}`;
    const nonce = `${nonceTime.toISOString().replace(/\.\d{3}Z$/, 'Z')}${randomBytes(6).toString('hex')}`;
    const params: Record<string, string> = {
      'openid.ns': OPENID_NS,
      'openid.mode': 'id_res',
      'openid.op_endpoint': STEAM_OP_ENDPOINT,
      'openid.claimed_id': claimed,
      'openid.identity': claimed,
      'openid.return_to': returnTo,
      'openid.response_nonce': nonce,
      'openid.assoc_handle': '1234567890',
      'openid.signed':
        'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    };
    params['openid.sig'] = this.sign(params);
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) delete params[k];
      else params[k] = v;
    }
    return params;
  }

  async checkAuthentication(
    endpoint: string,
    params: URLSearchParams,
  ): Promise<OpenIdTransportResponse> {
    this.calls.push(new URLSearchParams(params));
    if (endpoint !== STEAM_OP_ENDPOINT) throw new Error('unexpected endpoint');
    switch (this.behaviour) {
      case 'network_error':
        throw new Error('ECONNRESET');
      case 'http_500':
        return { status: 500, body: 'oops' };
      case 'http_400':
        return { status: 400, body: 'bad' };
      case 'garbage':
        return { status: 200, body: '<html>not kv</html>' };
      case 'always_valid':
        return { status: 200, body: `ns:${OPENID_NS}\nis_valid:true\n` };
      default:
        break;
    }
    if (params.get('openid.mode') !== 'check_authentication') {
      return { status: 200, body: `ns:${OPENID_NS}\nis_valid:false\n` };
    }
    const record: Record<string, string> = {};
    for (const [k, v] of params) record[k] = v;
    const valid = record['openid.sig'] === this.sign(record);
    return { status: 200, body: `ns:${OPENID_NS}\nis_valid:${valid ? 'true' : 'false'}\n` };
  }
}

/** Individual-range SteamID64s for tests (never sample range). */
export function testSteamId(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000_000;
  return `76561198${String(n).padStart(9, '0')}`;
}
