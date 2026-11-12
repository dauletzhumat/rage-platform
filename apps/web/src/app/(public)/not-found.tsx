import { NotFoundContent } from '@/components/states/not-found-content';

/** `notFound()` from public pages (e.g. unknown team slug) — shell comes from the layout. */
export default function PublicNotFound() {
  return <NotFoundContent />;
}
