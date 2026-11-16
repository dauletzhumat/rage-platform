import { type Prisma } from '@rage/db';
import { iso } from '../common/http/dto.js';
import type { RegistrationDto, TournamentRosterDto } from '../registrations/registrations.dto.js';

/** Shared select / mapping for RegistrationDto (operator and admin views). */
export const registrationSelect = {
  id: true,
  status: true,
  seed: true,
  reviewReason: true,
  reviewedAt: true,
  createdAt: true,
  tournament: { select: { id: true, slug: true, name: true, isSample: true } },
  team: { select: { id: true, slug: true, name: true, tag: true, isSample: true } },
  rosters: {
    // Latest version = current roster (DRAFT/LOCKED; may be the last one of a closed registration).
    orderBy: { version: 'desc' },
    take: 1,
    select: {
      id: true,
      version: true,
      status: true,
      lockedAt: true,
      entries: {
        orderBy: [{ role: 'asc' }, { nicknameSnapshot: 'asc' }, { id: 'asc' }],
        select: {
          userId: true,
          steamId64Snapshot: true,
          nicknameSnapshot: true,
          role: true,
          user: { select: { playerProfile: { select: { slug: true } } } },
        },
      },
    },
  },
} satisfies Prisma.TournamentRegistrationSelect;

export type RegistrationRow = Prisma.TournamentRegistrationGetPayload<{
  select: typeof registrationSelect;
}>;

type RosterRow = RegistrationRow['rosters'][number];

export function toRosterDto(roster: RosterRow | undefined): TournamentRosterDto {
  if (!roster) throw new Error('registration without roster');
  return {
    id: roster.id,
    version: roster.version,
    status: roster.status,
    lockedAt: iso(roster.lockedAt),
    entries: roster.entries.map((e) => ({
      userId: e.userId,
      playerSlug: e.user.playerProfile?.slug ?? '',
      steamId64: e.steamId64Snapshot,
      nickname: e.nicknameSnapshot,
      role: e.role,
    })),
  };
}

export function toRegistrationDto(row: RegistrationRow): RegistrationDto {
  return {
    id: row.id,
    tournament: { id: row.tournament.id, slug: row.tournament.slug, name: row.tournament.name },
    team: { id: row.team.id, slug: row.team.slug, name: row.team.name, tag: row.team.tag },
    status: row.status,
    seed: row.seed,
    reviewReason: row.reviewReason,
    createdAt: row.createdAt.toISOString(),
    roster: toRosterDto(row.rosters[0]),
  };
}
