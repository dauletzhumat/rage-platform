import { expect, test } from '@playwright/test';

/**
 * Signed-in smoke. Needs a REAL session (there is no dev login / bypass by design):
 *  1. Run the API with Steam OpenID configured and sign in once through steamcommunity.com.
 *  2. Copy the `rage_session` cookie value (and optionally `rage_csrf`) from the browser.
 *  3. E2E_API_URL=http://127.0.0.1:4000/api/v1 E2E_SESSION_COOKIE=<value> \
 *     [E2E_EXPECT_ADMIN=1] pnpm --filter @rage/web test:e2e auth-session
 * Skipped when E2E_SESSION_COOKIE is not set (default CI / API-down run).
 */
const SESSION = process.env.E2E_SESSION_COOKIE;
const EXPECT_ADMIN = process.env.E2E_EXPECT_ADMIN === '1';

test.describe('signed-in session (opt-in)', () => {
  test.skip(!SESSION, 'E2E_SESSION_COOKIE not provided');

  test.beforeEach(async ({ context, baseURL }) => {
    const url = new URL(baseURL ?? 'http://127.0.0.1:3100');
    await context.addCookies([
      { name: 'rage_session', value: SESSION!, domain: url.hostname, path: '/', httpOnly: true },
    ]);
  });

  test('/me shows the verified SteamID64 and the profile form', async ({ page }) => {
    await page.goto('/me');
    await expect(page).toHaveURL(/\/me$/);
    await expect(page.getByTestId('me-steam-id')).toHaveText(/^\d{17}$/);
    await expect(page.getByLabel('Nickname')).toBeVisible();
  });

  test('header shows the account menu instead of the sign-in link', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('account-menu-trigger')).toBeVisible();
    await expect(page.getByTestId('sign-in-link')).toHaveCount(0);
  });

  test('/login redirects a signed-in user to /me', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/me$/);
  });

  test('/admin is guarded by role', async ({ page }) => {
    await page.goto('/admin');
    if (EXPECT_ADMIN) {
      await expect(page.getByRole('navigation', { name: 'Admin navigation' })).toBeVisible();
    } else {
      await expect(page.getByTestId('forbidden')).toContainText("You don't have access");
      await expect(page.getByRole('navigation', { name: 'Admin navigation' })).toHaveCount(0);
    }
  });
});
