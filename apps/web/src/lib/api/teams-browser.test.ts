import { describe, expect, it, vi } from 'vitest';
import {
  acceptInvitation,
  approveTeamApplication,
  declineInvitation,
  inviteToTeam,
  isRetryableIdempotentFailure,
  leaveTeam,
  rejectTeamApplication,
  removeTeamMember,
  revokeTeamInvitation,
  submitTeamApplication,
  transferCaptain,
  withdrawTeamApplication,
  type MutationOptions,
} from './browser';

const CSRF = 'c'.repeat(43);
const TEAM = '0195f1d2-0000-7000-8000-00000000000a';
const USER = '0195f1d2-0000-7000-8000-00000000000b';
const ITEM = '0195f1d2-0000-7000-8000-00000000000c';
const UUID_V4ISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function respond(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body ?? {}), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      });
}

function spy(...responses: Array<Response | Error>) {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift() ?? respond(200, {});
    if (next instanceof Error) throw next;
    return next;
  });
}

function opts(fetchSpy: ReturnType<typeof spy>, extra: Partial<MutationOptions> = {}) {
  return {
    fetchImpl: fetchSpy as unknown as typeof fetch,
    cookieString: `rage_csrf=${CSRF}`,
    sleep: vi.fn(async () => {}),
    ...extra,
  } satisfies MutationOptions;
}

function call(fetchSpy: ReturnType<typeof spy>, index = 0) {
  const [url, init] = fetchSpy.mock.calls[index] as unknown as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
}

