import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const isProd = process.env.NODE_ENV === 'production';

/*
 * Content-Security-Policy is NOT set here: it carries a per-request nonce and is
 * generated in `src/proxy.ts` (see `src/lib/security/csp.ts`, security SEC-M0-M3).
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // HSTS only for production builds (browsers ignore it on plain http, e.g. local e2e).
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
    : []),
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
