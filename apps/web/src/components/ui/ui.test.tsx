import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './button';
import { EmptyState } from './empty-state';
import { SampleDataBadge } from './sample-data-badge';
import { StatusPill, matchStatusTone, tournamentStatusTone } from './status-pill';
import { renderWithIntl } from '@/test/render';
import { MATCH_STATUSES, TOURNAMENT_STATUSES } from '@/lib/api/types';

describe('Button', () => {
  it('renders a type=button by default with the primary variant', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.className).toContain('bg-accent-strong');
  });

  it('applies variant and size classes', () => {
    render(
      <Button variant="destructive" size="sm">
        Delete
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button.className).toContain('text-danger');
    expect(button.className).toContain('h-8');
  });

  it('renders its child element with asChild', () => {
    render(
      <Button asChild variant="secondary">
        <a href="#roster">Teams</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Teams' });
    expect(link).toHaveAttribute('href', '#roster');
    expect(link).not.toHaveAttribute('type');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('can be disabled', () => {
    render(<Button disabled>Sign in</Button>);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });
});

describe('StatusPill', () => {
  it('renders the text label (status is never conveyed by colour alone)', () => {
    render(<StatusPill tone="live" label="Live" pulse />);
    const pill = screen.getByText('Live');
    expect(pill).toHaveAttribute('data-tone', 'live');
    expect(pill.querySelector('[aria-hidden="true"]')?.className).toContain(
      'motion-safe:animate-live-pulse',
    );
  });

  it('maps every match and tournament status to a tone', () => {
    for (const status of MATCH_STATUSES) expect(matchStatusTone(status)).toBeTruthy();
    for (const status of TOURNAMENT_STATUSES) expect(tournamentStatusTone(status)).toBeTruthy();
    expect(matchStatusTone('LIVE')).toBe('live');
    expect(matchStatusTone('COMPLETED')).toBe('success');
    expect(matchStatusTone('FAILED')).toBe('danger');
    expect(tournamentStatusTone('REGISTRATION_OPEN')).toBe('success');
  });
});

describe('SampleDataBadge', () => {
  it('shows a visible "Sample data" label with an explanation', () => {
    renderWithIntl(<SampleDataBadge />);
    const badge = screen.getByText('Sample data');
    expect(badge).toBeVisible();
    expect(badge).toHaveAttribute('title', expect.stringContaining('not a real'));
  });
});

describe('EmptyState', () => {
  it('renders title, description and action', () => {
    render(
      <EmptyState
        title="No teams yet"
        description="Nothing here."
        action={<button type="button">Go</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'No teams yet' })).toBeInTheDocument();
    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
  });

  it('supports h3 headings for nested sections', () => {
    render(<EmptyState title="No results" headingLevel="h3" />);
    expect(screen.getByRole('heading', { level: 3, name: 'No results' })).toBeInTheDocument();
  });
});
