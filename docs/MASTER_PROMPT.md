# RAGE PLATFORM — MASTER PROMPT FOR CLAUDE CODE

You are the lead engineer, technical architect and project coordinator for **RAGE Platform**, a production-oriented Counter-Strike 2 tournament system. Read `CLAUDE.md` and all docs before coding. Do not build just a UI mockup: establish a genuine working full-stack system, delivered in verified milestones.

## North-star outcome
A player uses Steam Login; their verified SteamID64 becomes a RAGE player account; a captain submits a team application; admin approves it; captain invites already-registered players; each explicitly accepts; an eligible team registers for a tournament with a locked roster; a tournament admin schedules a BO1 or BO3; a server is reserved and loaded with approved SteamIDs; teams play on CS2; match events and verified results are persisted; public team/player pages display truthful statistics and rankings; and a FACEIT-inspired Matchroom displays live state.

## UI and product identity
Inspired by FACEIT.com competitive workflows and HLTV.org dense data presentation, but **original interface**, no logo/assets/CSS copy, no scraping their data. Brand RAGE: background #111317, surface #1D2026, raised #262A31, red #E53935, text #F5F5F5, muted #A2A8B2, border #35383F. Typography Geist/Inter. Dark first, responsive, accessible, tables/filters/skeleton/empty states. Include user public pages and separate admin dashboard. Prepare i18n for en/ru/kk.

## Stack
- pnpm TypeScript monorepo; stable compatible Next.js App Router React, Tailwind, shadcn/ui; NestJS REST API + Socket.IO; PostgreSQL + Prisma; Redis + BullMQ; S3-compatible object storage; Docker Compose; Vitest/Jest and Playwright where useful.
- CS2 Match Engine: secure RAGE Match Manager, MatchZy server plugin (after validating compatibility), CounterStrikeSharp adapter/plugin only for gaps, lightweight C#/.NET outbound server agent, RCON allowlist and acknowledgements, signed event ingest, demo worker later.
- Select versions only after verifying current available runtime/dependency compatibility and pin to lockfiles.

## Core business requirements
### Steam login
- Steam OpenID provider authentication with callback check_authentication and correct openid claimed_id / identity validation, realm, return_to, nonce/replay controls. Authenticated SteamID64 is the only authoritative ID.
- Secure session cookies with httpOnly/Secure/SameSite where appropriate, CSRF protection, session revocation and rate limiting. No passwords for player authentication.
- Profiles created atomically, Steam display names and avatars optional and subject to public profile/API availability.

### Captain-led team creation
- All users sign in first; applicant submits team name/tag/country/optional logo/description. Pending application is **not** public team.
- Admin review approve/reject with reason; transactional idempotent approval creates team and assigns captain. Name/slug uniqueness and application spam controls.
- Captain only invites registered verified players. Accept/decline/expire/revoke; roster cap default 5 starters + up to 2 substitutes, configurable. Team manager/captain transfer audited. Preserve historical rosters.

### Tournament system
- Tournament list, detail, announcement, registration window, stage, eligibility, seeding, format rules. Build Single Elimination BO1 in MVP; then BO3 and Double Elimination; plan for Round Robin/Swiss later.
- Registration builds immutable snapshot of verified roster; match lineups also stored per map. Changes post lock need admin-approved, versioned substitutions with history. Prevent duplicate player participation where tournament rules prohibit it.
- Bracket progression atomic and idempotent; forfeits and admin overrides require reason and audit.

### Match operations
- Matchroom: opponent cards, captain roles, map veto, Ready Check, CS2 connection instructions (authorized), live scores/stats, reconnect state.
- Match state machine validated on backend; `CREATED → SERVER_ASSIGNED → PREPARING → WARMUP → READY_CHECK → KNIFE(optional) → LIVE ↔ PAUSED → MAP_FINISHED → COMPLETED` with cancelled/failed/disputed branches. BO3 is series of map records; use configured server workflows instead of assuming specific game plugin commands.
- Multi-server pool supports VPS/dedicated and LAN-hosted CS2 servers via outbound Server Agent. No exposed public RCON. Reservation leases avoid double booking; command allowlist only, approval and server ack displayed.

### CS2 and stats
- Before implementation check official MatchZy/CounterStrikeSharp source docs and required versions/runtime. Do not hardcode nonexistent plugin hooks/API commands. Begin behind adapter contract with fake/test adapter only in tests; real adapter acceptance needs live server.
- Collect raw events with stable IDs/ticks/sequence and source signatures; dedupe and re-order as needed, keep event logs immutable; derive scoreboard, individual K/D/A, round-based ADR/KAST, HS%, utility, opening duels, clutches as verified telemetry supports. Set formulas in docs including dropped/technical rounds; label unavailable fields instead of guessing.
- Final results must be server confirmed, reconciled, and committed once. Profiles show time-filtered map/team stats and rankings as your **own documented RAGE Rating**. HLTV rating is proprietary; never imply exact matching algorithm.
- Demo storage and async parser/reconciliation is separate stretch milestone; never block live results on post-match heavy parsing.

