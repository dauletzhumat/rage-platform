export const publicNavItems = [
  { href: '/', key: 'home' },
  { href: '/tournaments', key: 'tournaments' },
  { href: '/matches', key: 'matches' },
  { href: '/teams', key: 'teams' },
  { href: '/players', key: 'players' },
  { href: '/leaderboards', key: 'leaderboards' },
] as const;

export type PublicNavKey = (typeof publicNavItems)[number]['key'];

export const adminNavItems = [
  { href: '/admin', key: 'dashboard' },
  { href: '/admin/team-applications', key: 'teamApplications' },
  { href: '/admin/tournaments', key: 'tournaments' },
  { href: '/admin/matches', key: 'matches' },
  { href: '/admin/servers', key: 'servers' },
  { href: '/admin/users', key: 'users' },
  { href: '/admin/audit', key: 'auditLog' },
  { href: '/admin/bans', key: 'bans', superAdminOnly: true },
] as const;

export type AdminNavKey = (typeof adminNavItems)[number]['key'];

/** Admin links visible to this viewer (UX only — pages and the API re-check the role). */
export function visibleAdminNavItems(superAdmin: boolean) {
  return adminNavItems.filter((item) => superAdmin || !('superAdminOnly' in item));
}

/** `/` and section roots match exactly; other items also match their sub-paths. */
export function isActivePath(
  pathname: string,
  href: string,
  exactRoots: string[] = ['/', '/admin'],
): boolean {
  if (exactRoots.includes(href)) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
