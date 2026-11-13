# RAGE API conventions (v1)

Status: **Final for M0**. Sections marked **Proposed for M1+** are agreed direction, not yet implemented; they become binding when the named milestone implements them. Changes require an ADR.
Implementation references: `apps/api/src/common/{errors,http,pagination}/**`.

## 1. Base, transport, versioning
- All HTTP routes live under global prefix **`/api/v1`**. Paths below omit the prefix.
- JSON only (`application/json; charset=utf-8`), UTF-8, **camelCase** property names in requests and responses. DB snake_case never leaks.
- Versioning: URL major version. Within `v1` only additive changes (new endpoints, new optional fields, new enum values flagged in changelog). Removing/renaming fields, tightening validation, or changing semantics ⇒ `v2` prefix run in parallel for ≥1 release. Clients must ignore unknown fields.
- Contract source of truth: OpenAPI generated from Nest decorators (ADR-010). Served at `/api/docs` (Swagger UI) and `/api/docs-json`; disabled in production unless `API_DOCS_ENABLED=true` and protected. `packages/api-client` is generated from it; CI fails on drift (`pnpm openapi:generate` + `git diff --exit-code`).
- Every controller method must declare: success DTO, error responses (`ApiErrorDto`), auth requirement, and `operationId` stable across releases (`<resource>_<action>`, e.g. `teamApplications_approve`).

## 2. Resources and paths
- Plural nouns, kebab-case: `/team-applications`, `/servers/:id/status`.
- IDs: **UUID** in paths. Exception: public read of players/teams/tournaments by **slug** (`GET /teams/:slug`, `GET /tournaments/:slug`, `GET /players/:slug`). Sub-resources and all mutations use UUID (`/teams/:id/roster`). Slugs: `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$` and must never match the UUID pattern (DB check + DTO), so the router never confuses them.
- Current user: `/me`, `/me/invitations`. Admin-only surfaces: `/admin/**` (in addition to guards; prefix is not the security control).
- **Actions** that are state transitions, not field updates: `POST /resource/:id/<verb>` with verbs `approve|reject|accept|decline|revoke|register|generate-bracket|assign-server|prepare|pause|resume|transfer-captain|forfeit|veto|ready`. Never `PATCH status`. Action bodies carry only the inputs the transition needs (e.g. `{ reason }`).
- `PATCH` (partial update, JSON merge semantics) for editable fields of owned resources; `PUT` not used. `DELETE` only where deletion is a real business operation (rare; history is retained).
- Agent-facing endpoints live under `/agent/v1/**` with agent credentials, never cookies (M4).

## 3. Data formats
- Timestamps: ISO-8601 UTC with `Z`, millisecond precision (`2026-11-11T18:04:05.123Z`). Dates without time: `YYYY-MM-DD`.
- Enums: `UPPER_SNAKE` strings (`PENDING`, `SERVER_ASSIGNED`). Exposed in OpenAPI as named enums.
- SteamID64: **string** (exceeds JS safe integer). Never accepted from clients as identity; only as a search filter.
- Money: integer minor units + `currencyCode` (ISO-4217).
- Nullable vs absent: optional unknown values are `null` (e.g. unavailable stat) — never `0` as a placeholder. Stats responses include `ratingVersion` and provenance where relevant.
- Booleans `isX`/`hasX`; sample records expose `isSample: true` (ADR-011).

## 4. Lists, pagination, filtering, sorting
- Query: `page` (1-based, default 1, max 10000), `pageSize` (default 20, max 100). Out-of-range ⇒ 400 validation error.
- Response: `{ items: T[], page, pageSize, total }`.
- Filtering via explicit, documented query params (`status=PENDING`, `region=EU`, `tournamentId=`); repeated param for multi-value (`status=LIVE&status=PAUSED`). Free text search: `q` (max 64 chars, case-insensitive).
- **Proposed for M1+:** `sort=field` / `sort=-field` from a per-endpoint allowlist; default sort documented per endpoint and always includes a unique tiebreaker (id) for stable pages.
- **Proposed for M5:** append-only/high-volume streams (`GET /matches/:id/events`) use cursor pagination `?afterSequence=&limit=` → `{ items, nextAfterSequence }` instead of page/total.

