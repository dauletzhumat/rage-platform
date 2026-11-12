# RAGE Platform — Roadmap (M0–M7)

Owner of this file: architect. Status lives in `docs/PROGRESS.md`; decisions in `docs/DECISIONS.md`; HTTP rules in `docs/API_CONVENTIONS.md`.
Acceptance references `A1`…`A12` are the numbered items in `docs/ACCEPTANCE.md`.
"Gate" = security + qa review that must pass (with real command output) before a milestone is marked Verified.

## Dependency order

```
M0 Foundation
 └─ M1 Steam identity + sessions + RBAC
     └─ M2 Team applications / invitations / rosters
         └─ M3 Tournaments / locked rosters / brackets / match fixtures (no server)
             ├─ M4 Server Agent + MatchZy control  (needs real CS2 server)
             │   └─ M5 Event ingest / live matchroom / persisted stats
             │       └─ M6 Public stats pages / RAGE Rating / advanced brackets / demos
             └──────────┴─ M7 Production readiness (can start ops work in parallel after M3)
```

Rules: no milestone starts implementation of a dependent domain before its predecessor's schema is migrated and its gate passed. Work that only needs adapter contracts (e.g. M4 agent protocol, fake adapter for tests) may be designed in parallel with M3 but cannot be marked Verified without the real server.

Standing gates for every milestone: A9 (security) and A11 (CI: fresh-DB migrate, seed, lint, typecheck, unit, integration, build). Mocked Steam/CS2 never satisfies A1/A2/A7.

---

## M0 — Foundation

**Goal:** working monorepo with web, API, DB, local services, CI, typed client, layouts and clearly marked sample seed. No auth, no business flows.

**Owners:** lead (apps/api, packages/api-client, root configs, PROGRESS); database (packages/db); frontend (apps/web); devops (docker-compose, docker/, .github/, RUNBOOK); architect (ROADMAP, API_CONVENTIONS, DECISIONS, ARCHITECTURE). Gates: security (headers, CORS, secrets in repo, `.env` handling), qa (A11 run).

**Planned files:** `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.mjs`; `apps/api/src/{main.ts,app.module.ts,common/**,config/**,infra/{prisma,redis}/**,health/**,meta/**}`, `apps/api/scripts/emit-openapi.mjs`; `packages/db/{prisma/schema.prisma,prisma/migrations/**,src/seed*.ts}`; `packages/api-client/{openapi.json,src/generated/**,src/index.ts}`; `apps/web/src/{app/**,lib/api/**,i18n/**,components/**}` with every route from MASTER_PROMPT as a shell; `tools/local-services/start.mjs`; `docker-compose.yml`, `docker/**`, `.github/workflows/ci.yml`; `docs/RUNBOOK.md`.

**API endpoints:** `GET /health/live`, `GET /health/ready`, `GET /meta` (all under `/api/v1`, see API_CONVENTIONS §Health); OpenAPI at `/api/docs`, `/api/docs-json`. Read-only list/detail endpoints over sample data are optional in M0 (only if they follow API_CONVENTIONS and are covered by tests).

**DB tables:** full SCHEMA.md identity/team/tournament/match/server/event/stats/audit/outbox tables may be migrated now (database agent decides), plus `is_sample` on users/teams/tournaments/matches (ADR-011). Constraints required in M0: unique `users.steam_id64`, unique `teams.slug`/`teams.name`, unique `(source_server_id, external_event_id)`, unique `(tournament_id, team_id)`.

**Acceptance:** A11 fully (fresh DB migrate → seed → lint → typecheck → unit → integration → build in CI); A12 partially (health endpoints + minimal RUNBOOK); A10 partially (public routes render without login; empty/loading/error states; en/ru/kk message catalogs wired; sample badge visible).

**External dependencies:** none mandatory. Docker optional (ADR-009 fallback). Object storage container only needs to boot (used from M5).

**Risks:** bleeding-edge toolchain (TS 6, Nest 12 ESM, Prisma 7 adapter) → keep ADR-007 pins, frozen lockfile. Over-scoping M0 with business endpoints that will be rewritten in M1/M2. Sample data mistaken for real (mitigate ADR-011 + badge).

