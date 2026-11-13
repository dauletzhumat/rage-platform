import { ApiErrorState } from '@/components/states/api-error-state';
import { AuthRequired } from '@/components/states/auth-required';
import { ComingSoon } from '@/components/states/coming-soon';
import { Container } from '@/components/ui/container';
import { getMe } from '@/lib/api/server';

/**
 * Protected route whose feature ships in a later milestone:
 * signed out → sign-in required (with returnTo); API trouble → error state;
 * signed in → honest "coming in Mx" state. No data and no forms either way.
 */
export async function ProtectedPlaceholder({
  pageTitle,
  returnTo,
  description,
}: {
  pageTitle: string;
  returnTo: string;
  description: string;
}) {
  const me = await getMe();
  if (!me.ok) {
    if (me.kind === 'unauthenticated')
      return <AuthRequired pageTitle={pageTitle} returnTo={returnTo} />;
    return (
      <Container className="space-y-6 py-10">
        <h1 className="text-2xl font-bold tracking-tight">{pageTitle}</h1>
        <ApiErrorState failure={me} />
      </Container>
    );
  }
  return <ComingSoon pageTitle={pageTitle} description={description} />;
}
