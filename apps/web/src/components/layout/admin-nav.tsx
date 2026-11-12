'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  FileCheck2,
  LayoutDashboard,
  ScrollText,
  Server,
  Swords,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { adminNavItems, isActivePath, type AdminNavKey } from './nav-items';

const icons: Record<AdminNavKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  teamApplications: FileCheck2,
  tournaments: Trophy,
  matches: Swords,
  servers: Server,
  users: Users,
  auditLog: ScrollText,
};

/** Vertical sidebar on large screens, horizontally scrollable strip on small ones. */
export function AdminNav() {
  const t = useTranslations('admin');
  const pathname = usePathname() ?? '/admin';
  return (
    <nav aria-label={t('navLabel')}>
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {adminNavItems.map((item) => {
          const Icon = icons[item.key];
          const active = isActivePath(pathname, item.href);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-9 items-center gap-2 whitespace-nowrap rounded-md px-3 text-sm transition-colors',
                  active
                    ? 'bg-raised font-medium text-foreground shadow-[inset_2px_0_0_var(--color-accent)]'
                    : 'text-muted hover:bg-raised hover:text-foreground',
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
                {t(item.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