---

## M1 — Steam OpenID login, sessions, RBAC shell

**Goal:** real Steam OpenID 2.0 sign-in creating exactly one user per verified SteamID64; secure server-side sessions; CSRF; rate limits; role grants; protected `/me`, captain and admin surfaces.

**Owners:** steam-auth (lead implementer), backend (session/guards/RBAC), database (auth_sessions, user_role_grants, nonce store), frontend (`/login`, `/me`, auth-aware nav, admin guard UX). Gates: security (A1 threat model: spoofed claimed_id, open redirect, replay, session fixation, CSRF), qa.

**Planned files:** `apps/api/src/auth/{auth.module.ts,steam-openid.service.ts,auth.controller.ts,session.service.ts,session.guard.ts,csrf.guard.ts,roles.guard.ts}`, `apps/api/src/users/**`, `apps/api/src/me/**`; `packages/db/prisma/migrations/*_auth/**`; `apps/web/src/app/(public)/login/**`, `apps/web/src/app/(protected)/me/**`, `apps/web/src/middleware.ts` (redirect only — authorization stays in API); tests `apps/api/test/auth/*.int.spec.ts`.

**API endpoints:** `GET /auth/steam` (302 to `https://steamcommunity.com/openid/login`), `GET /auth/steam/callback`, `POST /auth/logout`, `GET /me`, `GET /auth/csrf` (issues CSRF token; proposed), `GET /admin/users`, `POST /admin/users/:id/roles`, `POST /admin/users/:id/roles/:grantId/revoke` (needed by `/admin/users`; not in MASTER_PROMPT list — added here).

**DB tables:** `users`, `auth_sessions` (store token hash only), `steam_profiles`, `player_profiles`, `user_role_grants`, `audit_logs`; OpenID response-nonce replay store (Redis key with TTL, or table `openid_nonces(nonce PK, seen_at)` — decide in M1; must survive API restart within the nonce window ⇒ Redis with AOF or Postgres).

