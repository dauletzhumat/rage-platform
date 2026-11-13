import { useTranslations } from 'next-intl';
import { Construction } from 'lucide-react';
import { Container } from '@/components/ui/container';
import { EmptyState } from '@/components/ui/empty-state';

/** Honest "signed in, but this feature arrives in a later milestone" state. No fake data. */
export function ComingSoon({
  pageTitle,
  description,
  title,
  bare = false,
}: {
  pageTitle: string;
  description: string;
  title?: string;
  /** Render with admin-area padding instead of the public page container. */
  bare?: boolean;
}) {
  const t = useTranslations('protected');
  const content = (
    <div data-testid="coming-soon">
      <h1 className="text-2xl font-bold tracking-tight">{pageTitle}</h1>
      <EmptyState
        className="mt-6"
        icon={Construction}
        title={title ?? t('comingTitle')}
        description={description}
      />
    </div>
  );
  return bare ? (
    <div className="px-4 py-8 sm:px-6">{content}</div>
  ) : (
    <Container className="py-10">{content}</Container>
  );
}
