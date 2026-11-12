import type { ApiErrorBody, ApiFailure, ApiResult } from './types';

export const DEFAULT_API_BASE_URL = 'http://localhost:4000/api/v1';
export const DEFAULT_TIMEOUT_MS = 5000;

export type QueryValue = string | number | boolean | null | undefined;

export interface ApiRequestOptions {
  baseUrl: string;
  query?: Record<string, QueryValue>;
  timeoutMs?: number;
  /** HTTP statuses (besides 2xx) whose JSON body is a valid payload, e.g. 503 for /health/ready. */
  acceptStatuses?: number[];
  fetchImpl?: typeof fetch;
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
 * GET a JSON resource from the RAGE API and map every outcome onto `ApiResult`:
 *  - 2xx (or an accepted status)  → `{ ok: true, data }`
 *  - 404                          → `not_found`
 *  - network error / timeout / 502 / 503 / 504 → `unavailable`
 *  - anything else (incl. invalid JSON) → `error`
 * Never throws.
 */
export async function apiGet<T>(path: string, options: ApiRequestOptions): Promise<ApiResult<T>> {
  const {
    baseUrl,
    query,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    acceptStatuses = [],
    fetchImpl = fetch,
  } = options;

  let url: string;
  try {
    url = buildUrl(baseUrl, path, query);
  } catch {
    return failure('error', 'Invalid API base URL configuration.');
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
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
  const body = await readJson(response);

  if (response.ok || acceptStatuses.includes(response.status)) {
    if (body === undefined) {
      return failure('error', 'The API returned an invalid response.', {
        status: response.status,
        ...(requestId ? { requestId } : {}),
      });
    }
    return { ok: true, data: body as T };
  }

  const errorBody = isErrorBody(body) ? body : {};
  const extra = {
    status: response.status,
    ...((errorBody.requestId ?? requestId) ? { requestId: errorBody.requestId ?? requestId } : {}),
  };

  if (response.status === 404) {
    return failure('not_found', 'The requested resource was not found.', extra);
  }
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return failure('unavailable', 'The API is temporarily unavailable.', extra);
  }
  return failure('error', `The API returned an error (HTTP ${response.status}).`, extra);
}
