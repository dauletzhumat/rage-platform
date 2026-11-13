import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { MobileAccount } from '@/components/layout/mobile-account';
import { ApiErrorState } from './api-error-state';
import { AuthRequired } from './auth-required';
import { MutationError } from './mutation-error';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

describe('ApiErrorState', () => {
  it('renders 429 as "too many requests" with retry-after, not as an unexpected error', () => {
    renderWithIntl(<ApiErrorState failure={{ kind: 'rate_limited', retryAfterSeconds: 7 }} />);
    expect(screen.getByRole('heading', { name: 'Too many requests' })).toBeInTheDocument();
    expect(screen.getByText(/retry in 7 seconds/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText(/unexpected/i)).toBeNull();
  });

  it('renders 429 without retry-after', () => {
    renderWithIntl(<ApiErrorState failure={{ kind: 'rate_limited' }} />);
    expect(screen.getByText(/Please retry shortly/)).toBeInTheDocument();
  });

  it('renders forbidden and unauthenticated states', () => {
    renderWithIntl(<ApiErrorState failure={{ kind: 'forbidden' }} />);
    expect(screen.getByRole('heading', { name: "You don't have access" })).toBeInTheDocument();
  });
});

describe('AuthRequired', () => {
  it('links to login with the returnTo path', () => {
    renderWithIntl(<AuthRequired pageTitle="Apply" returnTo="/teams/apply" />);
    expect(screen.getByRole('link', { name: 'Sign in with Steam' })).toHaveAttribute(
      'href',
      '/login?returnTo=%2Fteams%2Fapply',
    );
  });
});

describe('MutationError', () => {
  it('uses the context-specific 409 message and shows the safe server detail', () => {
    renderWithIntl(
      <MutationError
        failure={{
          ok: false,
          kind: 'conflict',
          message: 'x',
          serverMessage: 'Role already granted',
          requestId: 'r9',
        }}
        conflictMessage="Already granted."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Already granted.');
    expect(screen.getByRole('alert')).toHaveTextContent('Details: Role already granted');
    expect(screen.getByRole('alert')).toHaveTextContent('Request ID: r9');
  });

  it('never shows server text for non-400/409 failures', () => {
    renderWithIntl(
      <MutationError
        failure={{ ok: false, kind: 'error', message: 'x', serverMessage: 'stack at /srv' }}
      />,
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('stack');
  });
});

describe('MobileAccount', () => {
  it('shows the admin link only for admins', () => {
    const viewer = { nickname: 'Neo', slug: 'neo', avatarUrl: null, isAdmin: false };
    renderWithIntl(<MobileAccount viewer={viewer} />);
    expect(screen.getByRole('link', { name: 'My profile' })).toHaveAttribute('href', '/me');
    expect(screen.queryByRole('link', { name: 'Admin panel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('renders the admin link for admins', () => {
    renderWithIntl(
      <MobileAccount viewer={{ nickname: 'Neo', slug: 'neo', avatarUrl: null, isAdmin: true }} />,
    );
    expect(screen.getByRole('link', { name: 'Admin panel' })).toHaveAttribute('href', '/admin');
  });
});
