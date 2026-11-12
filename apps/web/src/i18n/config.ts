export const locales = ['en', 'ru', 'kk'] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = 'en';
export const LOCALE_COOKIE = 'NEXT_LOCALE';
/** One year. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Native-language names; shown identically in every UI language. */
export const localeNames: Record<AppLocale, string> = {
  en: 'English',
  ru: 'Русский',
  kk: 'Қазақша',
};

export function isLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/**
 * Parse an Accept-Language header into language tags ordered by q-value.
 * Invalid entries are ignored.
 */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((entry) => entry.tag.length > 0 && entry.tag !== '*' && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((entry) => entry.tag);
}

/** Cookie `NEXT_LOCALE` wins, then Accept-Language, then the default locale. */
export function resolveLocale(
  cookieValue: string | null | undefined,
  acceptLanguage: string | null | undefined,
): AppLocale {
  if (isLocale(cookieValue)) return cookieValue;
  for (const tag of parseAcceptLanguage(acceptLanguage)) {
    const base = tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return defaultLocale;
}
