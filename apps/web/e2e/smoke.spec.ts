import { expect, test, type APIRequestContext } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4599/api/v1';

async function apiIsUp(request: APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get(`${API_URL}/health/live`, { timeout: 2000 });
    return res.ok();
  } catch {
    return false;
  }
}

const publicRoutes = [
  '/',
  '/login',
  '/players',
  '/teams',
  '/tournaments',
  '/matches',
  '/leaderboards',
  '/design-system',
];

/** Protected placeholders: signed out → sign-in-required state with a returnTo link. */
const protectedRoutes: Array<[string, string]> = [
  ['/teams/apply', '/teams/apply'],
  ['/teams/some-team/manage', '/teams/some-team/manage'],
  // Not a UUID → returnTo falls back to the matches list.
  ['/matchroom/some-match', '/matches'],
];

/** Session-only routes: without a session cookie the proxy redirects to /login. */
const redirectRoutes = ['/me', '/me/invitations'];

const adminRoutes = [
  '/admin',
  '/admin/team-applications',
  '/admin/tournaments',
  '/admin/matches',
  '/admin/servers',
  '/admin/users',
  '/admin/audit',
];

function scriptSrc(csp: string): string {
  return (
    csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('script-src ')) ?? ''
  );
}

test.describe('public routes', () => {
  for (const route of publicRoutes) {
    test(`${route} returns 200 and renders an h1`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await expect(page.locator('h1').first()).toBeVisible();
      await expect(page.locator('main#main-content')).toBeVisible();
      // No server stack traces leak into the page.
      await expect(page.locator('body')).not.toContainText(/\bat .+\.(ts|js):\d+/);
    });
  }

  test('title template is applied', async ({ page }) => {
    await page.goto('/teams');
    await expect(page).toHaveTitle(/· RAGE$/);
  });

  test('security headers are present', async ({ request }) => {
    const res = await request.get('/');
    const headers = res.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    // Production build: HSTS is sent (ignored by browsers on plain http).
    expect(headers['strict-transport-security']).toContain('max-age=');
    expect(headers['referrer-policy']).toBeTruthy();
    expect(headers['permissions-policy']).toBeTruthy();
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('CSP uses a per-request nonce and no unsafe-inline for scripts (SEC-M0-M3)', async ({
    request,
  }) => {
    const first = await request.get('/teams');
    const csp = first.headers()['content-security-policy'] ?? '';
    const scripts = scriptSrc(csp);
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(scripts)?.[1];
    expect(nonce, csp).toBeTruthy();
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(csp).toContain("img-src 'self' data: https://avatars.steamstatic.com");
    // Next.js applied the nonce to its own inline/bootstrap scripts.
    const html = await first.text();
    expect(html).toContain(`nonce="${nonce}"`);
    // A fresh nonce for every response.
    const second = await request.get('/teams');
    expect(scriptSrc(second.headers()['content-security-policy'] ?? '')).not.toBe(scripts);
  });

  test('pages hydrate under the strict CSP without violations', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (msg) => {
      if (/Content Security Policy|Refused to (execute|load)/i.test(msg.text())) {
        violations.push(msg.text());
      }
    });
    await page.goto('/');
    await page.getByRole('button', { name: /Change language/ }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Русский' })).toBeVisible();
    expect(violations).toEqual([]);
  });

  test('skip link moves focus target to main content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute('href', '#main-content');
  });
});

test.describe('login page', () => {
  test('renders a real Steam sign-in link (no JS required)', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    const link = page.getByTestId('steam-sign-in');
    await expect(link).toHaveAttribute('href', /\/api\/v1\/auth\/steam\?returnTo=%2F$/);
    await expect(page.getByText('RAGE never asks for your Steam password')).toBeVisible();
  });

  test('carries a sanitised returnTo', async ({ page }) => {
    await page.goto('/login?returnTo=/teams/apply');
    await expect(page.getByTestId('steam-sign-in')).toHaveAttribute(
      'href',
      /\/api\/v1\/auth\/steam\?returnTo=%2Fteams%2Fapply$/,
    );
    await page.goto('/login?returnTo=//evil.com');
    await expect(page.getByTestId('steam-sign-in')).toHaveAttribute(
      'href',
      /\/api\/v1\/auth\/steam\?returnTo=%2F$/,
    );
  });

  test('shows translated callback errors and never echoes unknown codes', async ({ page }) => {
    await page.goto('/login?error=cancelled');
    await expect(page.getByTestId('login-error')).toContainText('Sign-in was cancelled on Steam.');
    await page.goto('/login?error=%3Cscript%3Ex');
    await expect(page.getByTestId('login-error')).toContainText(
      'Sign-in failed. Please try again.',
    );
    await expect(page.getByTestId('login-error')).not.toContainText('<script>');
  });

  test('header sign-in link carries the current page as returnTo', async ({ page }) => {
    await page.goto('/teams');
    await expect(page.getByTestId('sign-in-link').first()).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fteams',
    );
  });
});

