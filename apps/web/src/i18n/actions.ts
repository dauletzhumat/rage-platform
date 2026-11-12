'use server';

import { cookies } from 'next/headers';
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from './config';

/** Persist the preferred UI language. Invalid values are rejected. */
export async function setLocaleAction(locale: string): Promise<{ ok: boolean }> {
  if (!isLocale(locale)) return { ok: false };
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: false,
  });
  return { ok: true };
}
