export const DEFAULT_PAGE_SIZE = 20;
/** Must match the API's SearchPaginationQueryDto (@MaxLength(64)). */
export const MAX_QUERY_LENGTH = 64;

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export interface ParsedListParams {
  page: number;
  pageSize: number;
  q: string | undefined;
}

/** Sanitise `?page=&q=` from the URL. */
export function parseListParams(searchParams: RawSearchParams): ParsedListParams {
  const rawPage = Number.parseInt(first(searchParams.page) ?? '1', 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 && rawPage <= 10_000 ? rawPage : 1;
  const q = first(searchParams.q)?.trim().slice(0, MAX_QUERY_LENGTH) || undefined;
  return { page, pageSize: DEFAULT_PAGE_SIZE, q };
}

export function pickParam<T extends string>(
  searchParams: RawSearchParams,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = first(searchParams[key]);
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function totalPages(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/** Build a list URL preserving filters; omits defaults. */
export function listHref(
  pathname: string,
  params: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '' || (key === 'page' && value === 1)) continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
