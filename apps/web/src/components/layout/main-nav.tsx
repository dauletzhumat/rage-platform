'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { isActivePath, publicNavItems } from './nav-items';

interface MainNavProps {
  className?: string;
  orientation?: 'horizontal' | 'vertical';
  onNavigate?: () => void;
}

export function MainNav({ className, orientation = 'horizontal', onNavigate }: MainNavProps) {
  const t = useTranslations('nav');
  const pathname = usePathname() ?? '/';
  const vertical = orientation === 'vertical';

  return (
    <nav aria-label={t('primary')} className={className}>
      <ul className={cn('flex', vertical ? 'flex-col gap-1' : 'items-center gap-1')}>
        {publicNavItems.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={onNavigate}
                className={cn(
                  'relative flex items-center rounded-md text-sm font-medium transition-colors hover:text-foreground',
                  vertical ? 'h-11 px-3 hover:bg-raised' : 'h-9 px-3',
                  active ? 'text-foreground' : 'text-muted',
                  active &&
                    (vertical
                      ? 'bg-raised before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent'
                      : 'after:absolute after:inset-x-3 after:-bottom-[13px] after:h-0.5 after:bg-accent'),
                )}
              >
                {t(item.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
