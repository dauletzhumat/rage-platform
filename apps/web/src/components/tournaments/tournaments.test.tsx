import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithIntl } from '@/test/render';
import type * as BrowserApi from '@/lib/api/browser';
import type { BracketDto, BracketMatchDto, MatchTeamRefM3, VetoStateDto } from '@/lib/api/types';
import { MatchStatusPill } from '@/components/domain/status';
import { BracketView } from './bracket-view';
import { ResultOverrideDialog } from './match-admin-dialogs';
import { RosterSelectionForm } from './roster-selection-form';
import { ResultSourceBadge } from './status-badges';
import { TournamentForm } from './tournament-form';
import { VetoBoard } from './veto-board';

const refresh = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh, push }),
}));

const api = vi.hoisted(() => ({
  createRegistration: vi.fn(),
  updateRegistrationRoster: vi.fn(),
  submitVeto: vi.fn(),
  createTournament: vi.fn(),
  overrideMatchResult: vi.fn(),
}));
vi.mock('@/lib/api/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserApi>()),
  ...api,
}));

const id = (n: number) => `0195f1d2-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`;
const ALPHA: MatchTeamRefM3 = { id: id(90), slug: 'alpha', name: 'Alpha', tag: 'ALP' };
const BETA: MatchTeamRefM3 = { id: id(91), slug: 'beta', name: 'Beta', tag: 'BET' };
const GAMMA: MatchTeamRefM3 = { id: id(92), slug: 'gamma', name: 'Gamma', tag: 'GAM' };
const POOL = ['de_alpha', 'de_bravo', 'de_charlie', 'de_delta', 'de_echo', 'de_foxtrot', 'de_golf'];

beforeEach(() => {
  refresh.mockReset();
  push.mockReset();
  for (const fn of Object.values(api)) fn.mockReset();
});

function bracketMatch(overrides: Partial<BracketMatchDto>): BracketMatchDto {
  return {
    id: id(1),
    format: 'BO3',
    isSample: false,
    scheduledAt: null,
    status: 'CREATED',
    teamA: null,
    teamB: null,
    tournament: { name: 'Cup', slug: 'cup' },
    winnerTeamSlug: null,
    winnerTeamId: null,
    nextMatchId: null,
    teamAScore: null,
    teamBScore: null,
    resultSource: null,
    resultVerifiedAt: null,
    statusReason: null,
    round: null,
    slotNumber: 1,
    teamASeed: null,
    teamBSeed: null,
    isBye: false,
    ...overrides,
  };
}

describe('BracketView', () => {
  const bracket: BracketDto = {
    format: 'SINGLE_ELIMINATION',
    size: 4,
    rounds: [
      {
        roundNumber: 2,
        name: 'Final',
        matches: [bracketMatch({ id: id(3), teamA: ALPHA, teamASeed: 1, slotNumber: 1 })],
      },
      {
        roundNumber: 1,
        name: 'Semifinals',
        matches: [
          bracketMatch({
            id: id(1),
            slotNumber: 1,
            status: 'CANCELLED',
            statusReason: 'bye',
            isBye: true,
            teamA: ALPHA,
            teamASeed: 1,
          }),
          bracketMatch({
            id: id(2),
            slotNumber: 2,
            status: 'COMPLETED',
            teamA: BETA,
            teamB: GAMMA,
            teamASeed: 2,
            teamBSeed: 3,
            teamAScore: 2,
            teamBScore: 1,
            winnerTeamSlug: 'beta',
            resultSource: 'ADMIN_OVERRIDE',
          }),
        ],
      },
    ],
  };

  it('renders rounds as ordered lists with localized names (round 1 first)', () => {
    renderWithIntl(<BracketView bracket={bracket} />);
    const rounds = within(screen.getByRole('list', { name: /Bracket rounds/ })).getAllByRole(
      'heading',
    );
    expect(rounds.map((h) => h.textContent)).toEqual([
      expect.stringContaining('Semifinals'),
      expect.stringContaining('Final'),
    ]);
  });

  it('shows byes without a match link, TBD slots and the Admin result flag', () => {
    renderWithIntl(<BracketView bracket={bracket} />);
    expect(screen.getByTestId('bracket-bye')).toHaveTextContent('Alpha advances');
    const matches = screen.getAllByTestId('bracket-match');
    expect(matches).toHaveLength(2);
    const semi = screen.getByRole('article', { name: 'Beta vs Gamma' });
    expect(semi).toHaveAttribute('data-result-source', 'ADMIN_OVERRIDE');
    expect(within(semi).getByText('Admin result — not server-verified')).toHaveClass('sr-only');
    expect(within(semi).getByText('Winner')).toBeInTheDocument();
    const final = screen.getByRole('article', { name: 'Alpha vs TBD' });
    expect(within(final).getByText('TBD')).toBeInTheDocument();
    expect(within(final).getByRole('link', { name: /Details/ })).toHaveAttribute(
      'href',
      `/matches/${id(3)}`,
    );
  });
});

