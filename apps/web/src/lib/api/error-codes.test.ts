import { describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import kk from '../../../messages/kk.json';
import ru from '../../../messages/ru.json';
import { isKnownErrorCode, KNOWN_ERROR_CODES, translatableErrorCode } from './error-codes';
import { apiSend, readErrorCode } from './http';

const BASE = 'http://api.test/api/v1';

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      }),
  ) as unknown as typeof fetch;
}

/** TEAMS.md §8 + AUTH.md §9a — the contract list the catalogs must cover. */
const CONTRACT_CODES = [
  'SAMPLE_RESOURCE',
  'APPLICATION_ALREADY_PENDING',
  'APPLICATION_NOT_PENDING',
  'APPLICANT_IN_TEAM',
  'APPLICANT_INELIGIBLE',
  'TEAM_NAME_TAKEN',
  'TEAM_TAG_TAKEN',
  'TEAM_NOT_ACTIVE',
  'PLAYER_NOT_FOUND',
  'ALREADY_MEMBER',
  'INVITATION_ALREADY_PENDING',
  'INVITATION_LIMIT',
  'INVITATION_NOT_PENDING',
  'INVITATION_EXPIRED',
  'ALREADY_IN_TEAM',
  'ROSTER_FULL',
  'NOT_TEAM_MEMBER',
  'CAPTAIN_MUST_TRANSFER',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_IN_PROGRESS',
  'UNAUTHENTICATED',
  'CSRF_FAILED',
  'FORBIDDEN_ROLE',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
];

describe('error code catalog', () => {
  it('knows every contract code', () => {
    for (const code of CONTRACT_CODES) expect(isKnownErrorCode(code), code).toBe(true);
  });

  it.each([
    ['en', en],
    ['ru', ru],
    ['kk', kk],
  ])('%s translates every known code', (_locale, messages) => {
    const catalog = messages.apiErrors as Record<string, string>;
    expect(Object.keys(catalog).sort()).toEqual([...KNOWN_ERROR_CODES].sort());
  });

  it.each([
    ['ru', ru],
    ['kk', kk],
  ])('%s code messages are real translations, not English copies', (_locale, messages) => {
    const catalog = messages.apiErrors as Record<string, string>;
    for (const code of KNOWN_ERROR_CODES) {
      expect(catalog[code], code).not.toBe((en.apiErrors as Record<string, string>)[code]);
    }
  });
});

describe('translatableErrorCode', () => {
  it('returns known business codes', () => {
    expect(translatableErrorCode({ kind: 'conflict', status: 409, code: 'ROSTER_FULL' })).toBe(
      'ROSTER_FULL',
    );
    expect(
      translatableErrorCode({ kind: 'not_found', status: 404, code: 'PLAYER_NOT_FOUND' }),
    ).toBe('PLAYER_NOT_FOUND');
  });

  it('falls back (null) for unknown codes, transport codes and 5xx', () => {
    expect(translatableErrorCode({ kind: 'conflict', status: 409, code: 'SOMETHING_NEW' })).toBe(
      null,
    );
    expect(translatableErrorCode({ kind: 'rate_limited', status: 429, code: 'RATE_LIMITED' })).toBe(
      null,
    );
    expect(translatableErrorCode({ kind: 'error', status: 500, code: 'ROSTER_FULL' })).toBe(null);
    expect(translatableErrorCode({ kind: 'conflict', status: 409 })).toBe(null);
  });
});

describe('apiSend reads ApiErrorDto.code', () => {
  it('captures a well-formed 4xx code and 409 Retry-After', async () => {
    const result = await apiSend('/x', {
      method: 'POST',
      baseUrl: BASE,
      fetchImpl: respond(
        409,
        { statusCode: 409, code: 'IDEMPOTENCY_IN_PROGRESS', message: 'busy', requestId: 'r1' },
        { 'retry-after': '1' },
      ),
    });
    expect(result).toMatchObject({
      ok: false,
      kind: 'conflict',
      code: 'IDEMPOTENCY_IN_PROGRESS',
      retryAfterSeconds: 1,
      requestId: 'r1',
    });
  });

  it('ignores codes on 5xx and malformed codes', async () => {
    const server = await apiSend('/x', {
      method: 'POST',
      baseUrl: BASE,
      fetchImpl: respond(500, { code: 'ROSTER_FULL', message: 'stack trace' }),
    });
    expect(server).not.toHaveProperty('code');
    expect(readErrorCode({ code: '<script>' })).toBeUndefined();
    expect(readErrorCode({ code: 'lower_case' })).toBeUndefined();
    expect(readErrorCode({ code: 42 })).toBeUndefined();
    expect(readErrorCode(null)).toBeUndefined();
    expect(readErrorCode({ code: 'TEAM_TAG_TAKEN' })).toBe('TEAM_TAG_TAKEN');
  });
});
