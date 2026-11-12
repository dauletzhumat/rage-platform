import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Full-stack smoke against a RUNNING API seeded with `pnpm --filter @rage/db seed:sample`.
 * Skipped automatically when the API is not reachable (default local e2e run).
 *   E2E_API_URL=http://127.0.0.1:4000/api/v1 pnpm --filter @rage/web test:e2e
 */
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:4599/api/v1';

async function apiGet<T>(request: APIRequestContext, path: string): Promise<T | null> {
  try {
    const res = await request.get(`${API_URL}${path}`, { timeout: 3000 });
    return res.ok() ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

interface Page<T> {
  items: T[];
  total: number;
}
interface Team {
  slug: string;
  name: string;
  tag: string;
  isSample: boolean;
}

test.describe('live data (real API + sample seed)', () => {
  test.beforeEach(async ({ request }) => {
    const teams = await apiGet<Page<Team>>(request, '/teams');
    test.skip(!teams || teams.total === 0, 'API not reachable or not seeded with sample data');
  });

  test('home reports the API as operational with honest feature flags', async ({ page }) => {
    await page.goto('/');
    const status = page.getByTestId('api-status');
    await expect(status).toBeVisible();
    await expect(status).not.toContainText('API unreachable');
  });

  test('teams list renders API teams with the Sample data badge', async ({ page, request }) => {
    const teams = (await apiGet<Page<Team>>(request, '/teams'))!;
    await page.goto('/teams');
    for (const team of teams.items) {
      await expect(page.getByRole('link', { name: team.name }).first()).toBeVisible();
    }
    if (teams.items.some((t) => t.isSample)) {
      await expect(page.getByText('Sample data').first()).toBeVisible();
    }
  });

  test('team page shows the current roster from the API', async ({ page, request }) => {
    const first = (await apiGet<Page<Team>>(request, '/teams'))!.items[0]!;
    const detail = await apiGet<{ roster: { nickname: string }[] }>(
      request,
      `/teams/${first.slug}`,
    );
    await page.goto(`/teams/${first.slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(first.name);
    for (const member of detail!.roster) {
      await expect(page.getByText(member.nickname, { exact: true }).first()).toBeVisible();
    }
  });

  test('tournaments and matches lists render API data', async ({ page, request }) => {
    const tournaments = await apiGet<Page<{ name: string }>>(request, '/tournaments');
    await page.goto('/tournaments');
    for (const t of tournaments!.items) {
      await expect(page.getByText(t.name).first()).toBeVisible();
    }
    const matches = await apiGet<Page<{ id: string }>>(request, '/matches');
    await page.goto('/matches');
    if (matches!.total === 0) return;
    const res = await page.goto(`/matches/${matches!.items[0]!.id}`);
    expect(res?.status()).toBe(200);
  });

  test('unknown team slug renders the not-found UI with noindex, not an error', async ({
    page,
  }) => {
    // Known limitation (docs/PROGRESS.md): (public)/loading.tsx starts streaming, so Next 16
    // keeps HTTP 200 ("soft 404") and injects robots noindex. Real 404 status: M6.
    const res = await page.goto('/teams/definitely-not-a-team');
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
    await expect(page.getByTestId('api-status')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/Unexpected|stack|TypeError/);
  });
});
