import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithIntl } from '@/test/render';
import type * as BrowserApi from '@/lib/api/browser';
import { MembershipCard } from '@/components/me/membership-card';
import { MutationError } from '@/components/states/mutation-error';
import { InviteForm } from './invite-form';
import { ApplicationStatusBadge } from './status-badges';
import { LeaveTeamButton, RejectApplicationButton } from './team-actions';
import { TeamApplicationForm } from './team-application-form';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

const api = vi.hoisted(() => ({
  submitTeamApplication: vi.fn(),
  rejectTeamApplication: vi.fn(),
  leaveTeam: vi.fn(),
  inviteToTeam: vi.fn(),
}));
vi.mock('@/lib/api/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserApi>()),
  ...api,
}));

const TEAM = '0195f1d2-0000-7000-8000-00000000000a';
const APP = '0195f1d2-0000-7000-8000-00000000000c';

beforeEach(() => {
  refresh.mockReset();
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('MutationError with API codes', () => {
  it('shows the translated code message instead of the English server text', () => {
    renderWithIntl(
      <MutationError
        failure={{
          ok: false,
          kind: 'conflict',
          status: 409,
          code: 'ROSTER_FULL',
          message: 'x',
          serverMessage: 'Roster is full (7)',
        }}
        conflictMessage="Generic conflict"
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The roster is full.');
    expect(alert).not.toHaveTextContent('Generic conflict');
    expect(alert).not.toHaveTextContent('Roster is full (7)');
  });

  it('unknown codes fall back to the generic per-kind message', () => {
    renderWithIntl(
      <MutationError
        failure={{ ok: false, kind: 'forbidden', status: 403, code: 'BRAND_NEW', message: 'x' }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/Not allowed/);
  });
});

describe('TeamApplicationForm', () => {
  it('validates client-side, focuses the first invalid field and sends nothing', async () => {
    const user = userEvent.setup();
    renderWithIntl(<TeamApplicationForm />);
    await user.type(screen.getByLabelText('Team name'), 'ab');
    await user.type(screen.getByLabelText('Tag'), 'TOOLONG');
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    expect(screen.getByText('Team name must be 3–32 characters.')).toBeInTheDocument();
    expect(screen.getByText('Tag must be 2–6 letters or digits (A–Z, 0–9).')).toBeInTheDocument();
    expect(screen.getByLabelText('Team name')).toHaveFocus();
    expect(screen.getByLabelText('Team name')).toHaveAttribute('aria-invalid', 'true');
    expect(api.submitTeamApplication).not.toHaveBeenCalled();
  });

  it('submits the normalised body and refreshes the page on success', async () => {
    api.submitTeamApplication.mockResolvedValue({ ok: true, data: { id: APP } });
    const user = userEvent.setup();
    renderWithIntl(<TeamApplicationForm />);
    await user.type(screen.getByLabelText('Team name'), '  Nova  ');
    await user.type(screen.getByLabelText('Tag'), 'NV');
    await user.type(screen.getByLabelText('Country'), 'kz');
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    await waitFor(() =>
      expect(api.submitTeamApplication).toHaveBeenCalledWith({
        name: 'Nova',
        tag: 'NV',
        countryCode: 'KZ',
      }),
    );
    expect(await screen.findByText('Application submitted for review.')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it('puts TEAM_TAG_TAKEN on the tag field', async () => {
    api.submitTeamApplication.mockResolvedValue({
      ok: false,
      kind: 'conflict',
      status: 409,
      code: 'TEAM_TAG_TAKEN',
      message: 'x',
    });
    const user = userEvent.setup();
    renderWithIntl(<TeamApplicationForm />);
    await user.type(screen.getByLabelText('Team name'), 'Nova');
    await user.type(screen.getByLabelText('Tag'), 'NV');
    await user.click(screen.getByRole('button', { name: 'Submit application' }));
    await waitFor(() => expect(screen.getByLabelText('Tag')).toHaveFocus());
    expect(screen.getByLabelText('Tag')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('This team tag is already taken.');
  });
});

describe('RejectApplicationButton (dialog)', () => {
  it('requires a 3–500 character reason, then rejects and refreshes', async () => {
    api.rejectTeamApplication.mockResolvedValue({ ok: true, data: {} });
    const user = userEvent.setup();
    renderWithIntl(<RejectApplicationButton applicationId={APP} teamName="Nova" summary="Hi" />);
    const trigger = screen.getByRole('button', { name: 'Reject application Nova' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Reject Nova?' });
    expect(within(dialog).getByText('Hi')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(within(dialog).getByText('Reason must be 3–500 characters.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Reason')).toHaveFocus();
    expect(api.rejectTeamApplication).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Reason'), '  duplicate  ');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await waitFor(() =>
      expect(api.rejectTeamApplication).toHaveBeenCalledWith(APP, { reason: 'duplicate' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(refresh).toHaveBeenCalled();
  });

  it('keeps the dialog open with a translated error on failure; Escape closes it', async () => {
    api.rejectTeamApplication.mockResolvedValue({
      ok: false,
      kind: 'conflict',
      status: 409,
      code: 'APPLICATION_NOT_PENDING',
      message: 'x',
    });
    const user = userEvent.setup();
    renderWithIntl(<RejectApplicationButton applicationId={APP} teamName="Nova" />);
    await user.click(screen.getByRole('button', { name: 'Reject application Nova' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Reason'), 'spam');
    await user.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This application has already been reviewed or withdrawn.',
    );
    expect(refresh).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Reject application Nova' })).toHaveFocus();
  });
});

describe('LeaveTeamButton', () => {
  it('asks for confirmation before leaving', async () => {
    api.leaveTeam.mockResolvedValue({ ok: true, data: null });
    const user = userEvent.setup();
    renderWithIntl(<LeaveTeamButton teamId={TEAM} teamName="Nova" />);
    await user.click(screen.getByRole('button', { name: 'Leave Nova' }));
    expect(api.leaveTeam).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Leave Nova?' });
    await user.click(within(dialog).getByRole('button', { name: 'Leave team' }));
    await waitFor(() => expect(api.leaveTeam).toHaveBeenCalledWith(TEAM));
  });
});

describe('InviteForm', () => {
  it('rejects a malformed SteamID64 without a request', async () => {
    const user = userEvent.setup();
    renderWithIntl(<InviteForm teamId={TEAM} />);
    await user.type(screen.getByLabelText('SteamID64'), '12345');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect(
      screen.getByText('Enter a valid 17-digit SteamID64 of an individual Steam account.'),
    ).toBeInTheDocument();
    expect(api.inviteToTeam).not.toHaveBeenCalled();
  });

  it('invites with the chosen role and shows PLAYER_NOT_FOUND translated', async () => {
    api.inviteToTeam.mockResolvedValue({
      ok: false,
      kind: 'not_found',
      status: 404,
      code: 'PLAYER_NOT_FOUND',
      message: 'x',
    });
    const user = userEvent.setup();
    renderWithIntl(<InviteForm teamId={TEAM} />);
    await user.type(screen.getByLabelText('SteamID64'), '76561198000000001');
    await user.selectOptions(screen.getByLabelText('Role'), 'SUBSTITUTE');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() =>
      expect(api.inviteToTeam).toHaveBeenCalledWith(TEAM, {
        steamId64: '76561198000000001',
        role: 'SUBSTITUTE',
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /No RAGE player with this SteamID64/,
    );
  });

  it('is disabled when the pending cap is reached', () => {
    renderWithIntl(<InviteForm teamId={TEAM} disabled />);
    expect(screen.getByRole('button', { name: 'Send invitation' })).toBeDisabled();
  });
});

describe('MembershipCard (/me)', () => {
  const base = {
    teamId: TEAM,
    teamSlug: 'nova',
    teamName: 'Nova',
    joinedAt: '2026-11-01T10:00:00.000Z',
  };

  it('member: team link, role and Leave', () => {
    renderWithIntl(<MembershipCard membership={{ ...base, role: 'PLAYER' }} />);
    expect(screen.getByRole('link', { name: 'Nova' })).toHaveAttribute('href', '/teams/nova');
    expect(screen.getByText('Player')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave Nova' })).toBeInTheDocument();
  });

  it('captain: transfer-first notice plus Leave (disbands when sole member)', () => {
    renderWithIntl(<MembershipCard membership={{ ...base, role: 'CAPTAIN' }} />);
    expect(screen.getByRole('button', { name: 'Leave Nova' })).toBeInTheDocument();
    expect(screen.getByText(/transfer captaincy first/)).toBeInTheDocument();
    expect(screen.getByText(/the team will be disbanded/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage team' })).toHaveAttribute(
      'href',
      '/teams/nova/manage',
    );
  });

  it('no team: apply link; unknown (API without membership) renders nothing', () => {
    const { unmount } = renderWithIntl(<MembershipCard membership={null} />);
    expect(screen.getByRole('link', { name: 'Apply to create a team' })).toHaveAttribute(
      'href',
      '/teams/apply',
    );
    unmount();
    renderWithIntl(<MembershipCard membership={undefined} />);
    expect(screen.queryByTestId('membership-card')).toBeNull();
  });

  it('never builds a link from an invalid slug', () => {
    renderWithIntl(
      <MembershipCard membership={{ ...base, teamSlug: '../admin', role: 'PLAYER' }} />,
    );
    expect(screen.queryByRole('link', { name: 'Nova' })).toBeNull();
  });
});

describe('ApplicationStatusBadge', () => {
  it('renders text, not colour alone', () => {
    renderWithIntl(<ApplicationStatusBadge status="REJECTED" />);
    expect(screen.getByText('Rejected')).toHaveAttribute('data-status', 'REJECTED');
  });
});
