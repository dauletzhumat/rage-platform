import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const isDev = process.env.NODE_ENV === 'development';

/** Origin of the browser-facing API (used for `connect-src`). */
function apiOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Content Security Policy without nonces (keeps static optimisation possible).
 * Next.js injects inline bootstrap scripts, so `'unsafe-inline'` is required for
 * script-src until we move to nonce/SRI based CSP (tracked as a known gap).
 * `'unsafe-eval'` and websocket connections are only allowed in development
 * (React dev tooling + HMR).
 */
function contentSecurityPolicy(): string {
  const connect = ["'self'", apiOrigin(), isDev ? 'ws: wss:' : null].filter(Boolean).join(' ');
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ];
  return directives.join('; ');
}

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  output: 'standalone',
  // Monorepo: trace files from the workspace root so the standalone bundle
  // includes hoisted/workspace dependencies (used by the Docker image).
  outputFileTracingRoot: path.join(import.meta.dirname, '..', '..'),
  transpilePackages: ['geist', '@rage/api-client'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
