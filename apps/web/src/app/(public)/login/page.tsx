import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Clock, LogIn } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Container } from '@/components/ui/container';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  return { title: t('loginTitle'), robots: { index: false } };
}

/** M0: explains that Steam sign-in does not exist yet. The button is disabled — nothing is faked. */
export default async function LoginPage() {
  const [t, tn, tc] = await Promise.all([
    getTranslations('auth'),
    getTranslations('nav'),
    getTranslations('common'),
  ]);
  return (
    <Container className="flex justify-center py-12">
      <Card className="w-full max-w-lg">
        <CardContent className="space-y-6 p-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">{t('loginTitle')}</h1>
            <p className="text-sm text-muted">{t('loginDescription')}</p>
          </div>
          <div
            role="status"
            className="flex gap-3 rounded-md border border-warning/40 bg-warning/10 p-4"
          >
            <Clock aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-warning">{t('loginUnavailableTitle')}</h2>
              <p className="text-sm text-muted">{t('loginUnavailable')}</p>
            </div>
          </div>
          <Button size="lg" className="w-full" disabled aria-describedby="login-unavailable-note">
            <LogIn aria-hidden="true" />
            {tn('signInWithSteam')}
          </Button>
          <p id="login-unavailable-note" className="text-center text-xs text-muted">
            {tn('signInUnavailable')}
          </p>
          <p className="text-sm text-muted">{t('browsePublic')}</p>
          <Link href="/" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {tc('backHome')}
          </Link>
        </CardContent>
      </Card>
    </Container>
  );
}