describe('ResultSourceBadge and series status', () => {
  it('labels admin and forfeit results; never as server-verified', () => {
    renderWithIntl(
      <>
        <ResultSourceBadge source="ADMIN_OVERRIDE" />
        <ResultSourceBadge source="FORFEIT" />
        <ResultSourceBadge source={null} />
      </>,
    );
    expect(screen.getByText('Admin result — not server-verified')).toBeInTheDocument();
    expect(screen.getByText('Forfeit')).toBeInTheDocument();
    expect(screen.queryByText('Server-verified')).not.toBeInTheDocument();
  });

  it('does not render map states as series statuses', () => {
    renderWithIntl(<MatchStatusPill status={'KNIFE' as never} />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.queryByText(/Knife/)).not.toBeInTheDocument();
  });
});

describe('VetoBoard', () => {
  const state: VetoStateDto = {
    pool: POOL,
    actions: [
      { sequence: 1, teamId: ALPHA.id, action: 'BAN', mapName: 'de_alpha', createdAt: '' },
      { sequence: 2, teamId: BETA.id, action: 'BAN', mapName: 'de_bravo', createdAt: '' },
    ],
    next: { teamId: ALPHA.id, action: 'PICK' },
    remaining: POOL.slice(2),
    complete: false,
  };
  const props = {
    matchId: id(5),
    format: 'BO3' as const,
    teamA: ALPHA,
    teamB: BETA,
    state,
    matchOpen: true,
  };

  it('shows whose turn it is and no buttons for other viewers', () => {
    renderWithIntl(<VetoBoard {...props} operatedTeamIds={[BETA.id]} />);
    expect(screen.getByTestId('veto-turn')).toHaveTextContent('Waiting for Alpha to pick a map.');
    expect(screen.queryByRole('button', { name: /^Pick / })).not.toBeInTheDocument();
    const steps = within(screen.getByTestId('veto-sequence')).getAllByRole('listitem');
    expect(steps[0]).toHaveTextContent('Alpha bans');
    expect(steps[0]).toHaveTextContent('de_alpha');
    expect(steps[2]).toHaveAttribute('aria-current', 'step');
    expect(steps[6]).toHaveTextContent('Decider');
  });

  it('gives the acting operator Pick buttons for remaining maps only and submits after confirm', async () => {
    const user = userEvent.setup();
    api.submitVeto.mockResolvedValue({ ok: true, data: state });
    renderWithIntl(<VetoBoard {...props} operatedTeamIds={[ALPHA.id]} />);
    expect(screen.getByTestId('veto-turn')).toHaveTextContent('Your turn: pick a map.');
    expect(screen.getAllByRole('button', { name: /^Pick de_/ })).toHaveLength(5);
    expect(screen.queryByRole('button', { name: 'Pick de_alpha' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pick de_charlie' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Pick' }));
    await waitFor(() =>
      expect(api.submitVeto).toHaveBeenCalledWith(id(5), { action: 'PICK', mapName: 'de_charlie' }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('offers SUPER_ADMIN an explicitly labelled override', () => {
    renderWithIntl(<VetoBoard {...props} operatedTeamIds={[]} canOverride />);
    expect(screen.getByTestId('veto-turn')).toHaveTextContent(
      'Admin override: pick a map for Alpha.',
    );
    expect(screen.getAllByRole('button', { name: /^Pick de_/ })).toHaveLength(5);
  });

  it('hides buttons when the match is not open', () => {
    renderWithIntl(<VetoBoard {...props} operatedTeamIds={[ALPHA.id]} matchOpen={false} />);
    expect(screen.queryByRole('button', { name: /^Pick / })).not.toBeInTheDocument();
  });
});

describe('RosterSelectionForm', () => {
  const candidates = Array.from({ length: 7 }, (_, i) => ({
    userId: id(10 + i),
    nickname: `player${i}`,
    teamRole: (i === 0 ? 'CAPTAIN' : i >= 5 ? 'SUBSTITUTE' : 'PLAYER') as
      'CAPTAIN' | 'PLAYER' | 'SUBSTITUTE',
  }));
  const initial = Object.fromEntries(
    candidates.map((c, i) => [c.userId, i < 5 ? 'STARTER' : 'SUBSTITUTE'] as const),
  );

  it('blocks submission with a wrong starter count and sends nothing', async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <RosterSelectionForm
        tournamentId={id(1)}
        teamId={id(2)}
        candidates={candidates}
        initial={initial}
      />,
    );
    expect(screen.getByTestId('roster-counters')).toHaveTextContent('Starters: 5 / 5');
    const group = screen.getByRole('radiogroup', { name: /player1/ });
    await user.click(within(group).getByLabelText('Not selected'));
    expect(screen.getByTestId('roster-counters')).toHaveTextContent('Starters: 4 / 5');
    await user.click(screen.getByRole('button', { name: 'Submit registration' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose exactly 5 starters.');
    expect(api.createRegistration).not.toHaveBeenCalled();
  });

  it('submits 5 + 2 and shows per-player PLAYER_INELIGIBLE reasons', async () => {
    const user = userEvent.setup();
    api.createRegistration.mockResolvedValue({
      ok: false,
      kind: 'conflict',
      status: 409,
      code: 'PLAYER_INELIGIBLE',
      message: 'x',
      details: [
        { field: id(13), message: 'BANNED' },
        { field: id(16), message: 'ALREADY_REGISTERED_ELSEWHERE' },
      ],
    });
    renderWithIntl(
      <RosterSelectionForm
        tournamentId={id(1)}
        teamId={id(2)}
        candidates={candidates}
        initial={initial}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Submit registration' }));
    await waitFor(() =>
      expect(api.createRegistration).toHaveBeenCalledWith(id(1), {
        teamId: id(2),
        starters: candidates.slice(0, 5).map((c) => c.userId),
        substitutes: candidates.slice(5).map((c) => c.userId),
      }),
    );
    expect(await screen.findByText('This SteamID64 is banned.')).toBeInTheDocument();
    expect(
      screen.getByText("Already on another team's roster in this tournament."),
    ).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /player3/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Some players are not eligible.');
  });

  it('edits a pending registration via PUT', async () => {
    const user = userEvent.setup();
    api.updateRegistrationRoster.mockResolvedValue({ ok: true, data: {} });
    renderWithIntl(
      <RosterSelectionForm
        tournamentId={id(1)}
        teamId={id(2)}
        candidates={candidates}
        initial={initial}
        registrationId={id(3)}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Save roster' }));
    await waitFor(() => expect(api.updateRegistrationRoster).toHaveBeenCalled());
    expect(api.updateRegistrationRoster.mock.calls[0]?.slice(0, 2)).toEqual([id(1), id(3)]);
    expect(await screen.findByText('Roster saved as a new version.')).toBeInTheDocument();
  });
});

describe('TournamentForm', () => {
  it('has exactly 7 empty map inputs (no built-in pool) and validates them', async () => {
    const user = userEvent.setup();
    renderWithIntl(<TournamentForm />);
    const maps = Array.from({ length: 7 }, (_, i) => screen.getByLabelText(`Map ${i + 1}`));
    for (const input of maps) expect(input).toHaveValue('');
    await user.type(screen.getByLabelText('Name'), 'Winter Cup');
    await user.type(maps[0]!, 'mirage');
    await user.click(screen.getByRole('button', { name: 'Create tournament' }));
    expect(maps[0]).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText('Use de_ followed by 2–30 lowercase letters, digits or _.'),
    ).toBeInTheDocument();
    expect(maps[0]).toHaveFocus();
    expect(api.createTournament).not.toHaveBeenCalled();
  });

  it('creates a tournament and navigates to its admin page', async () => {
    const user = userEvent.setup();
    api.createTournament.mockResolvedValue({ ok: true, data: { id: id(7) } });
    renderWithIntl(<TournamentForm />);
    await user.type(screen.getByLabelText('Name'), 'Winter Cup');
    for (let i = 0; i < 7; i++) await user.type(screen.getByLabelText(`Map ${i + 1}`), POOL[i]!);
    await user.click(screen.getByRole('button', { name: 'Create tournament' }));
    await waitFor(() =>
      expect(api.createTournament).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Winter Cup',
          format: 'SINGLE_ELIMINATION',
          mapPool: POOL,
        }),
      ),
    );
    expect(push).toHaveBeenCalledWith(`/admin/tournaments/${id(7)}`);
  });

  it('maps TOURNAMENT_NAME_TAKEN to the name field', async () => {
    const user = userEvent.setup();
    api.createTournament.mockResolvedValue({
      ok: false,
      kind: 'conflict',
      status: 409,
      code: 'TOURNAMENT_NAME_TAKEN',
      message: 'x',
    });
    renderWithIntl(<TournamentForm />);
    await user.type(screen.getByLabelText('Name'), 'Winter Cup');
    for (let i = 0; i < 7; i++) await user.type(screen.getByLabelText(`Map ${i + 1}`), POOL[i]!);
    await user.click(screen.getByRole('button', { name: 'Create tournament' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(
      screen.getAllByText('A tournament with this name already exists.').length,
    ).toBeGreaterThan(0);
  });
});

describe('ResultOverrideDialog', () => {
  it('warns that the result is not server-verified and validates the score per format', async () => {
    const user = userEvent.setup();
    api.overrideMatchResult.mockResolvedValue({ ok: true, data: {} });
    renderWithIntl(
      <ResultOverrideDialog matchId={id(5)} format="BO3" teamA={ALPHA} teamB={BETA} />,
    );
    await user.click(screen.getByRole('button', { name: 'Enter result for Alpha vs Beta' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('note')).toHaveTextContent('not server-verified');
    await user.click(within(dialog).getByLabelText('Alpha'));
    await user.type(within(dialog).getByLabelText('Maps won — Alpha'), '3');
    await user.type(within(dialog).getByLabelText('Maps won — Beta'), '0');
    await user.type(within(dialog).getByLabelText('Reason'), 'server outage');
    await user.click(within(dialog).getByRole('button', { name: 'Save admin result' }));
    expect(within(dialog).getByText(/does not fit BO3/)).toBeInTheDocument();
    expect(api.overrideMatchResult).not.toHaveBeenCalled();

    await user.clear(within(dialog).getByLabelText('Maps won — Alpha'));
    await user.type(within(dialog).getByLabelText('Maps won — Alpha'), '2');
    await user.click(within(dialog).getByRole('button', { name: 'Save admin result' }));
    await waitFor(() =>
      expect(api.overrideMatchResult).toHaveBeenCalledWith(id(5), {
        winnerTeamId: ALPHA.id,
        teamAScore: 2,
        teamBScore: 0,
        reason: 'server outage',
      }),
    );
  });
});
