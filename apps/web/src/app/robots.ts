import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/me', '/matchroom', '/teams/apply', '/design-system', '/login'],
      },
    ],
  };
}
