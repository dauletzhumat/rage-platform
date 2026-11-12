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

const protectedRoutes = [
  '/me',
  '/me/invitations',
  '/teams/apply',
  '/teams/some-team/manage',
  '/matchroom/some-match',
];

const adminRoutes = [
  '/admin',
  '/admin/team-applications',
  '/admin/tournaments',
  '/admin/matches',
  '/admin/servers',
  '/admin/users',
  '/admin/audit',
];

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
    expect(headers['referrer-policy']).toBeTruthy();
    expect(headers['permissions-policy']).toBeTruthy();
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('skip link moves focus target to main content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute('href', '#main-content');
  });
});

test.describe('protected routes (M0: no session)', () => {
  for (const route of protectedRoutes) {
    test(`${route} shows sign-in required`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await expect(page.getByTestId('auth-required')).toContainText('Sign-in required');
      await expect(page.locator('form')).toHaveCount(0);
    });
  }
});

test.describe('admin routes (M0: no session)', () => {
  for (const route of adminRoutes) {
    test(`${route} shows admin shell + administrator required`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('navigation', { name: 'Admin navigation' })).toBeVisible();
      await expect(page.getByTestId('auth-required')).toContainText(
        'Administrator session required',
      );
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
