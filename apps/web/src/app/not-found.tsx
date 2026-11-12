import type { Metadata } from 'next';
import { PublicShell } from '@/components/layout/public-shell';
import { NotFoundContent } from '@/components/states/not-found-content';

export const metadata: Metadata = {
  title: '404',
  robots: { index: false },
};

/** Unmatched URLs: render inside the public chrome. */
export default function NotFound() {
  return (
    <PublicShell>
      <NotFoundContent />
    </PublicShell>
  );
}
