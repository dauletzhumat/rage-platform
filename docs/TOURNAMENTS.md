# Tournaments, registrations, roster snapshots, brackets, veto — M3 contract

Status: **contract for M3** (ADR-020). Source of truth for API, DB and web work in M3. Builds on
`docs/AUTH.md` (sessions, CSRF, RBAC, error envelope), `docs/TEAMS.md` (teams, operators,
idempotency, audit conventions) and `docs/API_CONVENTIONS.md`.

## 1. Principles
- **No game server in M3.** A match result can only come from an audited admin action
  (`result_source = ADMIN_OVERRIDE` or `FORFEIT`). Such results are never shown as
  server-verified (`result_verified_at` stays NULL; web labels them "Admin result"). Real
  server-confirmed results arrive in M4/M5 (`result_source = SERVER`).
- A tournament roster is an **immutable snapshot** (SteamID64 + nickname at registration),
  versioned in `tournament_rosters`; later team roster changes never alter it (A5). Changes after
  lock happen only through an audited admin substitution that creates a new version.
- Eligibility is decided from verified identities only: ACTIVE, non-sample users who are current
  active members of the team, whose SteamID64 is not banned, and who are not already on another
  team's PENDING/APPROVED roster in the same tournament.
- Every mutation: session + CSRF + optional `Idempotency-Key` (TEAMS.md §7), row locks + state
  checks + DB constraints inside one transaction, audit in the same transaction. Sample
  tournaments/teams/matches → 409 `SAMPLE_RESOURCE`.
- Bracket generation and advancement are deterministic and idempotent.

## 2. Roles
"Tournament admin of T" = SUPER_ADMIN, or an active `TOURNAMENT_ADMIN` grant that is GLOBAL or
scoped `TOURNAMENT:<T>`. "Match admin of M" = tournament admin of M's tournament, or an active
`MATCH_ADMIN` grant GLOBAL or scoped `MATCH:<M>`. "Team operator" = TEAMS.md §3 (captain or
`TEAM_MANAGER` of that team; SUPER_ADMIN override audited). Authority is re-checked inside the
transaction (`FOR SHARE` on grants), lock order: tournament → registration → team → grants →
rows (match locks: match → next match).

| Action | Who |
|---|---|
| Create tournament | SUPER_ADMIN or GLOBAL TOURNAMENT_ADMIN |
| Edit / change status / review registrations / seeds / generate bracket / substitutions | tournament admin of T |
| Register / update roster / withdraw | team operator of the registering team |
| Veto | team operator of the team whose turn it is |
| Result override / forfeit | match admin of M |
| Ban / lift SteamID64 | SUPER_ADMIN |
| Public reads | everyone (DRAFT tournaments are hidden: 404) |

## 3. Tournament lifecycle
`DRAFT → REGISTRATION_OPEN → REGISTRATION_CLOSED → IN_PROGRESS → COMPLETED`; `CANCELLED` from any
state before `COMPLETED` (reason required; non-completed matches become CANCELLED). Only
`generate-bracket` moves `REGISTRATION_CLOSED → IN_PROGRESS`; only completing the final moves
`IN_PROGRESS → COMPLETED`. Other transitions via `POST /admin/tournaments/:id/status`. Invalid →
409 `INVALID_STATE_TRANSITION`.

### 3.1 Settings (create / edit while DRAFT or REGISTRATION_OPEN)
| Field | Rule |
|---|---|
| `name` | 3–64 chars, team-name character rules (TEAMS.md §2/§13), unique case-insensitive |
| slug | derived server-side like team slugs (reserved words suffixed), never client-supplied |
| `format` | `SINGLE_ELIMINATION` only in M3 (others → 409 `FORMAT_NOT_SUPPORTED`) |
| `defaultMatchFormat` | BO1 / BO3 / BO5 |
| `finalMatchFormat` | optional BO1/BO3/BO5 (stored in `settings_json`) |
| `maxTeams` | 2–64 |
| `registrationOpenAt` / `registrationCloseAt` / `startsAt` | optional ISO times; close > open |
| `description` | ≤ 2000 chars, biography character rules |
| `mapPool` | **exactly 7** distinct names `^de_[a-z0-9_]{2,30}$`, admin-supplied (the platform ships no default pool — the active CS2 pool changes; never invented) |

