import { getFormatter, getTranslations } from 'next-intl/server';
import { Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { RetryButton } from '@/components/states/retry-button';
import { getMeta, getReadiness } from '@/lib/api/server';
import type { DependencyStatus, FeatureStatus } from '@/lib/api/types';

type Overall = 'operational' | 'degraded' | 'unreachable';

/** Real readings of GET /meta and GET /health/ready at request time — no polling, no fake live data. */
export async function ApiStatusCard() {
  const [meta, ready, t, format] = await Promise.all([
    getMeta(),
    getReadiness(),
    getTranslations('home'),
    getFormatter(),
  ]);

  const overall: Overall =
    !meta.ok && !ready.ok
      ? 'unreachable'
      : meta.ok && ready.ok && ready.data.status === 'ok'
        ? 'operational'
        : 'degraded';

  const overallTone: Record<Overall, StatusTone> = {
    operational: 'success',
    degraded: 'warning',
    unreachable: 'danger',
  };
  const overallLabel: Record<Overall, string> = {
    operational: t('statusOperational'),
    degraded: t('statusDegraded'),
    unreachable: t('statusUnreachable'),
  };

  const dep = (status: DependencyStatus | undefined) =>
    status === undefined ? (
      <span className="text-muted">—</span>
    ) : (
      <StatusPill
        tone={status === 'up' ? 'success' : 'danger'}
        label={status === 'up' ? t('up') : t('down')}
      />
    );

  const feature = (status: FeatureStatus | undefined) => {
    if (status === undefined) return <span className="text-muted">—</span>;
    const map: Record<FeatureStatus, { tone: StatusTone; label: string }> = {
      not_implemented: { tone: 'neutral', label: t('featureNotImplemented') },
      configured: { tone: 'success', label: t('featureConfigured') },
      unconfigured: { tone: 'warning', label: t('featureUnconfigured') },
    };
    return <StatusPill tone={map[status].tone} label={map[status].label} />;
  };

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: t('apiVersion'),
      value: meta.ok ? (
        <span className="font-mono text-xs">
          {meta.data.apiVersion} · {meta.data.version}
        </span>
      ) : (
        <span className="text-muted">—</span>
      ),
    },
    {
      label: t('environment'),
      value: meta.ok ? (
        <span className="font-mono text-xs">{meta.data.environment}</span>
      ) : (
        <span className="text-muted">—</span>
      ),
    },
    {
      label: t('database'),
      value: dep(ready.ok ? ready.data.checks?.database?.status : undefined),
    },
    { label: t('redis'), value: dep(ready.ok ? ready.data.checks?.redis?.status : undefined) },
    {
      label: t('steamAuth'),
      value: feature(meta.ok ? meta.data.features?.steamAuth?.status : undefined),
    },
    {
      label: t('cs2Integration'),
      value: feature(meta.ok ? meta.data.features?.cs2Integration?.status : undefined),
    },
  ];

  return (
    <Card data-testid="api-status">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity aria-hidden="true" className="size-4 text-accent" />
          {t('statusTitle')}
        </CardTitle>
        <StatusPill tone={overallTone[overall]} label={overallLabel[overall]} />
      </CardHeader>
      <CardContent className="space-y-3">
        {overall === 'unreachable' ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted">{t('statusUnreachableDescription')}</p>
            <RetryButton />
          </div>
        ) : null}
        <dl className="divide-y divide-border text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 py-2">
              <dt className="text-muted">{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted">
          {t('checkedAt', { time: format.dateTime(new Date(), { timeStyle: 'medium' }) })}
        </p>
      </CardContent>
    </Card>
  );
}

export function ApiStatusCardSkeleton() {
  return (
    <Card aria-hidden="true">
      <CardHeader>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-5 w-24 rounded-full" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