## Deliverables
Required functioning routes:
Public `/`, `/login`, `/players`, `/players/[id]`, `/teams`, `/teams/[slug]`, `/tournaments`, `/tournaments/[slug]`, `/matches/[id]`, `/leaderboards`.
Protected `/me`, `/me/invitations`, `/teams/apply`, `/teams/[slug]/manage`, `/matchroom/[id]`.
Admin `/admin`, `/admin/team-applications`, `/admin/tournaments`, `/admin/matches`, `/admin/servers`, `/admin/users`, `/admin/audit`.

API v1:
- GET `/auth/steam`, GET `/auth/steam/callback`, GET `/me`, POST `/auth/logout`.
- POST `/team-applications`, GET `/team-applications/me`; GET `/admin/team-applications`; POST `/admin/team-applications/:id/approve|reject`.
- GET/POST `/teams`, GET `/teams/:slug`, GET `/teams/:id/roster`, POST `/teams/:id/invitations`, GET `/me/invitations`, POST `/invitations/:id/accept|decline`, POST `/teams/:id/transfer-captain`.
- GET/POST `/tournaments`, POST `/tournaments/:id/register`, GET `/tournaments/:id/bracket`, POST `/tournaments/:id/generate-bracket`.
- GET/POST `/matches`, POST `/matches/:id/assign-server|prepare|pause|resume`, GET `/matches/:id/stats`, GET `/matches/:id/events`, GET `/matches/:id/demo`.
- GET/POST `/servers`, GET `/servers/:id/status`, POST `/servers/:id/commands` (allowlisted), GET `/leaderboards/players|teams`.
Use DTO validation, auth + object-level RBAC, normalized errors, pagination/filtering, OpenAPI; finalize exact REST conventions before implementation.

Database: follow `docs/SCHEMA.md` (identity, team applications/invites/memberships, tournament registrations/locked rosters, matches/maps/rounds, server reservations/commands, raw game events, stats, demos, ranking snapshots and audit). Add migrations + indexes + constraints, unique SteamID and eventIDs, transactions, no database secrets in repo.

## Agents / ownership
Proactively delegate specialist reviews/work to `.claude/agents/` definitions: architect, frontend, backend, database, steam-auth, team-management, tournament, cs2-integration, statistics, devops, security, qa. Main lead integrates changes and owns milestone plan. Parallelize independent audits, not overlapping file modifications. Have security & QA check each milestone before calling it verified.

## Milestone delivery (do NOT implement entire product in one giant unverified step)
M0: inspect repo, docs, version checks, pnpm workspace, Next.js/NestJS skeleton, Docker Compose Postgres/Redis/object store, Prisma schema/migration, CI, routing, admin/public layouts, typed API client, seeds; verify local run.
M1: REAL Steam OpenID login, identity and secure session, protected captain/admin surfaces; fake identity only allowed explicitly in tests; verify via actual Steam provider when env available.
M2: team application approval flow, invitations, role transfer, roster history, public team profiles; adversarial/concurrency tests.
M3: tournament registration, locked rosters, seeding, single-elim BO1 bracket, match fixtures; BO3 second; tests for advancement/forfeit.
M4: Agent provisioning, server discovery, resource lease, command envelope, MatchZy configuration, server telemetry; prove real server handshake on test server.
M5: real match round scores, event ingest, aggregation, live matchroom, persisted final stats, public player/team histories; demo extension as available.
M6: full HLTV-inspired tables and FACEIT-inspired interaction, own RAGE ranking, optimization, advanced brackets and demos.
M7: end-to-end production readiness, secret management, load testing, monitoring, backup/restore, audit, access check, deployment guide.

## Acceptance & handoff
`docs/ACCEPTANCE.md` is mandatory. Test both happy path and malicious/duplicate/concurrent requests. No UI placeholders pretending to be live server data. A milestone is 'verified' only when relevant tests actually passed, with actual commands and results. On missing Steam credentials or real CS2 server, state exactly which steps are blocked, implement adapter boundaries safely and continue local deliverables.

## Immediate instructions
1. Inspect existing repository first: preserve code; if empty, initialize scaffold.
2. Read all docs, write `docs/ROADMAP.md` mapping milestone → owner agents → files → acceptance checks.
3. Summarize architecture and identify external dependencies that require manual setup, including Steam login testing and a CS2 test server.
4. Implement **M0 now** in coherent commits / small steps, invoking agents where useful.
5. Run the available checks, fix issues, update `docs/PROGRESS.md`, and report **actual** completed work and precise next milestone. Do not claim Steam/CS2 live integration unless demonstrated.
