import { safeSteamAvatarUrl } from '@/lib/steam-hosts';
import { cn, initials } from '@/lib/utils';

/**
 * Steam avatar (only from the allowlisted Steam CDN hosts, also enforced by CSP img-src)
 * or initials. Decorative: the name is always rendered next to it.
 */
export function UserAvatar({
  name,
  avatarUrl,
  size = 'sm',
  className,
}: {
  name: string;
  avatarUrl: string | null | undefined;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const src = safeSteamAvatarUrl(avatarUrl);
  const box = size === 'lg' ? 'size-16 text-lg' : 'size-7 text-[11px]';
  if (src) {
    return (
      // Plain <img>: tiny, already-optimised CDN avatars; avoids routing them through the image optimiser.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        aria-hidden="true"
        referrerPolicy="no-referrer"
        className={cn('shrink-0 rounded-md border border-border object-cover', box, className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-md border border-border bg-raised font-semibold text-muted',
        box,
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