Registration is accepted only while status is `REGISTRATION_OPEN` **and** `now()` is inside the
optional window.

## 4. Registration and roster snapshot
- `POST /tournaments/:id/registrations` (team operator): `{ teamId, starters: uuid[5],
  substitutes: uuid[0..2] }` → creates registration PENDING + roster version 1 (`DRAFT`) whose
  entries snapshot `steam_id64` and `nickname`. Team must be ACTIVE, non-sample.
- Validation (all in one transaction, team row locked):
  - exactly 5 distinct starters, ≤ 2 substitutes, no overlap → 400 `ROSTER_INVALID`;
  - each player: current active member of the team, user ACTIVE, non-sample, SteamID64 not in
    `banned_steam_ids` (active ban), not on another team's PENDING/APPROVED current roster in this
    tournament → otherwise 409 `PLAYER_INELIGIBLE` with `details: [{ field: "<userId>",
    message: "<REASON>" }]`, reasons `NOT_TEAM_MEMBER`, `USER_INACTIVE`, `SAMPLE`, `BANNED`,
    `ALREADY_REGISTERED_ELSEWHERE`;
  - one registration per (tournament, team) → 409 `ALREADY_REGISTERED` (DB unique).
- `PUT /tournaments/:id/registrations/:registrationId/roster` (team operator, registration
  PENDING): same body; creates version n+1 (`DRAFT`), previous becomes `SUPERSEDED`.
- `POST /tournaments/:id/registrations/:registrationId/withdraw` (team operator): allowed while
  PENDING or APPROVED and tournament not IN_PROGRESS → WITHDRAWN.
- `GET /me/registrations` (session): registrations of teams the user operates, with current roster.
- **Approve** (`POST /admin/tournaments/:id/registrations/:registrationId/approve`, tournament
  admin, `{ note? }`): lock tournament → registration must be PENDING (`REGISTRATION_NOT_PENDING`)
  → approved count < `maxTeams` (`TOURNAMENT_FULL`) → **re-validate every entry** (same rules as
  above, except "current team member" is NOT re-checked: the snapshot is what counts) → roster
  `LOCKED` (`locked_at`, `locked_by`) → APPROVED. Concurrent approvals never exceed `maxTeams`.
- **Reject** (`{ reason }` 3–500) → REJECTED, reason visible to the team operators.
- **Substitution after lock** (`POST /admin/tournaments/:id/registrations/:registrationId/
  substitute`, tournament admin, `{ outUserId, inUserId, role: STARTER|SUBSTITUTE, reason }`):
  only before the team's first match is COMPLETED; `inUserId` must pass eligibility (incl.
  current team membership); creates new LOCKED version, old → SUPERSEDED, `change_reason` set,
  audited.

## 5. Bans
`banned_steam_ids(steam_id64, reason, created_by, created_at, lifted_at, lifted_by)`; one active
ban per SteamID (partial unique). `POST /admin/banned-steam-ids` `{ steamId64, reason }`,
`POST /admin/banned-steam-ids/:id/lift` `{ reason }`, `GET /admin/banned-steam-ids` (SUPER_ADMIN).
A ban blocks new registrations/approvals/substitutions containing that SteamID; already locked
rosters are not silently rewritten (admins substitute or remove the team explicitly).

## 6. Seeding and bracket (single elimination)
- `PUT /admin/tournaments/:id/seeds` `{ seeds: [{ registrationId, seed }] }` (REGISTRATION_CLOSED;
  must cover every APPROVED registration with seeds 1..N, unique → else 400 `SEEDS_INVALID`).
  Unseeded registrations at generation get seeds after the seeded ones, ordered by approval time.
