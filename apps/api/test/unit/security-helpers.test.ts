import { describe, expect, it } from 'vitest';
import { serializeRequest, stripQuery } from '../../src/common/http/log-serializers.js';
import { escapeLike } from '../../src/common/http/search.js';

describe('escapeLike', () => {
  it.each([
    ['%', '\\%'],
    ['_', '\\_'],
    ['\\', '\\\\'],
    ['a%b_c\\d', 'a\\%b\\_c\\\\d'],
    ['plain', 'plain'],
  ])('%j → %j', (input, expected) => {
    expect(escapeLike(input)).toBe(expected);
  });
});

describe('request log serialization', () => {
  it('drops query strings and fragments', () => {
    expect(stripQuery('/api/v1/auth/steam/callback?openid.sig=abc&openid.response_nonce=x')).toBe(
      '/api/v1/auth/steam/callback',
    );
    expect(stripQuery('/a#frag')).toBe('/a');
    expect(stripQuery(undefined)).toBe('');
  });

  it('logs only allowlisted headers', () => {
    const out = serializeRequest({
      id: 'r1',
      method: 'GET',
      url: '/api/v1/teams?q=secret',
      remoteAddress: '127.0.0.1',
      headers: {
        'user-agent': 'ua',
        cookie: 'rage_session=s3cr3t',
        authorization: 'Bearer t0k3n',
        'x-csrf-token': 'csrf',
        referer: 'https://rage.example/x?token=leak',
        'x-agent-signature': 'sig',
      },
    });
    expect(out).toEqual({
      id: 'r1',
      method: 'GET',
      path: '/api/v1/teams',
      remoteAddress: '127.0.0.1',
      headers: { 'user-agent': 'ua' },
    });
    expect(JSON.stringify(out)).not.toMatch(/secret|s3cr3t|t0k3n|csrf|leak|sig/);
  });
});
