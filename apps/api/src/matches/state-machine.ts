/**
 * Series-level match state machine (docs/TOURNAMENTS.md §7, ADR-018 Q5). PURE: no I/O.
 *
 * `matches.status` holds series states only; map-level progress (knife, map finished) lives in
 * `match_maps.status`. Each edge lists the transition sources allowed to take it:
 *   - ADMIN  — an audited admin action (result override, forfeit, cancel, …); needs an actor.
 *   - SYSTEM — the platform itself (bracket generation, tournament cancellation cascade, …).
 *   - SERVER — a verified game-server event (M4/M5).
 *
 * M3 uses only `CREATED → COMPLETED` (ADMIN: override / forfeit) and `* → CANCELLED`
 * (bye at bracket generation, tournament cancellation). The server-driven edges are defined now
 * so M4 extends a reviewed table instead of inventing one; they are unit-tested but unused.
 */

export const SERIES_STATUSES = [
  'CREATED',
  'SERVER_ASSIGNED',
  'PREPARING',
  'WARMUP',
  'READY_CHECK',
  'LIVE',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'DISPUTED',
] as const;
export type SeriesStatus = (typeof SERIES_STATUSES)[number];

export const TRANSITION_SOURCES = ['ADMIN', 'SYSTEM', 'SERVER'] as const;
export type TransitionSource = (typeof TRANSITION_SOURCES)[number];

type Edges = Partial<Record<SeriesStatus, readonly TransitionSource[]>>;

const ADMIN = ['ADMIN'] as const;
const ADMIN_SYSTEM = ['ADMIN', 'SYSTEM'] as const;
const SERVER_SYSTEM = ['SERVER', 'SYSTEM'] as const;
const ANY = ['ADMIN', 'SYSTEM', 'SERVER'] as const;

/**
 * from → to → allowed sources. Anything not listed is invalid. Terminal: CANCELLED.
 * COMPLETED can only be re-opened through DISPUTED (dispute flow, after M3).
 */
export const SERIES_TRANSITIONS: Readonly<Record<SeriesStatus, Edges>> = {
  CREATED: {
    SERVER_ASSIGNED: ADMIN_SYSTEM,
    COMPLETED: ADMIN, // result override / forfeit (M3)
    CANCELLED: ADMIN_SYSTEM, // bye, tournament cancellation
  },
  SERVER_ASSIGNED: {
    PREPARING: ANY,
    CREATED: ADMIN_SYSTEM, // server released before the match started
    COMPLETED: ADMIN,
    CANCELLED: ADMIN_SYSTEM,
    FAILED: ANY,
  },
  PREPARING: {
    WARMUP: SERVER_SYSTEM,
    COMPLETED: ADMIN,
    CANCELLED: ADMIN_SYSTEM,
    FAILED: ANY,
  },
  WARMUP: {
    READY_CHECK: SERVER_SYSTEM,
    COMPLETED: ADMIN,
    CANCELLED: ADMIN_SYSTEM,
    FAILED: ANY,
  },
  READY_CHECK: {
    LIVE: SERVER_SYSTEM,
    WARMUP: SERVER_SYSTEM, // ready check failed / timed out, back to warmup
    COMPLETED: ADMIN, // no-show forfeit
    CANCELLED: ADMIN_SYSTEM,
    FAILED: ANY,
  },
  LIVE: {
    PAUSED: ['SERVER', 'ADMIN'],
    COMPLETED: ['SERVER', 'ADMIN'],
    CANCELLED: ADMIN,
    FAILED: ANY,
  },
  PAUSED: {
    LIVE: ['SERVER', 'ADMIN'],
    COMPLETED: ['SERVER', 'ADMIN'],
    CANCELLED: ADMIN,
    FAILED: ANY,
  },
  COMPLETED: {
    DISPUTED: ADMIN,
  },
  DISPUTED: {
    COMPLETED: ADMIN,
    CANCELLED: ADMIN,
  },
  FAILED: {
    CREATED: ADMIN_SYSTEM, // recovery: reallocate a server
    COMPLETED: ADMIN,
    CANCELLED: ADMIN_SYSTEM,
  },
  CANCELLED: {},
};

export const TERMINAL_SERIES_STATUSES: ReadonlySet<SeriesStatus> = new Set(['CANCELLED']);

export function isSeriesStatus(value: string): value is SeriesStatus {
  return (SERIES_STATUSES as readonly string[]).includes(value);
}

/** True iff `from → to` is an edge of the table and `source` may take it. */
export function canTransition(
  from: SeriesStatus,
  to: SeriesStatus,
  source: TransitionSource,
): boolean {
  if (from === to) return false;
  const sources = SERIES_TRANSITIONS[from][to];
  return sources !== undefined && sources.includes(source);
}

/** Statuses reachable from `from` by `source`. */
export function nextStatuses(from: SeriesStatus, source: TransitionSource): SeriesStatus[] {
  return SERIES_STATUSES.filter((to) => canTransition(from, to, source));
}

export class InvalidSeriesTransitionError extends Error {
  constructor(
    readonly from: SeriesStatus,
    readonly to: SeriesStatus,
    readonly source: TransitionSource,
  ) {
    super(`Match transition ${from} -> ${to} is not allowed for source ${source}`);
    this.name = 'InvalidSeriesTransitionError';
  }
}

export function assertTransition(
  from: SeriesStatus,
  to: SeriesStatus,
  source: TransitionSource,
): void {
  if (!canTransition(from, to, source)) throw new InvalidSeriesTransitionError(from, to, source);
}