- `POST /admin/tournaments/:id/generate-bracket` (REGISTRATION_CLOSED, ≥ 2 APPROVED → else 409
  `NOT_ENOUGH_TEAMS`): bracket size S = next power of two ≥ N; standard seeding order (1 vs S, 2 vs
  S-1 … placed so seeds 1 and 2 can only meet in the final); seeds > N are byes. Creates
  `tournament_stages` (sequence 1), `brackets` (generation_version 1), all `bracket_slots` with
  `next_slot_id` / `next_slot_position`, and one `matches` row per slot (round 1 with both teams;
  later rounds with TBD teams). A round-1 slot with a bye creates **no playable match**: its match
  row is created `CANCELLED` with `status_reason = 'bye'` and the seeded team is placed directly
  into the next match. Team A = better seed. Match format: `defaultMatchFormat`, final uses
  `finalMatchFormat` if set. Tournament → IN_PROGRESS. A second call → 409 `BRACKET_EXISTS`.
- `GET /tournaments/:slug/bracket` (public): `{ format, size, rounds: [{ roundNumber, name,
  matches: [MatchSummaryDto + slot info] }] }`.

## 7. Match state machine (M3 subset; ADR-018 Q5)
Series statuses: `CREATED, SERVER_ASSIGNED, PREPARING, WARMUP, READY_CHECK, LIVE, PAUSED,
COMPLETED, CANCELLED, FAILED, DISPUTED` (`KNIFE` and `MAP_FINISHED` are removed from
`MatchStatus` in the M3 migration; they live in `MatchMapStatus`). The transition table is a pure,
unit-tested module (`apps/api/src/matches/state-machine.ts`); every transition is appended to
`match_state_transitions(match_id, from_status, to_status, source, actor_user_id, reason,
created_at)` (append-only) and bumps `matches.version`. M3 only uses `CREATED → COMPLETED`
(override/forfeit) and `* → CANCELLED` (bye / tournament cancel); server states arrive in M4.

## 8. Map veto
- Pool = tournament `mapPool` (7 maps). Sequence by format (team A starts):
  - BO1: A ban, B ban, A ban, B ban, A ban, B ban → decider (remaining map).
  - BO3: A ban, B ban, A pick, B pick, A ban, B ban → decider.
  - BO5: A ban, B ban, A pick, B pick, A pick, B pick → decider.
- Allowed only when the match is `CREATED`, both teams are known, tournament IN_PROGRESS, and the
  veto is not complete. Side selection is out of scope (knife round / server, M4).
- `GET /matches/:id/veto` (public): `{ pool, actions: [{ sequence, teamId, action, mapName,
  createdAt }], next: { teamId, action } | null, remaining: string[], complete }`.
- `POST /matches/:id/veto` (operator of the team whose turn it is) `{ action: BAN|PICK, mapName }`:
  lock match → expected action & team must match the turn (`VETO_NOT_YOUR_TURN`), map in remaining
  pool (`VETO_INVALID_MAP`), not complete (`VETO_COMPLETE`) → insert `map_veto_actions`
  (`unique (match_id, sequence)` makes concurrent submissions safe). When only the decider
  remains, the server inserts the `DECIDER` action and creates `match_maps` rows (`PENDING`,
  `map_order` = pick order, decider last).

## 9. Results (admin, M3 only)
- `POST /admin/matches/:id/result-override` (match admin) `{ winnerTeamId, teamAScore, teamBScore,
  reason }`: match must be `CREATED` with both teams (`MATCH_NOT_READY`) and not completed
  (`MATCH_ALREADY_COMPLETED`); scores are **maps won** and must fit the format (BO1 1–0; BO3 2–0
  / 2–1; BO5 3–0/3–1/3–2; winner has the majority) → else 400 `SCORE_INVALID`. Sets COMPLETED,
  `result_source = ADMIN_OVERRIDE`, `result_verified_at` NULL.
- `POST /admin/matches/:id/forfeit` (match admin) `{ forfeitingTeamId, reason }`: winner = the
  other team, scores NULL, `result_source = FORFEIT`.
