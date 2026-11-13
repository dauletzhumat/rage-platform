// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { buildContentSecurityPolicy, createNonce, originOf } from './csp';

function directive(csp: string, name: string): string {
  return (
    csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith(`${name} `)) ?? ''
  );
}

describe('buildContentSecurityPolicy', () => {
  const prod = buildContentSecurityPolicy({
    nonce: 'abc123==',
    isDev: false,
    apiOrigin: 'https://api.rage.example',
  });

  it('uses a nonce + strict-dynamic for scripts, without unsafe-inline/unsafe-eval in production', () => {
    const scripts = directive(prod, 'script-src');
    expect(scripts).toContain("'nonce-abc123=='");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain('unsafe-inline');
    expect(scripts).not.toContain('unsafe-eval');
  });

  it('allows only exact Steam avatar hosts for images', () => {
    expect(directive(prod, 'img-src')).toBe(
      "img-src 'self' data: https://avatars.steamstatic.com https://avatars.akamai.steamstatic.com https://avatars.cloudflare.steamstatic.com",
    );
  });

  it('allows the API origin for fetch and form navigation; forbids framing', () => {
    expect(directive(prod, 'connect-src')).toBe("connect-src 'self' https://api.rage.example");
    expect(directive(prod, 'form-action')).toBe("form-action 'self' https://api.rage.example");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).not.toContain('upgrade-insecure-requests');
  });

  it('adds unsafe-eval and websockets only in development', () => {
    const dev = buildContentSecurityPolicy({ nonce: 'n', isDev: true, apiOrigin: null });
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(dev, 'connect-src')).toBe("connect-src 'self' ws: wss:");
  });

  it('nonces are unique and base64', () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it('originOf', () => {
    expect(originOf('http://localhost:4000/api/v1')).toBe('http://localhost:4000');
    expect(originOf('nope')).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });
});

describe('proxy', () => {
  it('sets a per-request nonce CSP on the response and forwards it to rendering', () => {
    const response = proxy(new NextRequest('http://localhost:3000/teams'));
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(directive(csp, 'script-src')).not.toContain('unsafe-inline');
    // NextResponse.next({ request: { headers } }) exposes overridden request headers this way.
    expect(response.headers.get('x-middleware-override-headers')).toContain(
      'content-security-policy',
    );
    expect(response.headers.get('x-middleware-request-x-nonce')).toBeTruthy();
    expect(response.headers.get('x-middleware-request-x-rage-path')).toBe('/teams');
    const second = proxy(new NextRequest('http://localhost:3000/teams'));
    expect(second.headers.get('content-security-policy')).not.toBe(csp);
  });

  it('redirects protected routes without a session cookie to /login with returnTo', () => {
    const response = proxy(new NextRequest('http://localhost:3000/admin/users?q=neo'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/login?returnTo=%2Fadmin%2Fusers%3Fq%3Dneo',
    );
  });

  it('lets protected routes through when a session cookie exists (pages re-check via /me)', () => {
    const request = new NextRequest('http://localhost:3000/me', {
      headers: { cookie: `rage_session=${'s'.repeat(43)}` },
    });
    const response = proxy(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('does not redirect public or placeholder routes', () => {
    for (const path of ['/', '/login', '/teams/apply', '/matchroom/x']) {
      expect(proxy(new NextRequest(`http://localhost:3000${path}`)).status).toBe(200);
    }
  });
});
