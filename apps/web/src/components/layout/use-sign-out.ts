'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { logout } from '@/lib/api/browser';

/**
 * Sign out via `POST /auth/logout` (credentials + CSRF header). A 401 means the session is
 * already gone, which is treated as success (logout is idempotent). Other failures are reported —
 * the UI never pretends the user was signed out.
 */
export function useSignOut() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function signOut() {
    setFailed(false);
    startTransition(async () => {
      const result = await logout();
      if (result.ok || result.kind === 'unauthenticated') {
        router.push('/');
        router.refresh();
      } else {
        setFailed(true);
      }
    });
  }

  return { signOut, pending, failed };
}