## 5. Errors
Envelope for every non-2xx response (`ApiErrorDto`):
```json
{ "statusCode": 409, "error": "Conflict", "message": "Team name already taken", "requestId": "…", "details": [{ "field": "name", "message": "…" }] }
```
- `error` = HTTP reason phrase; `message` = human-readable, safe to display; `details` optional.
- `requestId`: inbound `x-request-id` accepted if `^[A-Za-z0-9._:-]{1,128}$`, otherwise a UUID is generated; always echoed in the `x-request-id` response header and logged.
- 5xx never expose stack traces, SQL, Prisma codes or internal hostnames.

Status code policy:
| Code | Use |
|---|---|
| 400 | DTO validation failure (`details: [{field, message}]`, dot paths, `(root)` for body-level), malformed JSON, bad query params |
| 401 | No valid session / agent credential |
| 403 | Caller is authenticated and **may know the resource exists** but lacks permission (e.g. player calling an admin action on a public team) |
| 404 | Resource absent **or** caller may not know it exists (another user's application/invitation, unpublished tournament, other team's private data). Object-level checks prefer 404 to avoid enumeration |
| 409 | Uniqueness conflicts (name/slug/tag), invalid state transition (approve non-PENDING, accept expired invitation), roster cap, optimistic-lock mismatch, idempotency key reuse with different payload |
| 422 | **Not used.** Semantic/business rule failures are 409 (state) or 400 (input). Kept out to avoid ambiguous client handling |
| 429 | Rate limited; includes `Retry-After` |
| 503 | `/health/ready` failing dependency; maintenance |

- **Proposed for M1+:** add stable machine-readable `code` (e.g. `TEAM_NAME_TAKEN`, `INVALID_STATE_TRANSITION`, `INVITATION_EXPIRED`) to the envelope; additive, so it fits v1. Clients branch on `code`, never on `message` (messages will be localized).
- **Proposed for M1 (implementation gap):** map Prisma unique violation (`P2002`) to 409 and record-not-found (`P2025`) to 404 in the exception filter; today they fall through to 500.

## 6. Authentication, sessions, CSRF (M1)
- Players authenticate only via Steam OpenID 2.0 (`GET /auth/steam` → Steam → `GET /auth/steam/callback`). No passwords.
- Session: opaque random token (≥256 bits) in cookie `rage_session`, `HttpOnly; Secure; SameSite=Lax; Path=/`; DB stores only its hash (`auth_sessions.token_hash`). Rotate on login; absolute + idle expiry; logout and admin revocation set `revoked_at`. Production cookie name `__Host-rage_session` when web and API are same-origin.
- CSRF: double-submit token. API issues a non-HttpOnly cookie `rage_csrf` whose value is an HMAC bound to the session id; client echoes it in header **`x-csrf-token`** on every unsafe method (`POST/PATCH/DELETE`) authenticated by cookie. Mismatch ⇒ 403. Plus `Origin`/`Referer` allowlist check on unsafe methods. GET handlers never mutate state. Agent endpoints (no cookies) are exempt.
- `GET /auth/steam?returnTo=` accepts only relative same-site paths from an allowlist (open-redirect defence); it's carried in a signed, short-lived state value, not trusted from the callback query.
- Deployment topology: web and API must be same-site; recommended production layout is a single origin with reverse proxy `/api/v1/*` → API, which removes CORS for browsers. CORS (`API_CORS_ORIGINS`) is an explicit allowlist with credentials; never `*`.
- SSR: Next.js server components call `API_INTERNAL_URL` forwarding only the session cookie; never forward client-supplied identity headers.

## 7. Authorization
- Guards order: rate limit → authentication → CSRF → role (RBAC from `user_role_grants`, scoped) → object-level policy in the service (ownership/membership/scope), inside the same transaction as the mutation when the decision depends on mutable state.
- Roles: `SUPER_ADMIN`, `TOURNAMENT_ADMIN` (scope: global|tournament), `MATCH_ADMIN` (global|tournament), `OBSERVER` (match/tournament), `TEAM_MANAGER` (team). Captain is derived from active membership, not a grant. Display names never confer permissions.
- Every admin/state-changing action writes `audit_logs` (actor, action, resource, detail incl. reason, requestId).

