import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { TooltipProvider } from '@/components/ui/tooltip';
import './globals.css';

function siteUrl(): URL {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000');
  } catch {
    return new URL('http://localhost:3000');
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return {
    metadataBase: siteUrl(),
    title: { template: '%s · RAGE', default: `RAGE — ${t('tagline')}` },
    description: t('tagline'),
    applicationName: 'RAGE',
    robots: { index: true, follow: true },
    openGraph: { siteName: 'RAGE', type: 'website' },
  };
}

export const viewport: Viewport = {
  themeColor: '#111317',
  colorScheme: 'dark',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <NextIntlClientProvider>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