- **Advancement** (same transaction): lock the next match, place the winner into
  `next_slot_position` (A/B). If the completed match is the final → tournament COMPLETED and
  `team_achievements` placements 1 (winner) and 2 (loser). Re-running → 409
  `MATCH_ALREADY_COMPLETED` (or the stored response for the same idempotency key). Corrections of a
  completed result are out of scope for M3 (dispute flow later).

## 10. Endpoints (all under `/api/v1`)
Public: `GET /tournaments` (excludes DRAFT), `GET /tournaments/:slug` (+ `mapPool`,
`defaultMatchFormat`, `finalMatchFormat`, `maxTeams`, registration window, approved team count),
`GET /tournaments/:slug/teams` (APPROVED registrations with seed and current LOCKED roster:
`playerSlug`, `nicknameSnapshot`, `role` — no SteamIDs beyond what player pages already show),
`GET /tournaments/:slug/bracket`, `GET /matches`, `GET /matches/:id` (+ `resultSource`,
`tournament`, `round`), `GET /matches/:id/veto`.

Team operator: `POST /tournaments/:id/registrations`, `PUT …/registrations/:registrationId/roster`,
`POST …/registrations/:registrationId/withdraw`, `GET /me/registrations`, `POST /matches/:id/veto`.

Admin: `GET /admin/tournaments` (all statuses), `POST /admin/tournaments`, `PATCH
/admin/tournaments/:id`, `POST /admin/tournaments/:id/status` `{ to, reason? }`, `GET
/admin/tournaments/:id/registrations?status`, approve / reject / substitute, `PUT
/admin/tournaments/:id/seeds`, `POST /admin/tournaments/:id/generate-bracket`, `POST
/admin/matches/:id/result-override`, `POST /admin/matches/:id/forfeit`, banned SteamID endpoints.

DTO names: `AdminTournamentDto`, `CreateTournamentDto`, `UpdateTournamentDto`,
`TournamentStatusChangeDto`, `RegistrationDto` (`{ id, tournament: {id, slug, name}, team: {id,
slug, name, tag}, status, seed, reviewReason, createdAt, roster: TournamentRosterDto }`),
`TournamentRosterDto` (`{ id, version, status, lockedAt, entries: [{ userId, playerSlug,
steamId64, nickname, role }] }` — SteamIDs only in operator/admin views),
`AdminRegistrationDto`, `CreateRegistrationDto`, `SeedsDto`, `BracketDto`, `VetoStateDto`,
`VetoActionDto`, `ResultOverrideDto`, `ForfeitDto`, `BannedSteamIdDto`, `PublicTournamentTeamDto`.

## 11. Error codes (M3)
`INVALID_STATE_TRANSITION`, `FORMAT_NOT_SUPPORTED`, `TOURNAMENT_NAME_TAKEN`,
`REGISTRATION_CLOSED`, `ALREADY_REGISTERED`, `ROSTER_INVALID`, `PLAYER_INELIGIBLE`,
`TOURNAMENT_FULL`, `REGISTRATION_NOT_PENDING`, `SEEDS_INVALID`, `NOT_ENOUGH_TEAMS`,
`BRACKET_EXISTS`, `MATCH_NOT_READY`, `MATCH_ALREADY_COMPLETED`, `SCORE_INVALID`,
`VETO_NOT_YOUR_TURN`, `VETO_INVALID_MAP`, `VETO_COMPLETE`, `SUBSTITUTION_NOT_ALLOWED`,
`STEAM_ID_ALREADY_BANNED`. Plus M1/M2 codes (`SAMPLE_RESOURCE`, `FORBIDDEN_ROLE`, …).

## 12. Audit actions (M3)
`tournament.create`, `tournament.update`, `tournament.status_change`, `registration.submit`,
`registration.roster_update`, `registration.withdraw`, `registration.approve`,
`registration.reject`, `registration.substitute`, `tournament.seeds`, `bracket.generate`,
`match.veto`, `match.result_override`, `match.forfeit`, `match.advance`, `steam_ban.create`,
`steam_ban.lift`.

