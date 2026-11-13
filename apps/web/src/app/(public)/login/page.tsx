import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { CircleAlert, CloudOff, KeyRound, LogIn, Settings2 } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import { steamSignInUrl } from '@/lib/api/public-url';
import { getMe, getMeta } from '@/lib/api/server';
import { loginErrorKey } from '@/lib/auth/login-errors';
import { safeReturnTo } from '@/lib/auth/return-to';
import type { RawSearchParams } from '@/lib/list-params';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('loginTitle'), robots: { index: false } };
}

/**
 * Steam sign-in. The button is a plain link (works without JavaScript) to the API's
 * `/auth/steam`, which redirects to steamcommunity.com. RAGE never handles Steam passwords.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = await searchParams;
  const returnTo = safeReturnTo(raw.returnTo);
  const errorKey = loginErrorKey(raw.error);

  const [me, meta, t, tn, tc] = await Promise.all([
    getMe(),
    getMeta(),
    getTranslations('auth'),
    getTranslations('nav'),
    getTranslations('common'),
  ]);

  if (me.ok) redirect(returnTo !== '/' ? returnTo : '/me');

  const steamStatus = meta.ok ? meta.data.features.steamAuth.status : null;
  const unconfigured = steamStatus === 'unconfigured';

  return (
    <Container className="flex justify-center py-12">
      <Card className="w-full max-w-lg">
        <CardContent className="space-y-6 p-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">{t('loginTitle')}</h1>
            <p className="text-sm text-muted">{t('loginDescription')}</p>
          </div>

          {errorKey ? (
            <div
              role="alert"
              data-testid="login-error"
              className="flex gap-3 rounded-md border border-danger/40 bg-danger/10 p-4"
            >
              <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-danger" />
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-danger">{t('errorTitle')}</h2>
                <p className="text-sm text-muted">{t(`errors.${errorKey}`)}</p>
              </div>
            </div>
          ) : null}

          {unconfigured ? (
            <>
              <div
                role="status"
                className="flex gap-3 rounded-md border border-warning/40 bg-warning/10 p-4"
              >
                <Settings2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold text-warning">{t('unconfiguredTitle')}</h2>
                  <p id="login-unconfigured-note" className="text-sm text-muted">
                    {t('unconfiguredDescription')}
                  </p>
                </div>
              </div>
              <Button
                size="lg"
                className="w-full"
                disabled
                aria-describedby="login-unconfigured-note"
              >
                <LogIn aria-hidden="true" />
                {tn('signInWithSteam')}
              </Button>
            </>
          ) : (
            <>
              {steamStatus === null ? (
                <div
                  role="status"
                  className="flex gap-3 rounded-md border border-border bg-raised p-4"
                >
                  <CloudOff aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted" />
                  <div className="space-y-1">
                    <h2 className="text-sm font-semibold">{t('metaUnknownTitle')}</h2>
                    <p className="text-sm text-muted">{t('metaUnknownDescription')}</p>
                  </div>
                </div>
              ) : null}
              {/* Plain link: a top-level navigation to the API, which redirects to Steam. */}
              <a
                href={steamSignInUrl(returnTo)}
                data-testid="steam-sign-in"
                className={buttonVariants({ size: 'lg', className: 'w-full' })}
              >
                <LogIn aria-hidden="true" />
                {tn('signInWithSteam')}
              </a>
              {returnTo !== '/' ? (
                <p className="text-center text-xs text-muted">
                  {t('returnToNote', { path: returnTo })}
                </p>
              ) : null}
            </>
          )}

          <div className="flex gap-3 rounded-md border border-border bg-surface p-4">
            <KeyRound aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent-text" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">{t('passwordTitle')}</h2>
              <p className="text-sm text-muted">{t('passwordNote')}</p>
            </div>
          </div>

          <p className="text-sm text-muted">{t('browsePublic')}</p>
          <Link href="/" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {tc('backHome')}
          </Link>
        </CardContent>
      </Card>
    </Container>
  );
}
