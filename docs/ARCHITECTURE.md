# Architecture and contracts

## Logical architecture
- `apps/web`: Next.js; public SSR content, authenticated captain views, admin dashboard, matchroom WebSocket client.
- `apps/api`: NestJS modules Auth, Users/Players, TeamApplications, Teams/Memberships, Tournaments, Brackets, Matches, MapVeto, Servers, Events, Stats, Demos, Admin/Audit.
- `apps/worker`: BullMQ consumers for stats aggregation, notifications, event delivery, ranking recompute, demo postprocessing.
- `apps/server-agent`: local agent deployed adjacent to game server. Makes outbound mutually authenticated connection/short lived signed channel to API; holds RCON secret locally where possible; collects logs and game events; agent heartbeats and confirms command outcomes.
- `plugins/rage-cs2`: optional CounterStrikeSharp plugin complementing MatchZy, **only after checking plugin/version/API compatibility**.
- `apps/demo-worker`: queue-driven parser (choose maintained compatible parser after proof-of-concept).
- PostgreSQL: source of truth; Redis: ephemeral queue/cache; object storage: demos/assets.

## Critical boundaries
1. Steam authentication identity != profile display name; verify OpenID server side.
2. `team_application` != `team`; approval transaction creates `team` + captain membership once.
3. `team_membership` != `tournament_roster_entry`; latter is an immutable tournament-specific snapshot.
4. `match` (series) != `match_map` (per-map score, rounds, demo), with `match_map_player` snapshot.
5. `match_control_requested` != `server_acknowledged`; commands have ids, TTL, ack, retries and audit.
6. Events from server must use stable event ID / tick / sequence, de-duped per source; raw store is append only and aggregated views are rebuildable.
7. Result verification and bracket advancement commit in the same transaction, idempotently.

## Server adapter
`ServerProvider` interface: health, reserve/release, prepare(matchConfig), executeAllowedCommand(command, requestId), reconcileState, collectEvents, retrieveDemo. `MatchConfig` contains verified SteamID64s from locked roster, maps, tournament rules, game-side options and callback tokens. `AgentCommand` envelope includes commandId, matchId, serverId, issuedBy, deadline, signature and status (queued/sent/acknowledged/failed/timed_out). No arbitrary external shell execution.

## Event model
Envelope `{eventId, sourceServerId, matchId, matchMapId, type, tick, sequence, occurredAt, receivedAt, payload, schemaVersion}`. Validate signature, schema, ownership, match lifecycle; uniqueness `(sourceServerId,eventId)`. Keep event time vs processing time; replay safely; handle reconnect gaps, reorder windows and authoritative corrections. WebSocket broadcasts derived events; clients reconnect using snapshot + last sequence.

## Operational correctness
Server allocations use leases and unique active reservation; never double-book. Backend restart resumes pending matches from DB and agent reconciliation. Report outdated agent or game plugin version. Demo path lives in object storage, not database bytes. Monitoring: API latency, dropped events, command ack latency, agent health, replay queue and errors.

## Repository layout
```
rage-platform/
├─ apps/
│  ├─ api/                 NestJS 12 (ESM) REST + OpenAPI; later Socket.IO gateway     [M0]
│  │  ├─ src/common/       errors (ApiErrorDto), request id, pagination, guards
│  │  ├─ src/config/       env validation (zod)
│  │  ├─ src/infra/        prisma, redis providers
│  │  ├─ src/health/ meta/ liveness/readiness, build meta
│  │  ├─ src/<domain>/     one Nest module per domain (auth, teams, tournaments, matches, servers, events, stats, admin…)
│  │  ├─ scripts/          emit-openapi.mjs, dev runner
│  │  └─ test/             unit + integration (real Postgres)
│  ├─ web/                 Next.js 16 App Router; public, protected, admin route groups [M0]
│  │  └─ src/lib/api/      only place that calls the API (via @rage/api-client)
│  ├─ worker/              BullMQ consumers: aggregation, outbox publisher, notifications [M5]
│  ├─ server-agent/        .NET outbound agent next to CS2 server                      [M4]
│  └─ demo-worker/         queue-driven demo parser (after POC)                       [M6]
├─ plugins/
│  └─ rage-cs2/            CounterStrikeSharp plugin, only for proven MatchZy gaps    [M4+]
├─ packages/
│  ├─ db/                  Prisma schema, migrations (incl. raw SQL partial indexes), seed, PrismaClient factory
│  └─ api-client/          generated OpenAPI types + openapi-fetch client (no hand edits to generated/)
├─ tools/
│  └─ local-services/      Docker-less Postgres (embedded-postgres) + Redis launcher (ADR-009)
├─ docker/                 Dockerfiles, compose support files
├─ docker-compose.yml      postgres, redis, object storage (ADR-013), optional api/web
├─ .github/workflows/      CI: install (frozen), migrate fresh DB, seed, lint, typecheck, test, integration, build, contract drift
└─ docs/                   MASTER_PROMPT, PRODUCT_SPEC, ARCHITECTURE, SCHEMA, ACCEPTANCE, DECISIONS, ROADMAP, API_CONVENTIONS, PROGRESS, RUNBOOK
```

