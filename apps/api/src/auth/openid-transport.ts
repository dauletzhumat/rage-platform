/** Steam's OpenID 2.0 OP endpoint (the only endpoint we ever talk to or accept). */
export const STEAM_OP_ENDPOINT = 'https://steamcommunity.com/openid/login';
export const OPENID_NS = 'http://specs.openid.net/auth/2.0';
export const OPENID_TRANSPORT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 16 * 1024;

export interface OpenIdTransportResponse {
  status: number;
  body: string;
}

/**
 * Direct (server-to-server) communication with the OpenID provider. Injectable so tests can
 * substitute a stub (docs/AUTH.md §1); production always uses `FetchOpenIdTransport`.
 * Implementations throw on network errors / timeouts.
 */
export interface OpenIdTransport {
  checkAuthentication(endpoint: string, params: URLSearchParams): Promise<OpenIdTransportResponse>;
}

export const OPENID_TRANSPORT = Symbol('OPENID_TRANSPORT');

export class OpenIdTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenIdTransportError';
  }
}

/** Reads at most `limit` bytes of a response body (defence against oversized replies). */
export async function readLimitedText(response: Response, limit: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new OpenIdTransportError('response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Default transport: HTTPS POST, 5 s timeout, redirects are errors (never followed). */
export class FetchOpenIdTransport implements OpenIdTransport {
  constructor(
    private readonly fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
    private readonly timeoutMs = OPENID_TRANSPORT_TIMEOUT_MS,
  ) {}

  async checkAuthentication(
    endpoint: string,
    params: URLSearchParams,
  ): Promise<OpenIdTransportResponse> {
    if (endpoint !== STEAM_OP_ENDPOINT) {
      throw new OpenIdTransportError('refusing to contact a non-Steam OpenID endpoint');
    }
    const response = await this.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
        accept: 'text/plain',
      },
      body: params.toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = await readLimitedText(response, MAX_RESPONSE_BYTES);
    return { status: response.status, body };
  }
}