## 13. Web
| Route | Behaviour |
|---|---|
| `/tournaments` | public list (status filter), sample badges |
| `/tournaments/[slug]` | overview (formats, window, map pool, status), approved teams with locked rosters, bracket view (rounds, TBD, byes, winners, "Admin result" flag), "Register team" for operators while open |
| `/tournaments/[slug]/register` | operator: pick team (if they operate several — normally one), choose 5 starters + ≤2 subs from current active roster, show eligibility errors per player; edit while PENDING; withdraw |
| `/matches/[id]` | teams, format, status, result + source label, veto board (pool, actions log, whose turn) with Ban/Pick buttons for the acting operator, map list after veto |
| `/admin/tournaments` | list incl. DRAFT; create/edit form (map pool 7 inputs), status actions, registrations queue (approve/reject/substitute), seeding editor, generate bracket (confirm) |
| `/admin/matches` | matches of active tournaments, result override / forfeit dialogs (reason required, warning that it is not server-verified) |
| `/admin/bans` | SteamID64 ban list (SUPER_ADMIN) |

## 14. Acceptance mapping and mandatory tests
A5 (5 eligible verified starters, snapshot survives later team changes, banned/duplicate
SteamIDs excluded, admin approval), A6 subset (state machine, veto turn rules, atomic idempotent
advancement, forfeit/override audited; server allocation/recovery → M4), A9, A10.
Concurrency tests: concurrent approvals at `maxTeams`; same player registered by two teams
concurrently; concurrent veto submissions for the same turn; double result-override / override vs
forfeit on one match; two semifinals completing concurrently into the same final; double
generate-bracket. Unit tests: seeding order for sizes 2–64, byes, veto sequences, score
validation, state machine table.

## 15. Contract additions (agreed during M3 implementation)
1. `GET /admin/tournaments/:id` (tournament admin) → `AdminTournamentDto`, all statuses incl. DRAFT.
2. Team refs on match/bracket DTOs carry `id`, `slug`, `name`, `tag`.
3. `MatchSummaryDto` / `MatchDetailDto` add `teamAScore`/`teamBScore` (maps won; null for
   forfeits), `winnerTeamId`, `resultSource`, `resultVerifiedAt`, `statusReason` (e.g. `bye`),
   `round: { roundNumber, name } | null`.
4. Bracket entries add `slotNumber`, `teamASeed`, `teamBSeed`, `isBye`; before generation
   `GET /tournaments/:slug/bracket` returns 200 with `rounds: []` (non-DRAFT tournaments).
5. Tournament detail adds `approvedTeamCount`, `maxTeams`, `defaultMatchFormat`,
   `finalMatchFormat | null`, `mapPool`, registration window.
6. `GET /tournaments/:slug/teams` is a plain array of `PublicTournamentTeamDto { registrationId,
   seed, team{id,slug,name,tag}, isSample, roster{ version, lockedAt, entries[{ playerSlug,
   nicknameSnapshot, role }] } }`.
7. Admin lists are paginated (`pageSize` ≤ 100); `AdminRegistrationDto` = `RegistrationDto` +
   `isSample`, `reviewedAt`; `BannedSteamIdDto { id, steamId64, reason, createdAt,
   createdBy{id,nickname}|null, liftedAt, liftedBy|null, liftReason }`.
8. `POST /matches/:id/veto` → `VetoStateDto`; result-override / forfeit → `MatchDetailDto`;
   status change `{ to, reason? }` (reason required for CANCELLED).
9. `MeRoleDto.scopeSlug` (team or tournament slug for scoped grants).
10. `GET /admin/matches?tournamentId&status&page&pageSize` (match/tournament admins; scoped grants
    see only their matches) → paginated `MatchSummaryDto`.
11. Web: round names are rendered client-side from position (Final / Semifinals / …), translated;
    admin datetimes are entered in UTC.

## 16. Implementation notes (M3 as built)
1. A COMPLETED match shows its winner publicly for any `result_source`; admin results always
   carry `resultSource` and never set `resultVerifiedAt`.
2. Result override / forfeit lock the tournament row first (then grants, match, next match), so
   results inside one tournament are serialized — prevents deadlocks between parallel finals.
