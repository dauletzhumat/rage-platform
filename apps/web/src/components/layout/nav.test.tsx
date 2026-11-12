import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { MainNav } from './main-nav';
import { AdminNav } from './admin-nav';
import { isActivePath } from './nav-items';

const pathname = vi.hoisted(() => ({ current: '/teams/some-team' }));

vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

describe('MainNav', () => {
  it('renders all public links with the current section marked', () => {
    renderWithIntl(<MainNav />);
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    const expected: Array<[string, string]> = [
      ['Home', '/'],
      ['Tournaments', '/tournaments'],
      ['Matches', '/matches'],
      ['Teams', '/teams'],
      ['Players', '/players'],
      ['Leaderboards', '/leaderboards'],
    ];
    for (const [name, href] of expected) {
      expect(within(nav).getByRole('link', { name })).toHaveAttribute('href', href);
    }
    expect(within(nav).getByRole('link', { name: 'Teams' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });
});

describe('AdminNav', () => {
  it('renders all admin sections', () => {
    pathname.current = '/admin/audit';
    renderWithIntl(<AdminNav />);
    const nav = screen.getByRole('navigation', { name: 'Admin navigation' });
    for (const name of [
      'Dashboard',
      'Team applications',
      'Tournaments',
      'Matches',
      'Servers',
      'Users',
      'Audit log',
    ]) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    }
    expect(within(nav).getByRole('link', { name: 'Audit log' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute(
      'aria-current',
    );
  });
});

describe('isActivePath', () => {
  it('matches roots exactly and sections by prefix', () => {
    expect(isActivePath('/', '/')).toBe(true);
    expect(isActivePath('/teams', '/')).toBe(false);
    expect(isActivePath('/teams/x', '/teams')).toBe(true);
    expect(isActivePath('/teamsx', '/teams')).toBe(false);
    expect(isActivePath('/admin/users', '/admin')).toBe(false);
  });
});
