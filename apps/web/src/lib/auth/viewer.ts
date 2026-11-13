import type { MeDto } from '@/lib/api/types';
import { safeSteamAvatarUrl } from '@/lib/steam-hosts';
import { hasAnyAdminRole } from './roles';

/** Minimal, serialisable view of the signed-in user for client components (no tokens, no ids beyond slug). */
export interface Viewer {
  nickname: string;
  slug: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

export function toViewer(me: MeDto): Viewer {
  return {
    nickname: me.profile.nickname,
    slug: me.profile.slug,
    avatarUrl: safeSteamAvatarUrl(me.steamProfile?.avatarUrl),
    isAdmin: hasAnyAdminRole(me.roles),
  };
}