3. Veto: operators of the acting team; SUPER_ADMIN may act as an audited override
   (`override: true`); tournament admins cannot veto; the other team's operator gets
   `VETO_NOT_YOUR_TURN`, anyone else 403.
4. `MATCH_ADMIN` grants may be scoped `MATCH:<id>` (AUTH.md §6).
5. Extra state rules: withdraw refused once IN_PROGRESS or COMPLETED; approve requires the
   tournament to be REGISTRATION_OPEN/CLOSED and the team ACTIVE (`TEAM_NOT_ACTIVE`); opening
   registration requires a map pool and `maxTeams`; substitution allowed while OPEN, CLOSED or
   IN_PROGRESS (before the team's first completed match).
6. Error choices: lifting a lifted ban → 409 `INVALID_STATE_TRANSITION`; substitution with an
   outgoing player not on the roster or breaking 5+≤2 → 400 `ROSTER_INVALID`; roster PUT with a
   different `teamId` → 400; unknown user id in a roster → `NOT_TEAM_MEMBER`.
7. Tournament slug is fixed at creation (renames keep it); reserved words get a suffix.
8. Additive fields: `TournamentDetailDto.registrationOpen`; `AdminTournamentDto.
   pendingRegistrationCount|bracketGenerated|updatedAt`; `BannedSteamIdDto.active|userId`;
   `BracketMatchDto.nextMatchId`; bracket `size: 0` before generation; `statusReason` is `bye` or
   `tournament_cancelled`.
9. Coded errors may carry `details` (`PLAYER_INELIGIBLE`, `ROSTER_INVALID`).
10. Bracket generation writes an initial `NULL → CREATED` (or `NULL → CANCELLED` for byes)
    transition per match, source ADMIN, actor = the admin; `version` stays 0.
11. Known limits: a team that withdrew or was rejected cannot register again for the same
    tournament (one registration per team); PENDING registrations left at bracket generation stay
    PENDING and can no longer be approved; the map pool is frozen once registration closes.

## 17. Hardening after the M3 gates
- DB (`20261115000000_m3_hardening`): roster entries can only be inserted into a DRAFT roster or
  one created in the same transaction; roster `change_reason`/`supersedes_roster_id` frozen after
  DRAFT; a COMPLETED match's teams, winner, scores, `result_source`, `result_verified_at` are
  immutable and it can only move to DISPUTED; a SERVER result must be verified to be COMPLETED;
  `map_veto_actions` is append-only.
- Web: "Server-verified" only when `resultVerifiedAt` is set; otherwise "Awaiting server
  verification".
- API: conflict-of-interest rule (`CONFLICT_OF_INTEREST`, 403/409) — an operator of a team cannot
  approve/reject its registration, enter its results or forfeits, or act for both teams in a veto
  (SUPER_ADMIN may, audited as override); a tournament cannot hold two teams that share an
  operator. Admin registration entries show `noLongerMember`. Datetimes need an explicit offset.
  Bracket generation refuses non-ACTIVE approved teams (`TEAM_NOT_ACTIVE`).
- Known: the sample `sample-cup` seed is REGISTRATION_OPEN without a map pool (sample data,
  predates the rule); it cannot be re-seeded while real users exist and is labelled sample.

## 18. Development demo mode (sample data)
`ALLOW_SAMPLE_MUTATIONS=true` (refused when `NODE_ENV=production`) lets tournament admins run the M3
flow on **sample tournaments** only: edit/status, approve/reject/substitute, seeds, bracket, veto
(SUPER_ADMIN override), result override, forfeit; sample players are eligible only inside sample
tournaments; a sample player/team can never enter a non-sample tournament; a sample match in a
real tournament stays read-only; M1/M2 sample guards are unchanged. Audit rows carry
`detail.sample: true`. `GET /meta` exposes `features.sampleMutations.status`. Seed:
`pnpm db:seed:demo` with `ALLOW_DEMO_SEED=true` (RUNBOOK §11). Demo runs are not verification
evidence.
