// Runs against the compiled client (dist/). `pnpm --filter @rage/api-client build` first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiClient, isApiError } from '../dist/index.js';

function recordingFetch(status, body) {
  const calls = [];
  const fetchImpl = async (input) => {
    calls.push(typeof input === 'string' ? input : input.url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetchImpl };
}

test('accepts a base URL with the /api/v1 prefix and calls typed paths once-prefixed', async () => {
  const { calls, fetchImpl } = recordingFetch(200, { status: 'ok' });
  const client = createApiClient('http://localhost:4000/api/v1/', { fetch: fetchImpl });
  const { data, error } = await client.GET('/api/v1/health/live');
  assert.equal(error, undefined);
  assert.deepEqual(data, { status: 'ok' });
  assert.deepEqual(calls, ['http://localhost:4000/api/v1/health/live']);
});

test('accepts a bare origin too', async () => {
  const { calls, fetchImpl } = recordingFetch(200, { items: [], page: 1, pageSize: 20, total: 0 });
  const client = createApiClient('https://rage.example', { fetch: fetchImpl });
  await client.GET('/api/v1/teams', { params: { query: { page: 2, q: 'fal' } } });
  assert.equal(calls[0], 'https://rage.example/api/v1/teams?page=2&q=fal');
});

test('surfaces the normalized error envelope', async () => {
  const envelope = {
    statusCode: 404,
    error: 'Not Found',
    message: 'Team not found',
    requestId: 'r1',
  };
  const { fetchImpl } = recordingFetch(404, envelope);
  const client = createApiClient('http://localhost:4000/api/v1', { fetch: fetchImpl });
  const { data, error, response } = await client.GET('/api/v1/teams/{slug}', {
    params: { path: { slug: 'missing' } },
  });
  assert.equal(data, undefined);
  assert.equal(response.status, 404);
  assert.ok(isApiError(error));
  assert.equal(error.message, 'Team not found');
});

test('isApiError rejects non-envelopes', () => {
  assert.equal(isApiError(null), false);
  assert.equal(isApiError({ message: 'x' }), false);
  assert.equal(isApiError({ statusCode: 500, message: 'x', requestId: 1 }), false);
});
