import type { MeDtoM2, MeRole } from '@/lib/api/types';
import { isSuperAdmin } from '@/lib/auth/roles';

/**
 * UX-only role checks for M3 (docs/TOURNAMENTS.md §2). They decide which controls are shown;
 * the API re-checks authority inside every transaction.
 */

type Roles = readonly Pick<MeRole, 'role' | 'scopeType' | 'scopeId'>[];

/** Team ids the user operates: captain of their membership team, or TEAM_MANAGER grants. */
export function operatedTeamIds(me: Pick<MeDtoM2, 'membership' | 'roles'>): Set<string> {
  const ids = new Set<string>();
  if (me.membership && me.membership.role === 'CAPTAIN') ids.add(me.membership.teamId);
  for (const r of me.roles) {
    if (r.role === 'TEAM_MANAGER' && r.scopeType === 'TEAM' && r.scopeId) ids.add(r.scopeId);
  }
  return ids;
}

/**
 * Slugs of the teams the user operates (captain membership + TEAM_MANAGER grants carrying
 * `scopeSlug`), in a stable order: captain team first.
 */
export function operatedTeamSlugs(me: Pick<MeDtoM2, 'membership' | 'roles'>): string[] {
  const slugs: string[] = [];
  if (me.membership && me.membership.role === 'CAPTAIN') slugs.push(me.membership.teamSlug);
  for (const r of me.roles) {
    if (r.role === 'TEAM_MANAGER' && r.scopeType === 'TEAM' && r.scopeSlug) {
      if (!slugs.includes(r.scopeSlug)) slugs.push(r.scopeSlug);
    }
  }
  return slugs;
}

/** Create tournament: SUPER_ADMIN or GLOBAL TOURNAMENT_ADMIN. */
export function canCreateTournament(roles: Roles): boolean {
  return (
    isSuperAdmin(roles) ||
    roles.some((r) => r.role === 'TOURNAMENT_ADMIN' && r.scopeType === 'GLOBAL')
  );
}

/** Tournament admin of T: SUPER_ADMIN or TOURNAMENT_ADMIN (GLOBAL or scoped `TOURNAMENT:<T>`). */
export function isTournamentAdminOf(roles: Roles, tournamentId: string): boolean {
  return (
    isSuperAdmin(roles) ||
    roles.some(
      (r) =>
        r.role === 'TOURNAMENT_ADMIN' &&
        (r.scopeType === 'GLOBAL' || (r.scopeType === 'TOURNAMENT' && r.scopeId === tournamentId)),
    )
  );
}

/** Match admin of M: tournament admin of its tournament, or MATCH_ADMIN (GLOBAL or `MATCH:<M>`). */
export function isMatchAdminOf(
  roles: Roles,
  matchId: string,
  tournamentId: string | null,
): boolean {
  if (tournamentId && isTournamentAdminOf(roles, tournamentId)) return true;
  if (isSuperAdmin(roles)) return true;
  return roles.some(
    (r) =>
      r.role === 'MATCH_ADMIN' &&
      (r.scopeType === 'GLOBAL' || (r.scopeType === 'MATCH' && r.scopeId === matchId)),
  );
}

/** Any role that may manage some tournament or match (admin tournament/match pages). */
export function hasTournamentOrMatchRole(roles: Roles): boolean {
  return (
    isSuperAdmin(roles) ||
    roles.some((r) => r.role === 'TOURNAMENT_ADMIN' || r.role === 'MATCH_ADMIN')
  );
}
