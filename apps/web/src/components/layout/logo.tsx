import { cn } from '@/lib/utils';

/** Original RAGE wordmark: geometric mark + bold type. Pure SVG/CSS, no third-party assets. */
export function Logo({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 shrink-0">
        <rect x="1" y="1" width="22" height="22" rx="4" fill="var(--color-accent)" />
        <path d="M7 18V6h6.2a3.6 3.6 0 0 1 .9 7.1L17.5 18h-3.3l-3.1-4.6H9.9V18z" fill="#fff" />
        <path d="M9.9 8.4v2.7h3a1.35 1.35 0 0 0 0-2.7z" fill="var(--color-accent)" />
      </svg>
      {showText ? (
        <span className="text-lg font-black tracking-[0.2em] text-foreground">RAGE</span>
      ) : (
        <span className="sr-only">RAGE</span>
      )}
    </span>
  );
}