describe('M2 browser mutations: transport', () => {
  it('POSTs with credentials, CSRF and a UUID Idempotency-Key', async () => {
    const fetchSpy = spy(respond(201, { id: ITEM }));
    const result = await submitTeamApplication({ name: 'Nova', tag: 'NV' }, opts(fetchSpy));
    expect(result).toEqual({ ok: true, data: { id: ITEM } });
    const { url, init, headers } = call(fetchSpy);
    expect(url).toMatch(/\/api\/v1\/team-applications$/);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(headers['x-csrf-token']).toBe(CSRF);
    expect(headers['Idempotency-Key']).toMatch(UUID_V4ISH);
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Nova', tag: 'NV' });
  });

  it('uses a fresh key for every user intent', async () => {
    const fetchSpy = spy(respond(200, {}), respond(200, {}));
    await acceptInvitation(ITEM, opts(fetchSpy));
    await acceptInvitation(ITEM, opts(fetchSpy));
    expect(call(fetchSpy, 0).headers['Idempotency-Key']).not.toBe(
      call(fetchSpy, 1).headers['Idempotency-Key'],
    );
  });

  it('honours a well-formed caller key and ignores a malformed one', async () => {
    const fetchSpy = spy(respond(200, {}), respond(200, {}));
    await leaveTeam(TEAM, opts(fetchSpy, { idempotencyKey: 'intent_key-1234567890' }));
    expect(call(fetchSpy, 0).headers['Idempotency-Key']).toBe('intent_key-1234567890');
    await leaveTeam(TEAM, opts(fetchSpy, { idempotencyKey: 'bad key!' }));
    expect(call(fetchSpy, 1).headers['Idempotency-Key']).toMatch(UUID_V4ISH);
  });

  it('retries once with the SAME key after a network error', async () => {
    const fetchSpy = spy(new TypeError('Failed to fetch'), respond(200, { status: 'ACCEPTED' }));
    const options = opts(fetchSpy);
    const result = await acceptInvitation(ITEM, options);
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(call(fetchSpy, 0).headers['Idempotency-Key']).toBe(
      call(fetchSpy, 1).headers['Idempotency-Key'],
    );
    expect(options.sleep).toHaveBeenCalledWith(1000);
  });

  it('retries once with the same key on 409 IDEMPOTENCY_IN_PROGRESS, honouring Retry-After', async () => {
    const fetchSpy = spy(
      respond(409, { code: 'IDEMPOTENCY_IN_PROGRESS', message: 'busy' }, { 'retry-after': '2' }),
      respond(201, { id: ITEM }),
    );
    const options = opts(fetchSpy);
    const result = await inviteToTeam(
      TEAM,
      { steamId64: '76561198000000001', role: 'PLAYER' },
      options,
    );
    expect(result.ok).toBe(true);
    expect(options.sleep).toHaveBeenCalledWith(2000);
    expect(call(fetchSpy, 0).headers['Idempotency-Key']).toBe(
      call(fetchSpy, 1).headers['Idempotency-Key'],
    );
  });

  it('gives up after one retry and returns the failure', async () => {
    const fetchSpy = spy(new TypeError('offline'), new TypeError('offline'), respond(200, {}));
    const result = await declineInvitation(ITEM, opts(fetchSpy));
    expect(result).toMatchObject({ ok: false, kind: 'unavailable' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not retry business conflicts or HTTP 503', async () => {
    const conflict = spy(respond(409, { code: 'ROSTER_FULL', message: 'Roster is full' }));
    const result = await acceptInvitation(ITEM, opts(conflict));
    expect(result).toMatchObject({ ok: false, kind: 'conflict', code: 'ROSTER_FULL' });
    expect(conflict).toHaveBeenCalledTimes(1);

    const unavailable = spy(respond(503, { message: 'down' }));
    expect(await acceptInvitation(ITEM, opts(unavailable))).toMatchObject({
      kind: 'unavailable',
      status: 503,
    });
    expect(unavailable).toHaveBeenCalledTimes(1);
  });

  it('isRetryableIdempotentFailure only covers transport loss and in-progress keys', () => {
    expect(isRetryableIdempotentFailure({ ok: false, kind: 'unavailable', message: '' })).toBe(
      true,
    );
    expect(
      isRetryableIdempotentFailure({ ok: false, kind: 'unavailable', status: 502, message: '' }),
    ).toBe(false);
    expect(
      isRetryableIdempotentFailure({
        ok: false,
        kind: 'conflict',
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: '',
      }),
    ).toBe(false);
  });
});

describe('M2 browser mutations: documented paths and bodies', () => {
  it.each([
    [
      'withdraw',
      () => withdrawTeamApplication(ITEM),
      `/team-applications/${ITEM}/withdraw`,
      undefined,
    ],
    [
      'approve',
      () => approveTeamApplication(ITEM, { note: 'ok' }),
      `/admin/team-applications/${ITEM}/approve`,
      { note: 'ok' },
    ],
    [
      'reject',
      () => rejectTeamApplication(ITEM, { reason: 'duplicate' }),
      `/admin/team-applications/${ITEM}/reject`,
      { reason: 'duplicate' },
    ],
    [
      'invite',
      () => inviteToTeam(TEAM, { steamId64: '76561198000000001', role: 'SUBSTITUTE' }),
      `/teams/${TEAM}/invitations`,
      { steamId64: '76561198000000001', role: 'SUBSTITUTE' },
    ],
    [
      'revoke',
      () => revokeTeamInvitation(TEAM, ITEM, {}),
      `/teams/${TEAM}/invitations/${ITEM}/revoke`,
      {},
    ],
    [
      'remove',
      () => removeTeamMember(TEAM, USER, { reason: 'inactive' }),
      `/teams/${TEAM}/members/${USER}/remove`,
      { reason: 'inactive' },
    ],
    ['leave', () => leaveTeam(TEAM), `/teams/${TEAM}/leave`, undefined],
    [
      'transfer',
      () => transferCaptain(TEAM, { newCaptainUserId: USER }),
      `/teams/${TEAM}/transfer-captain`,
      { newCaptainUserId: USER },
    ],
    ['accept', () => acceptInvitation(ITEM), `/invitations/${ITEM}/accept`, undefined],
    ['decline', () => declineInvitation(ITEM), `/invitations/${ITEM}/decline`, undefined],
  ] as const)('%s', async (_name, run, path, body) => {
    const fetchSpy = spy(respond(204));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const result = await run();
      expect(result).toEqual({ ok: true, data: null });
      const { url, init, headers } = call(fetchSpy);
      expect(url.endsWith(`/api/v1${path}`)).toBe(true);
      expect(init.method).toBe('POST');
      expect(headers['Idempotency-Key']).toMatch(UUID_V4ISH);
      if (body === undefined) {
        expect(init.body).toBeUndefined();
        expect(headers['content-type']).toBeUndefined();
      } else {
        expect(JSON.parse(String(init.body))).toEqual(body);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses malformed ids without any request (no path traversal)', async () => {
    const fetchSpy = spy();
    const o = opts(fetchSpy);
    const results = await Promise.all([
      withdrawTeamApplication('..', o),
      approveTeamApplication('../meta', {}, o),
      rejectTeamApplication('x', { reason: 'abc' }, o),
      inviteToTeam('team', { steamId64: '76561198000000001', role: 'PLAYER' }, o),
      revokeTeamInvitation(TEAM, '../../me', {}, o),
      removeTeamMember(TEAM, 'u', { reason: 'abc' }, o),
      leaveTeam('%2e%2e', o),
      transferCaptain(TEAM, { newCaptainUserId: 'nope' }, o),
      acceptInvitation('', o),
      declineInvitation('1', o),
    ]);
    for (const result of results) expect(result).toMatchObject({ ok: false, kind: 'not_found' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
