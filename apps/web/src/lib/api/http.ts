import type { ApiErrorBody, ApiFailure, ApiFieldError, ApiResult } from './types';

export const DEFAULT_API_BASE_URL = 'http://localhost:4000/api/v1';
export const DEFAULT_TIMEOUT_MS = 5000;

export type QueryValue = string | number | boolean | null | undefined;
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface ApiRequestOptions {
  baseUrl: string;
  query?: Record<string, QueryValue>;
  timeoutMs?: number;
  /** HTTP statuses (besides 2xx) whose JSON body is a valid payload, e.g. 503 for /health/ready. */
  acceptStatuses?: number[];
  /** Extra request headers (SSR token, forwarded cookie, CSRF token …). */
  headers?: Record<string, string>;
  /** Browser-only: `include` sends the API's cookies cross-port (same-site). */
  credentials?: RequestCredentials;
  fetchImpl?: typeof fetch;
}

export interface ApiSendOptions extends ApiRequestOptions {
  method: HttpMethod;
  /** JSON body; omitted when undefined. */
  body?: unknown;
}

export function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, QueryValue>,
): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(base + suffix);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function isErrorBody(value: unknown): value is Partial<ApiErrorBody> {
  return typeof value === 'object' && value !== null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function failure(
  kind: ApiFailure['kind'],
  message: string,
  extra: Partial<Omit<ApiFailure, 'ok' | 'kind' | 'message'>> = {},
): ApiFailure {
  return { ok: false, kind, message, ...extra };
}

/**
 * `Retry-After` is either delta-seconds or an HTTP date (RFC 9110 §10.2.3).
 * Returns whole seconds ≥ 0, or undefined when absent/unparseable.
 */
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

const MAX_DETAILS = 50;
const MAX_TEXT = 500;

/** Keep only well-formed `{ field, message }` entries (bounded) from an error envelope. */
function readDetails(body: Partial<ApiErrorBody>): ApiFieldError[] | undefined {
  const raw = (body as { details?: unknown }).details;
  if (!Array.isArray(raw)) return undefined;
  const details = raw
    .filter(
      (d): d is ApiFieldError =>
        typeof d === 'object' &&
        d !== null &&
        typeof (d as ApiFieldError).field === 'string' &&
        typeof (d as ApiFieldError).message === 'string',
    )
    .slice(0, MAX_DETAILS)
    .map((d) => ({ field: d.field.slice(0, 200), message: d.message.slice(0, MAX_TEXT) }));
  return details.length > 0 ? details : undefined;
}

/** Error codes are SCREAMING_SNAKE identifiers (docs/AUTH.md §9a, TEAMS.md §8). */
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

/** `ApiErrorDto.code` when well-formed; anything else is ignored (never rendered raw). */
export function readErrorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' && ERROR_CODE_PATTERN.test(code) ? code : undefined;
}

function readServerMessage(body: Partial<ApiErrorBody>): string | undefined {
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string' && message.trim()) return message.slice(0, MAX_TEXT);
  if (Array.isArray(message) && typeof message[0] === 'string')
    return message[0].slice(0, MAX_TEXT);
  return undefined;
}

/**
 * Send a request to the RAGE API and map every outcome onto `ApiResult`:
 *  - 2xx (or an accepted status)  → `{ ok: true, data }` (204 → `data: null`)
 *  - 400 → `validation` (+ `details`, `serverMessage`)
 *  - 401 → `unauthenticated`
 *  - 403 → `forbidden`
 *  - 404 → `not_found`
 *  - 409 → `conflict` (+ `serverMessage`)
 *  - 429 → `rate_limited` (+ `retryAfterSeconds`)
 *  - network error / timeout / 502 / 503 / 504 → `unavailable`
 *  - anything else (incl. invalid JSON) → `error`
 * Never throws. Server messages are only surfaced for 400/409 (documented as safe to display);
 * 5xx bodies are never shown.
 */
export async function apiSend<T>(path: string, options: ApiSendOptions): Promise<ApiResult<T>> {
  const {
    method,
    body,
    baseUrl,
    query,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    acceptStatuses = [],
    headers = {},
    credentials,
    fetchImpl = fetch,
  } = options;

  let url: string;
  try {
    url = buildUrl(baseUrl, path, query);
  } catch {
    return failure('error', 'Invalid API base URL configuration.');
  }

  const requestHeaders: Record<string, string> = { accept: 'application/json', ...headers };
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: requestHeaders,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
      ...(credentials ? { credentials } : {}),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (cause) {
    const timedOut =
      cause instanceof DOMException &&
      (cause.name === 'TimeoutError' || cause.name === 'AbortError');
    return failure(
      'unavailable',
      timedOut ? 'The API did not respond in time.' : 'The API is unreachable.',
    );
  }

  const requestId = response.headers.get('x-request-id') ?? undefined;

  if (response.status === 204) {
    return { ok: true, data: null as T };
  }

  const json = await readJson(response);

  if (response.ok || acceptStatuses.includes(response.status)) {
    if (json === undefined) {
      return failure('error', 'The API returned an invalid response.', {
        status: response.status,
        ...(requestId ? { requestId } : {}),
      });
    }
    return { ok: true, data: json as T };
  }

  const errorBody = isErrorBody(json) ? json : {};
  const effectiveRequestId =
    typeof errorBody.requestId === 'string' ? errorBody.requestId : requestId;
  // 5xx never carry a code (AUTH.md §9a); only 4xx codes are trusted for branching.
  const code =
    response.status >= 400 && response.status < 500 ? readErrorCode(errorBody) : undefined;
  const extra = {
    status: response.status,
    ...(effectiveRequestId ? { requestId: effectiveRequestId } : {}),
    ...(code ? { code } : {}),
  };

  switch (response.status) {
    case 400: {
      const details = readDetails(errorBody);
      const serverMessage = readServerMessage(errorBody);
      return failure('validation', 'The request was rejected by validation.', {
        ...extra,
        ...(details ? { details } : {}),
        ...(serverMessage ? { serverMessage } : {}),
      });
    }
    case 401:
      return failure('unauthenticated', 'Sign-in required.', extra);
    case 403:
      return failure('forbidden', 'You do not have permission for this action.', extra);
    case 404:
      return failure('not_found', 'The requested resource was not found.', extra);
    case 409: {
      const serverMessage = readServerMessage(errorBody);
      // e.g. IDEMPOTENCY_IN_PROGRESS + `Retry-After: 1` (TEAMS.md §7).
      const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'));
      return failure('conflict', 'The request conflicts with the current state.', {
        ...extra,
        ...(serverMessage ? { serverMessage } : {}),
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      });
    }
    case 429: {
      const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'));
      return failure('rate_limited', 'Too many requests.', {
        ...extra,
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      });
    }
    case 502:
    case 503:
    case 504:
      return failure('unavailable', 'The API is temporarily unavailable.', extra);
    default:
      return failure('error', `The API returned an error (HTTP ${response.status}).`, extra);
  }
}

/** GET a JSON resource (see `apiSend` for the outcome mapping). Never throws. */
export function apiGet<T>(path: string, options: ApiRequestOptions): Promise<ApiResult<T>> {
  return apiSend<T>(path, { ...options, method: 'GET' });
}
