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
] as const;

export type AdminNavKey = (typeof adminNavItems)[number]['key'];

/** `/` and section roots match exactly; other items also match their sub-paths. */
export function isActivePath(
  pathname: string,
  href: string,
  exactRoots: string[] = ['/', '/admin'],
): boolean {
  if (exactRoots.includes(href)) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
