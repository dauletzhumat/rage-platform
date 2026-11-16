import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/render';
import { FormattedDate } from '@/components/domain/formatting';
import { DemoModeBanner } from '@/components/states/demo-mode-banner';
import { RegistrationWindowNotice, registrationWindowState } from './tournament-parts';

const OPEN = '2026-11-20T05:00:00.000Z'; // 10:00 UTC+5
const CLOSE = '2026-11-25T18:59:00.000Z'; // 23:59 UTC+5
const base = {
  status: 'REGISTRATION_OPEN' as const,
  registrationOpen: false,
  registrationOpenAt: OPEN,
  registrationCloseAt: CLOSE,
};

describe('registrationWindowState', () => {
  it('derives the reason registration is not accepting entries', () => {
    expect(registrationWindowState({ ...base, registrationOpen: true }, Date.parse(OPEN) + 1)).toBe(
      'open',
    );
    expect(registrationWindowState(base, Date.parse(OPEN) - 1)).toBe('notYetOpen');
    expect(registrationWindowState(base, Date.parse(CLOSE) + 1)).toBe('closedWindow');
    expect(
      registrationWindowState({ ...base, registrationOpenAt: null, registrationCloseAt: null }, 0),
    ).toBe('unavailable');
    expect(registrationWindowState({ ...base, status: 'DRAFT' }, 0)).toBe('notOpenStatus');
  });
});

describe('RegistrationWindowNotice (UTC+5)', () => {
  it('shows when registration opens, in UTC+5 with the label', () => {
    renderWithIntl(
      <RegistrationWindowNotice
        state="notYetOpen"
        registrationOpenAt={OPEN}
        registrationCloseAt={CLOSE}
      />,
    );
    const note = screen.getByTestId('registration-window');
    expect(note).toHaveTextContent(/Registration opens at Nov 20, 2026, 10:00\sAM \(UTC\+5\)/);
  });

  it('shows when registration closed (day boundary in UTC+5)', () => {
    renderWithIntl(
      <RegistrationWindowNotice
        state="closedWindow"
        registrationOpenAt={OPEN}
        registrationCloseAt={CLOSE}
      />,
    );
    expect(screen.getByTestId('registration-window')).toHaveTextContent(
      /Registration closed at Nov 25, 2026, 11:59\sPM \(UTC\+5\)/,
    );
  });

  it('renders nothing while open', () => {
    const { container } = renderWithIntl(
      <RegistrationWindowNotice
        state="open"
        registrationOpenAt={OPEN}
        registrationCloseAt={CLOSE}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('FormattedDate in the display time zone', () => {
  it('shifts to UTC+5 (crossing midnight) and labels the time', () => {
    renderWithIntl(<FormattedDate value="2026-11-30T20:30:00.000Z" withTime />);
    const time = screen.getByText(/Dec 1, 2026/);
    expect(time.closest('time')).toHaveAttribute('datetime', '2026-11-30T20:30:00.000Z');
    expect(time.closest('time')).toHaveTextContent(/1:30\sAM\s*UTC\+5/);
  });
});

describe('DemoModeBanner', () => {
  it('states clearly that actions affect sample data in development only', () => {
    renderWithIntl(<DemoModeBanner />);
    expect(screen.getByTestId('demo-mode-banner')).toHaveTextContent(
      'Demo mode — actions on sample data (development only).',
    );
  });
});
