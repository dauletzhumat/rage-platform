import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import type { MatchStatus, TournamentStatus } from '@/lib/api/types';

export type StatusTone = 'live' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const toneClasses: Record<StatusTone, string> = {
  live: 'border-live/40 bg-live/10 text-live',
  success: 'border-success/40 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  danger: 'border-danger/40 bg-danger/10 text-danger',
  info: 'border-info/40 bg-info/10 text-info',
  neutral: 'border-border bg-raised text-muted',
};

const dotClasses: Record<StatusTone, string> = {
  live: 'bg-live',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  neutral: 'bg-muted',
};

export function matchStatusTone(status: MatchStatus): StatusTone {
  switch (status) {
    case 'LIVE':
    case 'KNIFE':
      return 'live';
    case 'PAUSED':
    case 'DISPUTED':
      return 'warning';
    case 'COMPLETED':
      return 'success';
    case 'FAILED':
      return 'danger';
    case 'CANCELLED':
      return 'neutral';
    case 'SERVER_ASSIGNED':
    case 'PREPARING':
    case 'WARMUP':
    case 'READY_CHECK':
    case 'MAP_FINISHED':
      return 'info';
    case 'CREATED':
    default:
      return 'neutral';
  }
}

export function tournamentStatusTone(status: TournamentStatus): StatusTone {
  switch (status) {
    case 'IN_PROGRESS':
      return 'live';
    case 'REGISTRATION_OPEN':
      return 'success';
    case 'REGISTRATION_CLOSED':
      return 'info';
    case 'COMPLETED':
      return 'neutral';
    case 'CANCELLED':
      return 'danger';
    case 'DRAFT':
    default:
      return 'neutral';
  }
}

interface StatusPillProps extends Omit<ComponentProps<'span'>, 'children'> {
  tone: StatusTone;
  label: string;
  /** Animated dot; only meaningful for real live state (respects reduced motion). */
  pulse?: boolean;
}

/** Status indicator: colour + dot + text label (never colour alone). */
export function StatusPill({ tone, label, pulse = false, className, ...props }: StatusPillProps) {
  return (
    <span
      data-slot="status-pill"
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 rounded-full',
          dotClasses[tone],
          pulse && 'motion-safe:animate-live-pulse',
        )}
      />
      {label}
    </span>
  );
}