**Steam OpenID 2.0 facts (verified 2026-11-11):**
- OP endpoint `https://steamcommunity.com/openid/`; claimed_id format `http://steamcommunity.com/openid/id/<steamid64>` (source: https://partner.steamgames.com/doc/features/auth). Steam's page states no realm/return_to rules and does not mention localhost.
- OpenID 2.0 §9.2: `openid.return_to` MUST match `openid.realm` (realm may wildcard the host prefix, no fragment). §11.1: RP must check scheme/authority/path of the received `openid.return_to` equals the URL it is serving, and query params match. §11.3: RP tracks `openid.response_nonce` to reject replays. §11.4: without a stored association, RP verifies via `check_authentication` direct request to the OP (source: https://openid.net/specs/openid-authentication-2_0.html).
- Implementation rules derived: server-side POST `openid.mode=check_authentication` to the OP endpoint and require `is_valid:true`; require `openid.op_endpoint == https://steamcommunity.com/openid/login`; `claimed_id == identity` and regex `^https?://steamcommunity\.com/openid/id/(7656119\d{10})$`; reject SteamIDs in the ADR-011 sample range; verify `return_to` equals configured `STEAM_OPENID_RETURN_URL` (plus our own signed state param); nonce single-use with timestamp skew window (e.g. 5 min); `openid.signed` must cover `op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle`.
- **Local dev:** browser-only redirects mean the API need not be publicly reachable (check_authentication is outbound from API to Steam). `STEAM_OPENID_REALM=http://localhost:4000` + `STEAM_OPENID_RETURN_URL=http://localhost:4000/api/v1/auth/steam/callback` is the pattern widely used by Steam OpenID libraries; Steam does not officially document localhost support → **verify with a real login at M1 start**. If refused, use an HTTPS tunnel hostname and set realm/return_to to it. The realm host is shown to the user on the Steam login page.
- Cookie scope: session cookie is set by the API origin. Web (`:3000`) and API (`:4000`) on `localhost` are same-site, so `SameSite=Lax` works locally; `Secure` cookies on `http://localhost` are accepted by current Chromium/Firefox but verify Safari. Production must serve web and API same-site (recommended: same origin, reverse proxy `/api/v1` → API), see API_CONVENTIONS §Auth.

**Acceptance:** A1 (all negative cases via automated tests against a stubbed OP *transport*, plus one manual real-Steam login recorded with date/SteamID redacted), A2, A9 (CSRF, rate limits on `/auth/*`, no secrets client-side), A10 (login/me states).

**External dependencies / blocked steps:** a Steam account for a manual login (no partner account needed for OpenID). Without it: "real successful provider login" in A1 and A2 stay **Blocked**; all negative-path tests still run. Optional `STEAM_WEB_API_KEY` (from https://steamcommunity.com/dev/apikey; Steam's key terms and account-eligibility rules to be checked when registering) for `GetPlayerSummaries` name/avatar sync; without it profiles show SteamID64 + RAGE nickname only.

**Security prerequisites carried over from the M0 security review (2026-11-11) — must be done in M1 before any authenticated mutation ships:**
- **SEC-M0-M3 (Medium) nonce-based CSP:** replace `script-src 'self' 'unsafe-inline'` in `apps/web/next.config.ts` with per-request nonce + `strict-dynamic` (proxy/middleware); `img-src` allowlists only exact Steam CDN hosts. Required before the JS-readable CSRF cookie exists. Test: e2e asserts no `'unsafe-inline'` in `script-src` and a nonce present.
- **SEC-M0-M4 (Medium) DB roles:** separate `rage_owner` (migrations) and non-superuser `rage_app` (DML only; UPDATE/DELETE/TRUNCATE revoked on `audit_logs`, `match_events`). App currently connects as a superuser in dev. Record as ADR; test that the app role cannot UPDATE `audit_logs` even with `rage.allow_append_only_maintenance='on'`.
- **SEC-M0-L6 (Low) strict env:** in production require https `STEAM_OPENID_REALM`/`STEAM_OPENID_RETURN_URL` with return URL under the realm; `SESSION_SECRET` ≥ 32 bytes, non-empty; reject `API_DOCS_ENABLED=true` in production unless docs are protected. Tests in `env.test.ts`.
- **SEC-M0-L9 (Low) CI supply chain:** pin GitHub Actions to full commit SHAs (Dependabot keeps them updated).
- **Identity rules:** reject non-individual and sample-range SteamIDs at login (`isIndividualSteamId64` from `@rage/db`; DB check `users_sample_steam_id_range_chk` already enforces sample↔range); OpenID `response_nonce` replay store (Redis TTL); `claimed_id == identity` and `^https://steamcommunity.com/openid/id/\d{17}$`; exact `return_to` match; Origin/Referer + CSRF guard on unsafe methods; stricter throttle bucket for `/auth/*`; never trust client `x-request-id` for audit correlation (store server-generated id); validate Steam avatar/profile URLs (https, Steam hosts only).
- **Logging:** request logs already strip query strings and allowlist headers (SEC-M0-M1 fixed in M0); add a regression test for `/auth/steam/callback?openid.sig=…` when the route exists.
- **QA-M0-P2-1 rate-limit keying for SSR:** the throttler keys on client IP, and all Next.js SSR calls arrive from the web server's IP, so ~120 page views/min/route across ALL visitors exhaust one shared bucket (reproduced in the M0 QA gate). Before public exposure: authenticate an internal SSR channel (e.g. signed internal header from web → API, exempt from or with a separate high limit) and key public traffic on the real client IP via `TRUST_PROXY_HOPS` behind the reverse proxy; move throttler storage to Redis for multi-instance (M7). Also render 429 as a "busy, retry" state in web, not "unexpected error".

**Risks:** open redirect via post-login `returnTo` (allowlist relative paths only); trusting `openid.claimed_id` without check_authentication; nonce store lost on restart; admin bootstrap (first super admin must be granted by CLI/seed command keyed by SteamID64 env, audited — never by display name).

---

## M2 — Team applications, invitations, rosters, public team pages

**Goal:** captain application → admin approve/reject (idempotent, race-safe) → team + captain membership; invitations accept/decline/expire/revoke; captain transfer; roster history; public `/teams`, `/teams/[slug]`, `/players`, `/players/[id]`.

**Owners:** team-management (domain), backend (controllers, idempotency middleware), database (partial unique indexes, locking), frontend (`/teams/apply`, `/me/invitations`, `/teams/[slug]/manage`, `/admin/team-applications`, public pages). Gates: security (forged approvals/invites, IDOR, logo upload if done), qa (concurrency tests).

**Planned files:** `apps/api/src/{team-applications,teams,invitations,memberships,players,admin/team-applications}/**`, `apps/api/src/common/idempotency/**`; `packages/db/prisma/migrations/*_teams/**` (partial unique SQL); `apps/web/src/app/(public)/{teams,players}/**`, `(protected)/{teams/apply,teams/[slug]/manage,me/invitations}/**`, `admin/team-applications/**`.

**API endpoints:** `POST /team-applications`, `GET /team-applications/me`, `GET /admin/team-applications`, `POST /admin/team-applications/:id/approve|reject`; `GET /teams`, `GET /teams/:slug`, `GET /teams/:id/roster`, `POST /teams/:id/invitations`, `POST /teams/:id/invitations/:invitationId/revoke` (added), `GET /me/invitations`, `POST /invitations/:id/accept|decline`, `POST /teams/:id/transfer-captain`, `POST /teams/:id/members/:userId/remove` and `POST /teams/:id/leave` (added; roster release), `GET /players`, `GET /players/:slug`. `POST /teams` is **super-admin-only** (see open question Q1).

**DB tables:** `team_applications` (partial unique: one `PENDING` per applicant; unique requested slug among PENDING), `teams`, `team_memberships` (partial unique: one active membership per user per policy; active count ≤ cap enforced in transaction with `SELECT … FOR UPDATE` on team row), `team_invitations` (partial unique: one PENDING per team+invitee), `team_staff`, `audit_logs`, `idempotency_keys` (new, see API_CONVENTIONS §Idempotency).

**Acceptance:** A3, A4, A10 (team/player pages without login), A9 (object-level auth; 404 on hidden resources).

**External dependencies:** none beyond M1. Logo upload needs object storage (ADR-013) — may be deferred to M5/M6; until then `logo_key` null.

**Risks:** approval race (two admins) → row lock on application + unique team slug + state check `WHERE status='PENDING'`; invite accept race with roster cap; one-active-membership policy undefined for substitutes across teams (decide in M2).

---

## M3 — Tournaments, locked rosters, brackets, match fixtures

**Goal:** tournament CRUD + registration window; registration with 5 starters (+≤2 subs) building an immutable roster snapshot; admin approval; seeding; deterministic single-elimination BO1 bracket with byes; atomic idempotent advancement; forfeits/overrides with reason; then BO3 series rollup and map veto turn rules. No game server yet — results entered only by authorized admin override (audited, flagged `ADMIN_OVERRIDE`) for testing; never shown as server-verified.

**Owners:** tournament (domain), backend, database, frontend (`/tournaments`, `/tournaments/[slug]`, `/matches/[id]`, `/admin/tournaments`, `/admin/matches`, matchroom veto/ready UI shell). Gates: security (bracket tampering, unauthorized veto), qa (advancement/forfeit/idempotency).

**Planned files:** `apps/api/src/{tournaments,registrations,brackets,matches,map-veto,ready-check}/**`, `apps/api/src/matches/state-machine.ts` (pure, unit-tested); `packages/db/prisma/migrations/*_tournaments/**`; web routes above.

**API endpoints:** `GET/POST /tournaments`, `GET /tournaments/:slug`, `POST /tournaments/:id/register`, `GET /admin/tournaments/:id/registrations`, `POST /admin/tournaments/:id/registrations/:registrationId/approve|reject` (added), `POST /tournaments/:id/generate-bracket`, `GET /tournaments/:id/bracket`, `GET/POST /matches`, `GET /matches/:id`, `POST /matches/:id/veto` (added; body `{action, mapName}`), `POST /matches/:id/ready` (added), `POST /matches/:id/forfeit` (added, admin, reason), `POST /matches/:id/result-override` (added, admin, reason, audited).

**DB tables:** `tournaments`, `tournament_stages`, `tournament_registrations`, `tournament_rosters`, `tournament_roster_entries`, `brackets`, `bracket_slots`, `matches`, `match_rosters`, `match_maps`, `match_map_players`, `map_veto_actions`, `audit_logs`, `outbox_events`. Needed additions (see Q-list): banned SteamID list, roster substitution history, match state transition log, optimistic `version` column on `matches`.

**Acceptance:** A5, A6 (except "no duplicate server allocation" and "paused match recovers after API restart" with real server → M4), A9, A10.

**External dependencies:** none.

**Risks:** state machine scope ambiguity (series vs map states, see Q5); double elimination needs `bracket_slots.loser_next_slot_id` (not in SCHEMA); veto order for BO1/BO3/BO5 must be configurable per tournament, not hardcoded.

---

## M4 — Server Agent, server pool, leases, MatchZy control

**Goal:** register game servers; outbound authenticated agent connection; heartbeats/version reporting; reservation leases with no double booking; allowlisted command envelope with ack/timeout/retry/audit; MatchZy match config built from locked SteamID64 snapshots; **prove a real handshake on a test CS2 server**.

**Owners:** cs2-integration (agent, plugin, MatchZy config), backend (servers module, command bus, agent gateway), database (allocations, commands, agents, encrypted secrets), devops (agent deployment doc, firewall), frontend (`/admin/servers`, assign-server UI). Gates: security (agent impersonation, command injection, RCON exposure, secret storage), qa (lease concurrency, restart recovery).

**Planned files:** `apps/api/src/{servers,server-agents,server-commands,allocations}/**`, `apps/api/src/server-provider/{server-provider.interface.ts,fake.provider.ts (test-only),agent.provider.ts}`; `apps/server-agent/` (.NET; csproj, `Program.cs`, config loader, outbound WS/HTTPS client, MatchZy/RCON local bridge); `plugins/rage-cs2/` only if MatchZy gaps proven; `apps/web/src/app/admin/servers/**`; `docs/CS2_SERVER_SETUP.md` (cs2-integration).

**API endpoints:** `GET/POST /servers`, `GET /servers/:id/status`, `POST /servers/:id/commands` (allowlisted `type` enum only; `Idempotency-Key`), `POST /matches/:id/assign-server|prepare|pause|resume`, agent-facing (separate auth, not cookie): `POST /agent/v1/enroll`, WS/HTTPS channel `/agent/v1/connect`, `GET /agent/v1/matches/:id/config` (MatchZy JSON, short-lived token), `POST /agent/v1/events` (M5).

**DB tables:** `game_servers`, `server_agents`, `server_allocations` (partial unique: one active allocation per server and per match), `server_command_requests` (add `command_id` UUID unique, `idempotency_key`, `signature`, `attempts`), new `server_secrets` (encrypted at rest; key from env/KMS), `audit_logs`.

**MatchZy / CounterStrikeSharp facts found 2026-11-11 — "to re-verify at M4":**
- MatchZy latest release `0.9.2` published 2026-10-18 (0.9.1 2026-10-03, 0.9.0 2026-10-01); release notes require Metamod and CounterStrikeSharp pre-installed, or a `with-cssharp` bundle; no required CSS version stated. Source: https://github.com/shobhit-pathak/MatchZy/releases
- CounterStrikeSharp latest `v1.0.379` published 2026-10-31 (v1.0.378 2026-10-23); ships `with-runtime` zips bundling .NET runtime (version not stated in notes). Source: https://github.com/roflmuffin/CounterStrikeSharp/releases
- CSS getting-started requires "Metamod: Source 2.X Dev Build", "build 1467 or newer, with KHook support". Source: https://docs.cssharp.dev/docs/guides/getting-started.html
- MatchZy documented controls (https://shobhit-pathak.github.io/MatchZy/match_setup/, `/configuration/`): `matchzy_loadmatch <file>`, `matchzy_loadmatch_url "<url>" [header name] [header value]`; JSON requires `maplist`, `team1`, `team2`, `num_maps`, `players` map SteamID64→name (SteamID64 only); `matchzy_remote_log_url` (+ `matchzy_remote_log_header_key`/`_value`) POSTs events as JSON; `matchzy_demo_upload_url`; `matchzy_whitelist_enabled_default`; `matchzy_kick_when_no_match_loaded`.
- CS2 updates frequently break Metamod/CSS gamedata; compatibility must be checked against the CS2 build on the day of testing, and versions pinned in `docs/CS2_SERVER_SETUP.md`.

**Acceptance:** A6 (no duplicate server allocation; paused match recovers after API restart), A7 partially (MatchZy loads real verified SteamIDs; allowlisted actions; ack visible), A12 (agent loss/reconnect documented).

**External dependencies / blocked steps without them:**
1. Linux (or Windows) host for CS2 dedicated server via SteamCMD (app 730), enough disk (~60 GB+, verify) and UDP game port reachable by players.
2. Game Server Login Token (GSLT) for app 730 from https://steamcommunity.com/dev/managegameservers if the server must be listed/connectable over the internet (LAN-only testing may not need it — verify at M4).
3. Metamod:Source dev build, CounterStrikeSharp (+ .NET runtime, or `with-runtime` bundle), MatchZy installed and versions recorded.
4. .NET SDK on the agent build host (version chosen at M4 from current LTS).
5. Network path from agent host to API (outbound HTTPS/WSS; API reachable from that host — a tunnel or LAN IP in dev).
Without 1–3: real handshake, MatchZy load, command ack, A7 remain **Blocked**; fake provider tests only.

**Risks:** CS2 game updates breaking plugins on match day; MatchZy pulling config via URL means the API (or agent local endpoint) must be reachable from the game server — prefer agent serving config locally/fetching it outbound; RCON password handling; clock skew for command deadlines.

---

## M5 — Event ingest, live matchroom, persisted stats

**Goal:** signed, deduplicated, ordered raw event ingest; round scores; K/D/A (+ADR/HS%/KAST where telemetry supports) with documented formulas; server-confirmed final result reconciled and committed once with bracket advancement; live matchroom via Socket.IO with snapshot + sequence resync; public match pages and player/team histories; demo upload if MatchZy upload works.

**Owners:** statistics (event model, aggregation, formulas doc `docs/STATS_FORMULAS.md`), backend (ingest endpoint, outbox → WS, BullMQ workers), cs2-integration (event source mapping), database, frontend (`/matchroom/[id]`, `/matches/[id]`), devops (object storage). Gates: security (false event injection, signature validation), qa (duplicate/out-of-order replay, reconnect).

**Planned files:** `apps/api/src/{events,stats,realtime}/**`, `apps/worker/` (BullMQ consumers: aggregation, outbox publisher, notifications), `apps/web/src/app/(protected)/matchroom/[id]/**`, `apps/web/src/lib/realtime/**`.

**API endpoints:** `POST /agent/v1/events` (agent auth), `GET /matches/:id/events` (cursor pagination by sequence), `GET /matches/:id/stats`, `GET /matches/:id/demo` (signed URL), Socket.IO namespace `/matchroom` (API_CONVENTIONS §WebSocket).

**DB tables:** `match_events` (add `schema_version`, `signature_verified`, append-only), `match_rounds`, `player_round_stats`, `player_map_stats`, `team_map_stats`, `demos`, `outbox_events`.

**Acceptance:** A7 (event collection, final score reconciled, demos if supported), A8, A6 (result rollup with real data), A10 (live/empty/error states, no fake live data).

**External dependencies:** M4 server + ≥2 real clients (10 for a full match; 1v1/2v2 with `players_per_team` acceptable for pipeline proof — mark scope honestly); object storage (ADR-013) for demos.

**Risks:** MatchZy event payload lacks stable IDs → derive deterministic event ID (hash of matchid+map+round+tick+type+payload) and document; ADR/KAST denominators; late events after result commit (authoritative correction path with audit).

---

## M6 — Public stats pages, RAGE Rating, advanced formats, demos

**Goal:** HLTV-inspired dense team/player pages with filters and provenance; FACEIT-inspired interactions; original documented RAGE Rating v1 with versioned snapshots; leaderboards; double elimination; demo parsing proof-of-concept.

**Owners:** statistics (rating, snapshots), frontend, tournament (double elim, BO5), backend, database (ranking queries + EXPLAIN). Gates: security, qa.

**API endpoints:** `GET /leaderboards/players|teams`, `GET /players/:slug/stats`, `GET /teams/:slug/stats|matches|h2h/:otherSlug` (proposed), demo endpoints.

**DB tables:** `team_ranking_snapshots`, new `player_ranking_snapshots`, `rating_algorithms(version, doc_url, released_at)`, `team_achievements`, `demos`.

**Acceptance:** A8 (rating version labelled), A10, A6 (double elim).

**External dependencies:** a maintained CS2 demo parser chosen after POC (license check); object storage.

**Risks:** implying HLTV equivalence; heavy aggregate queries (materialize snapshots, not live scans).

---

## M7 — Production readiness

**Goal:** deployable, observable, recoverable system; secrets management; load tests; backup + restore rehearsal; access review; deployment guide.

**Owners:** devops (lead), security (full audit), qa (E2E + load), backend/database (perf fixes). 

**Planned files:** `docker/prod/**`, reverse proxy config (TLS), `docs/RUNBOOK.md` (expand), `docs/DEPLOYMENT.md`, `docs/SECURITY.md`, load test scripts `tools/load/**`, monitoring dashboards.

**Acceptance:** A12 (backups + restore rehearsal executed, agent loss/reconnect), A9 (full), A11, A7 end-to-end on production-like infra.

**External dependencies:** production domain + DNS + TLS certificates; production Steam realm/return URL on that domain; hosting for Postgres/Redis/object storage; secret store; monitoring stack.

**Risks:** cookie/CSRF misconfiguration across domains; migration safety (no destructive migrations without approval); RCON/Postgres exposure.

---

## Open questions (tracked until resolved by ADR)

- **Q1** MASTER_PROMPT lists `POST /teams`, which conflicts with ADR-002 (teams only via approved application). Proposal: `POST /teams` exists only for super admin, requires reason, audited; captains never.
- **Q2** Route `/players/[id]`: id = `player_profiles.slug` (proposed) vs UUID vs SteamID64. Proposal: slug; SteamID64 lookup via `GET /players?steamId=` only.
- **Q3** `GET /teams/:slug` vs `GET /teams/:id/roster` mix slug and UUID at the same path position. Accepted with rule: slugs can never match the UUID regex (enforced in DB check + DTO).
- **Q4** Team manager role: `team_memberships.role` vs `team_staff`; PRODUCT_SPEC says manager "explicitly granted". Proposal: manager is a `user_role_grants` row scoped to team; `team_staff` is for public display (coach/analyst).
- **Q5** MASTER_PROMPT state list mixes series and map states (`MAP_FINISHED`). Proposal: `matches.status` = CREATED/SERVER_ASSIGNED/PREPARING/WARMUP/READY_CHECK/LIVE/PAUSED/COMPLETED/CANCELLED/FAILED/DISPUTED; `match_maps.status` = PENDING/KNIFE/LIVE/PAUSED/MAP_FINISHED/CANCELLED.
- **Q6** SCHEMA gaps (database agent): `is_sample` (ADR-011); banned SteamIDs (A5); idempotency keys; OpenID nonce store; roster substitution history; match state transition log; `matches.version`; `player_ranking_snapshots`; `bracket_slots.loser_next_slot_id`; encrypted server/agent secrets; agent credentials rotation; match disputes; ready-check records; `match_events.schema_version`/signature; `server_command_requests.command_id`.
- **Q7** One-active-membership policy: does a substitute count? Can a user be on two teams in different regions? Decide in M2 ADR.
- **Q8** MFA for privileged accounts (PRODUCT_SPEC) — Steam OpenID gives no MFA signal; decide at M1/M7 (e.g. WebAuthn step-up for super admin).
