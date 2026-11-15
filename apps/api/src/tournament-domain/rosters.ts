import { type Prisma, type RegistrationStatus, type RosterStatus } from '@rage/db';
import type { RosterEntryInput } from './eligibility.js';
import { registrationNotFound } from './tournament-errors.js';

type Tx = Prisma.TransactionClient;

export interface LockedRegistration {
  id: string;
  tournamentId: string;
  teamId: string;
  status: RegistrationStatus;
  seed: number | null;
}

/**
 * `SELECT … FROM tournament_registrations WHERE id = $1 FOR UPDATE` (after the tournament
 * lock). 404 when missing or not part of `tournamentId`.
 */
export async function lockRegistration(
  tx: Tx,
  tournamentId: string,
  registrationId: string,
): Promise<LockedRegistration> {
  const rows = await tx.$queryRaw<
    {
      id: string;
      tournament_id: string;
      team_id: string;
      status: RegistrationStatus;
      seed: number | null;
    }[]
  >`
    SELECT id, tournament_id, team_id, status, seed FROM tournament_registrations
    WHERE id = ${registrationId}::uuid AND tournament_id = ${tournamentId}::uuid
    FOR UPDATE`;
  const r = rows[0];
  if (!r) throw registrationNotFound();
  return {
    id: r.id,
    tournamentId: r.tournament_id,
    teamId: r.team_id,
    status: r.status,
    seed: r.seed,
  };
}

export interface CurrentRoster {
  id: string;
  version: number;
  status: RosterStatus;
  entries: RosterEntryInput[];
}

/** The current (DRAFT or LOCKED) roster version of a registration, or null. */
export async function currentRoster(tx: Tx, registrationId: string): Promise<CurrentRoster | null> {
  const roster = await tx.tournamentRoster.findFirst({
    where: { registrationId, status: { in: ['DRAFT', 'LOCKED'] } },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      version: true,
      status: true,
      entries: {
        orderBy: { id: 'asc' },
        select: { userId: true, steamId64Snapshot: true, nicknameSnapshot: true, role: true },
      },
    },
  });
  if (!roster) return null;
  return {
    id: roster.id,
    version: roster.version,
    status: roster.status,
    entries: roster.entries.map((e) => ({
      userId: e.userId,
      steamId64: e.steamId64Snapshot,
      nickname: e.nicknameSnapshot,
      role: e.role,
    })),
  };
}

/**
 * Writes the next roster version. Order matters (SCHEMA.md "Notes for writers"): the previous
 * version is marked SUPERSEDED **before** the new DRAFT/LOCKED row is inserted, because the
 * one-current-roster partial unique index is checked per row. Entries are new rows; existing
 * entries are never updated (immutability triggers).
 */
export async function writeRosterVersion(
  tx: Tx,
  input: {
    registrationId: string;
    previous: { id: string; version: number } | null;
    status: 'DRAFT' | 'LOCKED';
    lockedById?: string;
    changeReason?: string | null;
    entries: RosterEntryInput[];
    now: Date;
  },
): Promise<{ id: string; version: number }> {
  if (input.previous) {
    await tx.tournamentRoster.update({
      where: { id: input.previous.id },
      data: { status: 'SUPERSEDED' },
    });
  }
  const version = (input.previous?.version ?? 0) + 1;
  const roster = await tx.tournamentRoster.create({
    data: {
      registrationId: input.registrationId,
      version,
      status: input.status,
      lockedAt: input.status === 'LOCKED' ? input.now : null,
      lockedById: input.status === 'LOCKED' ? (input.lockedById ?? null) : null,
      supersedesRosterId: input.previous?.id ?? null,
      changeReason: input.changeReason ?? null,
      createdAt: input.now,
    },
    select: { id: true, version: true },
  });
  await tx.tournamentRosterEntry.createMany({
    data: input.entries.map((e) => ({
      rosterId: roster.id,
      userId: e.userId,
      steamId64Snapshot: e.steamId64,
      nicknameSnapshot: e.nickname,
      role: e.role,
      createdAt: input.now,
    })),
  });
  return roster;
}
