/**
 * Request log serialization with an ALLOWLIST (security review MEDIUM-1).
 *
 * Query strings are never logged: from M1 they carry Steam OpenID assertions
 * (`openid.sig`, `openid.response_nonce`, `openid.claimed_id`, …) and later other
 * tokens. Headers are logged only if explicitly allowed — cookies, authorization,
 * CSRF tokens, agent credentials and `referer` (may contain query strings) never are.
 */
export const LOGGED_REQUEST_HEADERS = [
  'user-agent',
  'content-type',
  'content-length',
  'accept',
  'origin',
] as const;

export function stripQuery(url: string | undefined): string {
  const value = url ?? '';
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

interface SerializableRequest {
  id?: unknown;
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
  remoteAddress?: string;
}

export function serializeRequest(req: SerializableRequest) {
  const headers: Record<string, unknown> = {};
  for (const name of LOGGED_REQUEST_HEADERS) {
    const value = req.headers?.[name];
    if (value !== undefined) headers[name] = value;
  }
  return {
    id: req.id,
    method: req.method,
    path: stripQuery(req.url),
    headers,
    remoteAddress: req.remoteAddress,
  };
}

/** Responses: status only (no `set-cookie` or other headers). */
export function serializeResponse(res: { statusCode?: number }) {
  return { statusCode: res.statusCode };
}
