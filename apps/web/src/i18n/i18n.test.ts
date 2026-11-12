import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import kk from '../../messages/kk.json';
import ru from '../../messages/ru.json';
import { parseAcceptLanguage, resolveLocale } from './config';

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function leaves(value: unknown, prefix = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[prefix, value]];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('message catalogs', () => {
  const enKeys = keyPaths(en).sort();

  it.each([
    ['ru', ru],
    ['kk', kk],
  ])('%s has exactly the same keys as en', (_locale, messages) => {
    expect(keyPaths(messages).sort()).toEqual(enKeys);
  });

  it.each([
    ['ru', ru],
    ['kk', kk],
  ])('%s translates navigation (no English fallbacks)', (_locale, messages) => {
    for (const [key, value] of Object.entries(messages.nav)) {
      expect(value, `nav.${key}`).not.toBe((en.nav as Record<string, string>)[key]);
    }
  });

  it('has no empty strings', () => {
    for (const messages of [en, ru, kk]) {
      for (const [path, value] of leaves(messages)) expect(value.trim(), path).not.toBe('');
    }
  });
});

describe('locale resolution', () => {
  it('prefers a valid NEXT_LOCALE cookie', () => {
    expect(resolveLocale('kk', 'ru-RU,ru;q=0.9')).toBe('kk');
  });

  it('ignores an invalid cookie and falls back to Accept-Language by q-value', () => {
    expect(resolveLocale('de', 'de-DE;q=1, ru;q=0.8, en;q=0.5')).toBe('ru');
  });

  it('defaults to en', () => {
    expect(resolveLocale(undefined, undefined)).toBe('en');
    expect(resolveLocale(undefined, 'fr-FR,de;q=0.9')).toBe('en');
  });

  it('parses Accept-Language ordering and drops q=0', () => {
    expect(parseAcceptLanguage('en;q=0.2, kk-KZ, ru;q=0')).toEqual(['kk-kz', 'en']);
  });
});