test.describe('protected routes (no session)', () => {
  for (const [route, returnTo] of protectedRoutes) {
    test(`${route} shows sign-in required with returnTo`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await expect(page.getByTestId('auth-required')).toContainText('Sign-in required');
      await expect(
        page.getByTestId('auth-required').getByRole('link', { name: 'Sign in with Steam' }),
      ).toHaveAttribute('href', `/login?returnTo=${encodeURIComponent(returnTo)}`);
      await expect(page.locator('form')).toHaveCount(0);
    });
  }

  for (const route of redirectRoutes) {
    test(`${route} redirects to /login?returnTo=${route}`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(`/login?returnTo=${encodeURIComponent(route)}`);
      const href = await page.getByTestId('steam-sign-in').getAttribute('href');
      expect(href?.endsWith(`/auth/steam?returnTo=${encodeURIComponent(route)}`), href ?? '').toBe(
        true,
      );
    });
  }
});

test.describe('admin routes (no session)', () => {
  for (const route of adminRoutes) {
    test(`${route} redirects to login without rendering admin UI`, async ({ page, request }) => {
      const raw = await request.get(route, { maxRedirects: 0 });
      expect(raw.status()).toBe(307);
      expect(raw.headers()['location']).toMatch(
        new RegExp(`/login\\?returnTo=${encodeURIComponent(route)}$`),
      );
      await page.goto(route);
      await expect(page).toHaveURL(`/login?returnTo=${encodeURIComponent(route)}`);
      await expect(page.getByRole('navigation', { name: 'Admin navigation' })).toHaveCount(0);
    });
  }
});

test.describe('error handling', () => {
  test('unknown route renders the 404 page', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  });

  test('with the API down, data pages show an error state instead of crashing', async ({
    page,
    request,
  }) => {
    test.skip(await apiIsUp(request), 'API is reachable; API-down scenario not applicable');
    for (const route of [
      '/teams',
      '/players',
      '/tournaments',
      '/matches',
      '/teams/any-slug',
      // A well-formed UUID: malformed ids are rejected as not-found before any API call.
      '/matches/0195f1d2-0000-7000-8000-000000000000',
    ]) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBe(200);
      await expect(page.getByRole('heading', { name: 'API unavailable' }), route).toBeVisible();
      await expect(page.getByRole('button', { name: 'Try again' }), route).toBeVisible();
    }
    await page.goto('/');
    await expect(page.getByTestId('api-status')).toContainText('API unreachable');
  });
});

test.describe('i18n', () => {
  test('language switcher sets NEXT_LOCALE and re-renders in Russian', async ({
    page,
    context,
  }) => {
    await page.goto('/teams');
    const trigger = page.getByRole('button', { name: /Change language/ });
    const russian = page.getByRole('menuitemradio', { name: 'Русский' });
    // The trigger is server-rendered; retry until the client bundle has hydrated it.
    await expect(async () => {
      if (!(await russian.isVisible())) await trigger.click();
      await expect(russian).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await russian.click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.getByRole('heading', { level: 1, name: 'Команды' })).toBeVisible();
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === 'NEXT_LOCALE')?.value).toBe('ru');
  });

  test('Accept-Language is used when no cookie is set', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'kk-KZ' });
    const page = await context.newPage();
    await page.goto('/leaderboards');
    await expect(page.locator('html')).toHaveAttribute('lang', 'kk');
    await context.close();
  });
});

test.describe('mobile navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('menu dialog opens, is keyboard-closable and lists all sections', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    for (const name of ['Home', 'Tournaments', 'Matches', 'Teams', 'Players', 'Leaderboards']) {
      await expect(dialog.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
