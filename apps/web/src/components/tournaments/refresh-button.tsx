'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Re-reads the route's Server Components. Data is not pushed live in M3. */
export function RefreshButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RotateCw aria-hidden="true" className={pending ? 'motion-safe:animate-spin' : undefined} />
      {label}
    </Button>
  );
}
