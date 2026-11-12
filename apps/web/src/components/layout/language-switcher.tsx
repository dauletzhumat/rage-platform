'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isLocale, localeNames, locales } from '@/i18n/config';
import { setLocaleAction } from '@/i18n/actions';

export function LanguageSwitcher({ className }: { className?: string }) {
  const t = useTranslations('locale');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(next: string) {
    if (!isLocale(next) || next === locale) return;
    startTransition(async () => {
      const result = await setLocaleAction(next);
      if (result.ok) router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={className}
          aria-label={t('switch', { name: localeNames[locale] })}
          aria-busy={pending || undefined}
        >
          <Globe aria-hidden="true" />
          <span className="font-mono text-xs uppercase">{locale}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={locale} onValueChange={onChange}>
          {locales.map((code) => (
            <DropdownMenuRadioItem key={code} value={code} lang={code}>
              {localeNames[code]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