### Module dependency rules
- `apps/web` → `packages/api-client` only. No imports from `apps/api`, `packages/db`, or Prisma types; no direct `fetch` outside `src/lib/api`.
- `apps/api` → `packages/db`. Controllers → services → Prisma; no Prisma calls in controllers. Domain modules talk through exported services, not each other's repositories.
- `apps/worker` → `packages/db` (+ shared queue contracts when extracted to a package). No HTTP calls back into the API for domain writes.
- `apps/server-agent` / `plugins/rage-cs2` → API only over the agent protocol (`/agent/v1/**`); never the database.
- No cross-app imports (`apps/*` never import from another `apps/*`). Shared code goes to a `packages/*` package with its own build.
- `packages/api-client` is generated output plus a thin wrapper; it depends on nothing in the repo.
- PostgreSQL is the only business database; Redis holds only reconstructible or TTL data (queues, cache, rate limits, nonces only if persistence configured).

## External dependencies requiring manual setup
| Dependency | Needed from | Manual step | Blocked without it |
|---|---|---|---|
| Steam OpenID realm + return URL | M1 | Set `STEAM_OPENID_REALM` and `STEAM_OPENID_RETURN_URL` (return URL must lie within realm, OpenID 2.0 §9.2). Dev: `http://localhost:4000` + `/api/v1/auth/steam/callback` (common practice, not officially documented by Steam — verify); else HTTPS tunnel host. Prod: HTTPS domain. A Steam account to perform a real login. | A1 "real successful login", A2 |
| Steam Web API key (optional) | M1 | Register at https://steamcommunity.com/dev/apikey (check Steam's eligibility/terms at registration); store as `STEAM_WEB_API_KEY` server-side only | Display name/avatar sync (profiles fall back to SteamID64 + nickname) |
| CS2 dedicated server | M4 | Host (Linux preferred) with SteamCMD install of CS2 (app 730), open UDP game port, sufficient disk; record CS2 build id | A6 server parts, A7, M4/M5 verification |
| Game Server Login Token (GSLT) | M4 (if internet-facing) | Create for app 730 at https://steamcommunity.com/dev/managegameservers; set on server launch; keep secret | Public/internet server listing and client connect via internet (LAN test may not need it — verify) |
| Metamod:Source + CounterStrikeSharp + .NET runtime | M4 | Install Metamod:Source 2.x dev build (CSS docs: build ≥1467 with KHook support), CSS (`with-runtime` bundle or separate .NET runtime), pin versions compatible with current CS2 build | MatchZy and any RAGE plugin |
| MatchZy | M4 | Install release matching installed CSS; configure `matchzy_remote_log_url` + header cvars, `matchzy_kick_when_no_match_loaded`; record version | Match config load, event stream (A7) |
| .NET SDK | M4 | On agent build host; version chosen at M4 | `apps/server-agent` build |
| S3-compatible storage | M5 (logos optional M2) | Choose per ADR-013; create bucket + credentials; set `S3_*` env | Demo storage, logo upload |
| Production TLS domain | M7 (M1 if tunnel) | DNS, certificates (reverse proxy), same-site web/API layout | Production Steam realm, Secure cookies, deployment |
