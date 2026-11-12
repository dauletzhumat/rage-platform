import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../messages/en.json';

/** Render with the English message catalog (UTC, matching production config). */
export function renderWithIntl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );
}
