import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { listHref, MAX_QUERY_LENGTH, totalPages as computeTotalPages } from '@/lib/list-params';

/** GET search form — works without JavaScript, keeps the URL shareable. */
export function SearchForm({
  action,
  label,
  q,
  hidden = {},
}: {
  action: string;
  label: string;
  q: string | undefined;
  hidden?: Record<string, string | undefined>;
}) {
  const tc = useTranslations('common');
  return (
    <form
      role="search"
      action={action}
      method="get"
      className="flex w-full max-w-md items-center gap-2"
    >
      {Object.entries(hidden).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
      <label className="relative flex-1">
        <span className="sr-only">{label}</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted"
        />
        <input
          type="search"
          name="q"
          defaultValue={q}
          maxLength={MAX_QUERY_LENGTH}
          placeholder={tc('searchPlaceholder')}
          className="h-9 w-full rounded-md border border-border bg-surface pl-8 pr-3 text-sm text-foreground placeholder:text-muted focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent"
        />
      </label>
      <Button type="submit" variant="secondary">
        {tc('search')}
      </Button>
      {q ? (
        <Link
          href={listHref(action, { ...hidden })}
          className={buttonVariants({ variant: 'ghost', size: 'md' })}
        >
          {tc('clearSearch')}
        </Link>
      ) : null}
    </form>
  );
}

export function ListPagination({
  pathname,
  page,
  pageSize,
  total,
  params = {},
}: {
  pathname: string;
  page: number;
  pageSize: number;
  total: number;
  params?: Record<string, string | undefined>;
}) {
  const tc = useTranslations('common');
  const totalPages = computeTotalPages(total, pageSize);
  return (
    <Pagination
      className="mt-4"
      page={page}
      totalPages={totalPages}
      previousHref={page > 1 ? listHref(pathname, { ...params, page: page - 1 }) : null}
      nextHref={page < totalPages ? listHref(pathname, { ...params, page: page + 1 }) : null}
      labels={{
        nav: tc('pagination'),
        previous: tc('previous'),
        next: tc('next'),
        status: tc('pageOf', { page, totalPages }),
      }}
    />
  );
}
