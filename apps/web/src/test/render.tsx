import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../messages/en.json';
import { DISPLAY_TIMEZONE } from '@/lib/display-time';

/** Render with the English message catalog and the platform display time zone (as in production). */
export function renderWithIntl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone={DISPLAY_TIMEZONE}>
      {ui}
    </NextIntlClientProvider>,
  );
}
