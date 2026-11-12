'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Re-runs the current route's Server Components (re-fetches API data). */
export function RetryButton({ onRetry }: { onRetry?: () => void }) {
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(() => {
          if (onRetry) onRetry();
          else router.refresh();
        })
      }
    >
      <RotateCw aria-hidden="true" className={pending ? 'motion-safe:animate-spin' : undefined} />
      {t('retry')}
    </Button>
  );
}
