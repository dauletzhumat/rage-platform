import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DISPLAY_TIMEZONE } from '@/lib/display-time';
import { LOCALE_COOKIE, resolveLocale } from './config';

export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerStore.get('accept-language'),
  );

  return {
    locale,
    // All timestamps are rendered in the platform display zone (UTC+5 by default, labelled).
    // It is a build-time NEXT_PUBLIC_ value, so server and client output always agree.
    timeZone: DISPLAY_TIMEZONE,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
