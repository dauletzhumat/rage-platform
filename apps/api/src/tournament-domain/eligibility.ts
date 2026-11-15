import { Prisma, type RosterEntryRole } from '@rage/db';
import type { ApiErrorDetailDto } from '../common/errors/api-error.js';
import { defaultNickname } from '../auth/profile-rules.js';

type Tx = Prisma.TransactionClient;

/** `PLAYER_INELIGIBLE` reasons (docs/TOURNAMENTS.md §4), in reporting priority order. */
export const INELIGIBLE_REASONS = [
  'NOT_TEAM_MEMBER',
  'USER_INACTIVE',
  'SAMPLE',
  'BANNED',
  'ALREADY_REGISTERED_ELSEWHERE',
] as const;
export type IneligibleReason = (typeof INELIGIBLE_REASONS)[number];

export interface PlayerSnapshot {
  userId: string;
  steamId64: string;
  nickname: string;
}

export interface EligibilityInput {
  tournamentId: string;
  teamId: string;
  userIds: readonly string[];
  /** Approval re-validation skips this: the snapshot is what counts (§4). */
  checkMembership: boolean;
  /** `SamplePolicy.samplePlayersAllowed(tournament)` — demo mode inside sample tournaments. */
  allowSamplePlayers: boolean;
}

export interface EligibilityResult {
  snapshots: Map<string, PlayerSnapshot>;
  /** One `{ field: userId, message: REASON }` per ineligible player. */
  problems: ApiErrorDetailDto[];
}

/**
 * Eligibility of players for a tournament roster (§4), from verified identities only:
 * current active member of the team (optional), user ACTIVE, non-sample, SteamID64 without an
 * active ban, and not on another team's PENDING/APPROVED current (DRAFT/LOCKED) roster in the
 * same tournament.
 *
 * Must run inside the mutation transaction after the tournament (FOR UPDATE) and team locks:
 * every roster write in a tournament holds the tournament lock, so the "elsewhere" check cannot
 * race another registration; membership changes hold the team lock. User rows are read
 * `FOR SHARE` so a concurrent suspension serializes with the snapshot.
 */
export async function evaluateEligibility(
  tx: Tx,
  input: EligibilityInput,
): Promise<EligibilityResult> {
  const ids = [...new Set(input.userIds)].sort();
  const snapshots = new Map<string, PlayerSnapshot>();
  const reasons = new Map<string, IneligibleReason[]>();
  const add = (userId: string, reason: IneligibleReason) => {
    const list = reasons.get(userId) ?? [];
    list.push(reason);
    reasons.set(userId, list);
  };
  if (ids.length === 0) return { snapshots, problems: [] };

  const idList = Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
  const users = await tx.$queryRaw<
    {
      id: string;
      steam_id64: string;
      status: string;
      is_sample: boolean;
      nickname: string | null;
    }[]
  >`
    SELECT u.id, u.steam_id64, u.status, u.is_sample, p.nickname
    FROM users u LEFT JOIN player_profiles p ON p.user_id = u.id
    WHERE u.id IN (${idList})
    ORDER BY u.id
    FOR SHARE OF u`;
  const byId = new Map(users.map((u) => [u.id, u]));

  let memberIds = new Set<string>();
  if (input.checkMembership) {
    const members = await tx.$queryRaw<{ user_id: string }[]>`
      SELECT user_id FROM team_memberships
      WHERE team_id = ${input.teamId}::uuid AND left_at IS NULL
        AND role IN ('CAPTAIN', 'PLAYER', 'SUBSTITUTE') AND user_id IN (${idList})`;
    memberIds = new Set(members.map((m) => m.user_id));
  }

  const steamIds = users.map((u) => u.steam_id64);
  const banned = new Set<string>();
  if (steamIds.length > 0) {
    const rows = await tx.$queryRaw<{ steam_id64: string }[]>`
      SELECT steam_id64 FROM banned_steam_ids
      WHERE lifted_at IS NULL AND steam_id64 IN (${Prisma.join(steamIds)})`;
    for (const r of rows) banned.add(r.steam_id64);
  }

  const elsewhere = await tx.$queryRaw<{ user_id: string }[]>`
    SELECT DISTINCT e.user_id
    FROM tournament_roster_entries e
    JOIN tournament_rosters r ON r.id = e.roster_id AND r.status IN ('DRAFT', 'LOCKED')
    JOIN tournament_registrations g ON g.id = r.tournament_registration_id
    WHERE g.tournament_id = ${input.tournamentId}::uuid
      AND g.status IN ('PENDING', 'APPROVED')
      AND g.team_id <> ${input.teamId}::uuid
      AND e.user_id IN (${idList})`;
  const elsewhereIds = new Set(elsewhere.map((r) => r.user_id));

  for (const id of ids) {
    const u = byId.get(id);
    if (!u) {
      // Unknown user id: it cannot be a member of anything.
      add(id, 'NOT_TEAM_MEMBER');
      continue;
    }
    if (input.checkMembership && !memberIds.has(id)) add(id, 'NOT_TEAM_MEMBER');
    if (u.status !== 'ACTIVE') add(id, 'USER_INACTIVE');
    if (u.is_sample && !input.allowSamplePlayers) add(id, 'SAMPLE');
    if (banned.has(u.steam_id64)) add(id, 'BANNED');
    if (elsewhereIds.has(id)) add(id, 'ALREADY_REGISTERED_ELSEWHERE');
    snapshots.set(id, {
      userId: id,
      steamId64: u.steam_id64,
      nickname: u.nickname?.trim() ? u.nickname : defaultNickname(u.steam_id64),
    });
  }

  // Report players in request order; one detail per player (first reason by priority).
  const problems: ApiErrorDetailDto[] = [];
  for (const id of input.userIds) {
    const list = reasons.get(id);
    if (!list || problems.some((p) => p.field === id)) continue;
    const first = INELIGIBLE_REASONS.find((r) => list.includes(r))!;
    problems.push({ field: id, message: first });
  }
  return { snapshots, problems };
}

export interface RosterEntryInput {
  userId: string;
  steamId64: string;
  nickname: string;
  role: RosterEntryRole;
}

export function entriesFromSelection(
  starters: readonly string[],
  substitutes: readonly string[],
  snapshots: Map<string, PlayerSnapshot>,
): RosterEntryInput[] {
  const pick = (id: string, role: RosterEntryRole): RosterEntryInput => {
    const s = snapshots.get(id);
    if (!s) throw new Error(`missing snapshot for ${id}`);
    return { userId: id, steamId64: s.steamId64, nickname: s.nickname, role };
  };
  return [
    ...starters.map((id) => pick(id, 'STARTER')),
    ...substitutes.map((id) => pick(id, 'SUBSTITUTE')),
  ];
}
