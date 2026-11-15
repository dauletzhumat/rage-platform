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

/** TEAMS.md §8 + AUTH.md §9a + TOURNAMENTS.md §11 — the contract list the catalogs must cover. */
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
  // TOURNAMENTS.md §11
  'INVALID_STATE_TRANSITION',
  'FORMAT_NOT_SUPPORTED',
  'TOURNAMENT_NAME_TAKEN',
  'REGISTRATION_CLOSED',
  'ALREADY_REGISTERED',
  'ROSTER_INVALID',
  'PLAYER_INELIGIBLE',
  'TOURNAMENT_FULL',
  'REGISTRATION_NOT_PENDING',
  'SEEDS_INVALID',
  'NOT_ENOUGH_TEAMS',
  'BRACKET_EXISTS',
  'MATCH_NOT_READY',
  'MATCH_ALREADY_COMPLETED',
  'SCORE_INVALID',
  'VETO_NOT_YOUR_TURN',
  'VETO_INVALID_MAP',
  'VETO_COMPLETE',
  'SUBSTITUTION_NOT_ALLOWED',
  'STEAM_ID_ALREADY_BANNED',
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

describe('M3 status label catalogs', () => {
  const NAMESPACES: Record<string, readonly string[]> = {
    registrationStatus: ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'],
    rosterStatus: ['DRAFT', 'LOCKED', 'SUPERSEDED'],
    rosterEntryRole: ['STARTER', 'SUBSTITUTE'],
    resultSource: ['SERVER', 'ADMIN_OVERRIDE', 'FORFEIT'],
    ineligibleReason: [
      'NOT_TEAM_MEMBER',
      'USER_INACTIVE',
      'SAMPLE',
      'BANNED',
      'ALREADY_REGISTERED_ELSEWHERE',
    ],
    matchStatus: [
      'CREATED',
      'SERVER_ASSIGNED',
      'PREPARING',
      'WARMUP',
      'READY_CHECK',
      'LIVE',
      'PAUSED',
      'COMPLETED',
      'CANCELLED',
      'FAILED',
      'DISPUTED',
    ],
  };

  it.each([
    ['en', en],
    ['ru', ru],
    ['kk', kk],
  ])('%s labels every M3 status (and no KNIFE/MAP_FINISHED series status)', (_l, messages) => {
    const catalog = messages as unknown as Record<string, Record<string, string>>;
    for (const [ns, keys] of Object.entries(NAMESPACES)) {
      for (const key of keys) expect(catalog[ns]?.[key], `${ns}.${key}`).toBeTruthy();
    }
    expect(catalog.matchStatus).not.toHaveProperty('KNIFE');
    expect(catalog.matchStatus).not.toHaveProperty('MAP_FINISHED');
  });

  it.each([
    ['ru', ru],
    ['kk', kk],
  ])('%s M3 labels are translated', (_l, messages) => {
    const catalog = messages as unknown as Record<string, Record<string, string>>;
    const english = en as unknown as Record<string, Record<string, string>>;
    for (const ns of ['registrationStatus', 'resultSource', 'ineligibleReason']) {
      for (const [key, value] of Object.entries(english[ns] ?? {})) {
        expect(catalog[ns]?.[key], `${ns}.${key}`).not.toBe(value);
      }
    }
  });
});
