import { getMe } from '@/lib/api/server';
import { toViewer } from '@/lib/auth/viewer';
import { AccountMenu } from './account-menu';
import { MobileAccount } from './mobile-account';
import { SignInLink } from './sign-in-link';

/**
 * Session-aware account slot of the public header. Uses the per-request cached `getMe()`
 * (no API call at all without a session cookie). Any failure falls back to the sign-in link.
 */
export async function HeaderAccount({ variant }: { variant: 'desktop' | 'mobile' }) {
  const me = await getMe();
  if (!me.ok) {
    return <SignInLink className={variant === 'mobile' ? 'w-full' : undefined} />;
  }
  const viewer = toViewer(me.data);
  return variant === 'mobile' ? <MobileAccount viewer={viewer} /> : <AccountMenu viewer={viewer} />;
}

/** Placeholder with the sign-in button footprint while the session is being resolved. */
export function HeaderAccountSkeleton() {
  return <span aria-hidden="true" className="inline-block h-8 w-36 rounded-md bg-raised" />;
}