## 8. Idempotency (design; implemented from M2)
- Header **`Idempotency-Key`** (UUID v4 or 16–64 safe chars) on state-changing action POSTs: approve/reject, accept/decline/revoke, register, generate-bracket, assign-server, prepare/pause/resume, server commands, forfeit, result override. Required for server commands and generate-bracket; optional (recommended) elsewhere — the web client always sends one per user intent.
- Storage `idempotency_keys(user_id|agent_id, key, method, route, request_hash, status, response_status, response_body, created_at, expires_at)`, unique `(principal, key)`; retention 24 h.
- Semantics (as built in M2, `docs/TEAMS.md` §12.13): the first request atomically reserves an `IN_PROGRESS` row in its own statement, the business transaction runs, and the 2xx response is stored after commit (errors release the key; an abandoned `IN_PROGRESS` row can be taken over after 120 s); correctness never depends on this layer; replay with same hash ⇒ stored response (same status, header `Idempotency-Replayed: true`); same key different hash ⇒ 409; concurrent in-progress ⇒ 409 with `Retry-After`.
- Idempotency keys are a convenience layer; correctness still comes from DB constraints and state checks (approve twice ⇒ second sees non-PENDING ⇒ 409 or returns existing result for the same key).
- Server commands additionally carry a server-generated `commandId` (ARCHITECTURE §Server adapter).

## 9. Rate limiting
- `@nestjs/throttler` global default (per IP + per user when authenticated), stricter buckets for `/auth/*` (login start + callback), application submission, invitations, and agent enrollment. Redis-backed storage when more than one API instance runs (M7). 429 + `Retry-After`. Exact limits live in config, documented in RUNBOOK.

## 10. Health and meta
- `GET /health/live` — process up; no dependency checks; 200 `{ status: "ok" }`.
- `GET /health/ready` — PostgreSQL + Redis reachable (Terminus); 200 or 503 with per-dependency status, no connection strings.
- `GET /meta` — service name, version, commit sha, API version, build time; no secrets, no env dump.
- Paths are under `/api/v1` like everything else. **Proposed for M7:** also expose unversioned `/healthz`/`/readyz` aliases if the orchestrator needs them.

## 11. WebSocket / realtime (Socket.IO, M5)
- Namespace **`/matchroom`** (Socket.IO path behind proxy: `/api/socket.io`). Handshake authenticated by session cookie; `Origin` allowlist; anonymous allowed for public rooms only.
- Rooms: `match:{matchId}` (public: state, scores, rounds), `match:{matchId}:team:{teamId}` (participants: connection details, veto/ready prompts), `match:{matchId}:staff` (admins/observers). Join is authorized server-side on every `subscribe`.
- Client → server: `subscribe { matchId, lastSequence? }`, `unsubscribe { matchId }`. **No mutations over WebSocket** — veto/ready/pause go through REST (CSRF, idempotency, audit).
- Server → client: `match.snapshot { matchId, sequence, state, maps, scores, veto, ready, serverStatus }`, `match.event { matchId, sequence, type, occurredAt, payload }`. `sequence` is a per-match, gap-free, monotonically increasing broadcast sequence assigned from the outbox (distinct from game-server event sequence).
- Resync: on subscribe/reconnect, if `lastSequence` is within the retained window the server replays missing events; otherwise sends a fresh snapshot. Clients detect gaps (`sequence != last+1`) and resubscribe. Events are idempotent by `sequence`.
- Event names: `domain.verb` lower dot case. Payload shapes are documented in OpenAPI components (`x-ws-events`) and exported via api-client types.

## 12. Logging, headers, misc
- Structured logs (pino) with `requestId`, `userId` (if any), route, status, latency; never tokens, cookies, OpenID query strings, RCON/agent secrets.
- Security headers via helmet; `Cache-Control: no-store` on authenticated responses; public GETs may set short `Cache-Control: public, max-age` later (M6).
- Uploads (M2+/M5): pre-signed object-storage URLs or streaming with size limit and server-side MIME sniffing; never trust client `Content-Type`.
- i18n: API returns stable `code`s and English `message`; UI localizes. `Accept-Language` is not used by the API for logic.
