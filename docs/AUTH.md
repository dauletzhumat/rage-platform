# Authentication & authorization (M1) — design contract

Status: **implemented in `apps/api` (M1, 2026-11-12)**; a real Steam login still requires the
manual check in §13. Decisions: ADR-014 … ADR-018.
Implementers must keep this file in sync with code; the API's OpenAPI document is the
source of truth for request/response shapes once implemented.

## 1. Principles
- The **only** player identity is a SteamID64 verified server-side through Steam OpenID 2.0
  (`check_authentication`). No passwords, no client-supplied SteamIDs, no display-name trust.
- Only **individual** SteamID64s are accepted (`isIndividualSteamId64` from `@rage/db`);
  the reserved sample range (ADR-011) is always rejected.
- Authorization is decided **only in the API** (guards + object checks). The web app only
  hides/redirects for UX.
- A test-only OpenID **transport stub** may be injected in tests. There is no "dev login",
  no bypass flag, and nothing in production code paths that fakes Steam.

## 2. Configuration (API env)
| Var | Rule |
|---|---|
| `STEAM_OPENID_REALM` | absolute URL, no path beyond `/`, no fragment; https in production |
| `STEAM_OPENID_RETURN_URL` | absolute URL **under the realm**, path `/api/v1/auth/steam/callback`; https in production |
| `WEB_PUBLIC_URL` | absolute origin of the web app; post-login redirect target; must be in `API_CORS_ORIGINS` |
| `SESSION_SECRET` | ≥ 32 bytes of randomness (HMAC key for state/CSRF binding); required whenever Steam auth is configured; required in production |
| `SESSION_TTL_HOURS` (336) / `SESSION_IDLE_HOURS` (72) | absolute / idle session lifetime |
| `COOKIE_SECURE` | default `true` in production, `false` otherwise (http://localhost) |
| `STEAM_WEB_API_KEY` | optional; enables display name/avatar sync (`GetPlayerSummaries`) |
| `BOOTSTRAP_SUPER_ADMIN_STEAM_ID64` | optional; see §7 |
| `INTERNAL_SSR_TOKEN` | ≥ 32 bytes; shared with the web server for SSR calls (§8) |
| `AUTH_RATE_LIMIT_PER_MINUTE` (20) | strict per-IP, per-route bucket for `/auth/*` (named throttler `auth`) |

Implementation notes (`apps/api/src/config/env.ts`):
- Steam sign-in is **configured** only when realm, return URL, `WEB_PUBLIC_URL` and a valid
  `SESSION_SECRET` are all present; then `WEB_PUBLIC_URL` must also be listed in
  `API_CORS_ORIGINS` (boot error otherwise). Missing pieces ⇒ `unconfigured` (no error).
- **Malformed** values are boot errors in every environment (realm with path/query/fragment/
  credentials; return URL not exactly `<realm origin>/api/v1/auth/steam/callback`; short
  secrets; non-individual bootstrap SteamID; `SESSION_IDLE_HOURS > SESSION_TTL_HOURS`).
- `WEB_PUBLIC_URL` defaults to `http://localhost:3000` outside production; realm/return/web
  URLs are normalized to origins (no trailing slash); `openid.realm` is sent as the origin.
- Production additionally rejects `COOKIE_SECURE=false` and an http `WEB_PUBLIC_URL`, and
  requires `SESSION_SECRET` + `INTERNAL_SSR_TOKEN` even when Steam is not configured.

`/api/v1/meta` → `features.steamAuth.status`: `configured` when realm/return URL/web URL/secret
are valid, otherwise `unconfigured`. While unconfigured `GET /auth/steam` returns **503** and the
callback redirects to `WEB_PUBLIC_URL/login?error=not_configured` (503 if no web URL is known).

Production env validation rejects: http realm/return URL, return URL outside realm, missing or
short `SESSION_SECRET`, `API_DOCS_ENABLED=true` (docs auth does not exist yet), missing
`INTERNAL_SSR_TOKEN`.

## 3. Login flow
1. Browser → `GET /api/v1/auth/steam?returnTo=/me` (top-level navigation from the web app).
   - `returnTo`: optional **relative** path (`^/(?!/)[^\s\\]*$`, max 512); anything else → `/`.
   - API generates `state` (32 random bytes, base64url), sets cookie `rage_oidc`
     (httpOnly, SameSite=Lax, Path=`/api/v1/auth`, Max-Age 600, Secure per `COOKIE_SECURE`)
     containing `state` + `returnTo`, HMAC-signed with `SESSION_SECRET`.
   - 302 → `https://steamcommunity.com/openid/login` with `openid.ns=http://specs.openid.net/auth/2.0`,
     `openid.mode=checkid_setup`, `openid.claimed_id`/`openid.identity` =
     `http://specs.openid.net/auth/2.0/identifier_select`, `openid.realm=STEAM_OPENID_REALM`,
     `openid.return_to=STEAM_OPENID_RETURN_URL?state=<state>`.
2. Steam → browser → `GET /api/v1/auth/steam/callback?state=…&openid.*`.
   The API verifies **all** of the following, failing closed:
   - `rage_oidc` cookie present, signature valid, not expired, `state` equals query `state`
     (constant-time) → else `state_mismatch` (login CSRF protection).
   - `openid.mode == id_res` (`cancel` → `cancelled`), `openid.ns` is OpenID 2.0.
   - `openid.op_endpoint == https://steamcommunity.com/openid/login`.
   - `openid.return_to` equals `STEAM_OPENID_RETURN_URL?state=<state>` exactly.
   - `openid.claimed_id == openid.identity` and matches
     `^https?://steamcommunity\.com/openid/id/(\d{17})$`.
   - `openid.signed` includes at least `op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle`.
   - `openid.response_nonce` timestamp within ±5 min of now (else `replay`); nonce unused — stored in Redis
     `SET rage:oidc:nonce:<sha256(op_endpoint|nonce)> 1 NX EX 900`; replay → `replay`;
     Redis unavailable → `provider_unavailable` (fail closed).
   - Server-side `check_authentication`: POST the received `openid.*` params with
     `openid.mode=check_authentication` to the OP endpoint (HTTPS, 5 s timeout, no redirects
     followed); require response line `is_valid:true` → else `invalid_assertion`
     (network/5xx → `provider_unavailable`).
   - SteamID64 is individual and not sample → else `unsupported_account`.
   - Implementation specifics: the query is parsed from the raw URL; duplicated `openid.*`
     (⇒ `invalid_assertion`) or `state` (⇒ `state_mismatch`) parameters, values > 2048 chars
     or > 40 `openid.*` params are rejected (parameter pollution). Every field listed in
     `openid.signed` must be present. The nonce is claimed **before** `check_authentication`
     (atomic `SET NX`), so concurrent replays of one assertion cannot both proceed. The reply is
     parsed as key-value form: duplicate keys or anything but `is_valid:true` ⇒
     `invalid_assertion`; HTTP 4xx ⇒ `invalid_assertion`; network/timeout/5xx ⇒
     `provider_unavailable`; body capped at 16 KiB. The transport refuses any endpoint other
     than `https://steamcommunity.com/openid/login`.
3. In **one transaction**: upsert `users` by `steam_id64` (create with `status=ACTIVE`),
   create `player_profiles` on first login (nickname = Steam display name if available and
   valid, else `player-<last 6 digits>`; slug unique, lowercase, never UUID-shaped), update
   `last_login_at`, insert `auth_sessions`, apply bootstrap grant (§7), write audit
   `auth.login` (detail: session id, new_user flag — never tokens).
   - `status != ACTIVE` → no session, `account_suspended`.
   - Concurrency: concurrent first logins race on `users_steam_id64_key` /
     `player_profiles_slug_key` / `user_role_grants_active_uniq`; the losing transaction is
     retried (max 4) and reuses the winner's rows ⇒ exactly one user per SteamID64.
   - Slugs: `player-<last6>`, then `player-<last10>`, `player-<steamid64>`, then
     `player-<last6>-<8 hex>`; the generated nickname is `player-<last6>`. When the Steam Web
     API sync (step 5) runs for a **new** user and the display name passes the nickname rule,
     it replaces the generated nickname (slug unchanged).
   - Re-login rotation: a `rage_session` the browser already held is revoked on successful login.
4. Response: clear `rage_oidc`; set `rage_session` + `rage_csrf` (§4); 302 →
   `WEB_PUBLIC_URL + returnTo`. Failures: 302 → `WEB_PUBLIC_URL/login?error=<code>`, codes:
   `state_mismatch | cancelled | invalid_assertion | replay | unsupported_account |
   account_suspended | provider_unavailable | not_configured`.
5. Optional (key configured): fetch `GetPlayerSummaries` after commit (best effort, 5 s);
   store display name and avatar only if avatar URL is https on an allowlisted Steam CDN host
   (`avatars.steamstatic.com`, `avatars.akamai.steamstatic.com`, `avatars.cloudflare.steamstatic.com`)
   and profile URL is https `steamcommunity.com`. Never used for authorization.

## 4. Sessions & cookies (ADR-014)
- `rage_session`: 32 random bytes (base64url); DB stores **SHA-256 hash only**
  (`auth_sessions.token_hash`). httpOnly, SameSite=Lax, Path=`/`, Secure per config,
  Max-Age = TTL. A new session is created on every login (no fixation: no pre-auth session).
- Validation per request: hash lookup, `revoked_at IS NULL`, `expires_at > now`,
  idle `last_seen_at` within `SESSION_IDLE_HOURS`, user `status = ACTIVE`.
  `last_seen_at` is updated at most once per 5 minutes. Authenticated responses carry
  `Cache-Control: no-store`.
- Logout revokes the session row and clears cookies. Suspending a user revokes all sessions.
- Cookie names stay `rage_session` / `rage_csrf` in M1; the `__Host-` prefix is deferred to the
  same-origin production deployment (M7). `rage_csrf` stays JS-readable.
- Cookies are host-scoped (not port-scoped): in dev the web SSR on `localhost:3000` receives
  `rage_session` set by `localhost:4000`. Production must serve web and API on the same site
  (recommended: same origin, reverse proxy `/api/v1`).

## 5. CSRF (ADR-014)
- `rage_csrf`: readable by JS (not httpOnly), SameSite=Lax, Path=`/`; value =
  `base64url(HMAC(SESSION_SECRET, session_id))` — bound to the session, rotates with it.
- Every unsafe method (POST/PUT/PATCH/DELETE) on a cookie-authenticated route requires header
  `x-csrf-token` equal (constant-time) to the expected value **and** an `Origin` (or, if
  absent, `Referer`) whose origin is in `API_CORS_ORIGINS`. Failures → 403
  `{ message: "CSRF validation failed" }`.
- `GET /api/v1/auth/csrf` → `{ csrfToken }` (requires session) for clients that cannot read the cookie.
- HMACs carry purpose labels (`rage:oidc-state:v1`, `rage:csrf:v1`), so a state signature can
  never be replayed as a CSRF token. `CsrfGuard` is attached to every authenticated route (no-op
  on safe methods); a unit test fails if any unsafe handler lacks `SessionGuard → CsrfGuard`.
- `POST /auth/logout` without a valid session skips CSRF (nothing to protect) and only clears
  cookies (204); with a valid session it requires CSRF.

- CORS: preflights from `API_CORS_ORIGINS` allow credentials, methods incl. POST/PATCH and
  headers `content-type`, `x-csrf-token`, `x-request-id`, `idempotency-key` (integration-tested
  for `PATCH /me/profile`). SSR headers are server-to-server only and not CORS-allowed.

## 6. Authorization (RBAC)
- Roles come from active `user_role_grants` (`revoked_at IS NULL`): `SUPER_ADMIN`,
  `TOURNAMENT_ADMIN`, `MATCH_ADMIN`, `OBSERVER` (GLOBAL scope in M1), `TEAM_MANAGER`
  (TEAM scope, used from M2 — ADR-018/Q4).
- Guards: `SessionGuard` (401 when missing/invalid), `RolesGuard` via `@Roles(...)` (403),
  `CsrfGuard` on unsafe methods. Unknown/forbidden objects the caller may not know about → 404.
- Admin permissions never derive from Steam display names or any client input.
- Grantable scopes (M1): `SUPER_ADMIN`: GLOBAL; `TOURNAMENT_ADMIN`/`MATCH_ADMIN`:
  GLOBAL|TOURNAMENT; `OBSERVER`: GLOBAL|TOURNAMENT|MATCH; `TEAM_MANAGER`: TEAM. Scoped grants
  require an existing team/tournament/match (404); sample users cannot receive roles (409).
  `RolesGuard` checks active GLOBAL grants only in M1.
- Revoke locks all active SUPER_ADMIN grants (`SELECT … FOR UPDATE`): the actor must still be
  SUPER_ADMIN (else 403), may not revoke their own SUPER_ADMIN grant (409), and the last active
  SUPER_ADMIN grant can never be revoked (409).

## 7. Bootstrap super admin (ADR-017)
If `BOOTSTRAP_SUPER_ADMIN_STEAM_ID64` is set (individual SteamID64), the **verified** login of
exactly that SteamID grants `SUPER_ADMIN` (GLOBAL, `issued_by NULL`, reason
`bootstrap:env`) inside the login transaction, idempotently (partial unique index), and audits
`role_grant.bootstrap`. Removing the env var does not revoke the grant (revoke via admin API).
The bootstrap is **one-shot per user**: if the user has ever held a global SUPER_ADMIN grant
(active or revoked), nothing is issued — a revocation sticks even while the env var is still
set (M1 security gate M-1).

## 8. SSR calls from the web server (QA-M0-P2-1)
The web server sends `x-rage-ssr-token: INTERNAL_SSR_TOKEN` and `x-rage-client-ip: <visitor IP>`
on server-side API calls, and forwards the visitor's `Cookie` header only for `/me` and admin
reads. With a valid token (constant-time compare), the API throttles by the forwarded client IP
(falls back to bucket `ssr`) instead of the web server's IP. Without/with an invalid token the
headers are ignored. The token is never exposed to browsers. IPv6 addresses are bucketed per
/64; IPv4-mapped IPv6 is unwrapped; an invalid forwarded IP falls back to the `ssr` bucket.

**Choosing the visitor IP on the web side (M1 security gate M-2).** `X-Forwarded-For` /
`X-Real-IP` are client-controlled unless a trusted proxy wrote them. The web server trusts
exactly `WEB_TRUST_PROXY_HOPS` proxies (default `0`): with N ≥ 1 it takes the N-th entry from
the **right** of `X-Forwarded-For` (falling back to `X-Real-IP` only when XFF is absent); with
`0` it sends no `x-rage-client-ip` at all and SSR traffic shares the `ssr` bucket. Set it to the
real number of appending proxies in production (RUNBOOK); a value that is too high re-opens
bucket spoofing. Throttler storage is still per-process memory until M7 (Redis).

## 9. Endpoints (all under `/api/v1`)
| Method & path | Auth | Notes |
|---|---|---|
| `GET /auth/steam?returnTo=` | public | 302 to Steam; 503 if unconfigured; strict throttle |
| `GET /auth/steam/callback` | public | 302 to web (success or `/login?error=`); strict throttle |
| `POST /auth/logout` | session + CSRF | 204; idempotent |
| `GET /auth/csrf` | session | `{ csrfToken }` |
| `GET /me` | session | `MeDto` (below); 401 otherwise |
| `PATCH /me/profile` | session + CSRF | `{ nickname?, countryCode?, biography? }` → `MeDto`; audited |
| `GET /admin/users?q&page&pageSize` | SUPER_ADMIN | paginated `AdminUserDto` |
| `POST /admin/users/:id/roles` | SUPER_ADMIN + CSRF | `{ role, scopeType, scopeId?, reason }` → 201 `RoleGrantDto`; 409 if active duplicate; audited |
| `POST /admin/users/:id/roles/:grantId/revoke` | SUPER_ADMIN + CSRF | `{ reason }` → `RoleGrantDto`; cannot revoke own last SUPER_ADMIN grant (409); audited |
| `GET /admin/audit?page&pageSize&action&actorUserId` | SUPER_ADMIN | paginated `AuditLogDto` (newest first) |

DTO shapes:
- `MeDto`: `{ user: { id, steamId64, status, createdAt, lastLoginAt }, profile: { slug, nickname, countryCode|null, biography|null }, steamProfile: { displayName|null, avatarUrl|null, profileUrl|null } | null, roles: Array<{ id, role, scopeType, scopeId|null, issuedAt }> }`
- `AdminUserDto`: `{ id, steamId64, status, isSample, nickname|null, slug|null, createdAt, lastLoginAt|null, roles: RoleGrantDto[] }`
  — `roles` lists **all** grants (active and revoked, `revokedAt` set), newest first; `isSample`
  added; nickname/slug nullable for users without a profile. `MeDto.roles` lists **active**
  grants only.
- `GET /admin/users?q=`: case-insensitive nickname substring (LIKE wildcards escaped) OR, when
  `q` is 17 digits, exact SteamID64.
- `RoleGrantDto`: `{ id, role, scopeType, scopeId|null, issuedAt, issuedById|null, reason|null, revokedAt|null }`
- `AuditLogDto`: `{ id, action, resourceType, resourceId|null, actorUserId|null, requestId|null, detail: object, createdAt }`
- Validation: nickname 2–32 chars `^[\p{L}\p{N}_.\- ]+$`u, trimmed, no leading/trailing space;
  countryCode ISO-3166 alpha-2 uppercase or null; biography ≤ 500 chars; reason 3–500 chars.

## 9a. Error codes
`ApiErrorDto` has an optional, additive `code` (clients branch on it, never on `message`):
`UNAUTHENTICATED` (401, any missing/invalid session), `CSRF_FAILED` (403), `FORBIDDEN_ROLE`
(403, missing role), `ROLE_ALREADY_GRANTED` (409), `LAST_SUPER_ADMIN` (409, revoking own or the
last SUPER_ADMIN grant), `VALIDATION_FAILED` (400 with `details`), `RATE_LIMITED` (429). Other
errors may omit `code`; 5xx never carry one. New codes may be added within v1.

## 10. Audit actions (M1)
`auth.login`, `auth.logout`, `auth.login_rejected` (code plus the verified SteamID; written
only for rejections AFTER Steam `check_authentication`, i.e. `unsupported_account` /
`account_suspended` — earlier anonymous failures such as `state_mismatch` are logged, not
audited, so they cannot flood the append-only table; M1 security gate L-3), `profile.update`, `role_grant.create`, `role_grant.revoke`, `role_grant.bootstrap`.
`request_id` is the **server-generated** id (client `x-request-id` is stored only as
`detail.clientRequestId` if present). The server id is also logged as `serverRequestId`.
Rejected logins are audited with `actor_user_id NULL` and `resource_type = 'auth'`.

## 11. Database roles (ADR-016)
Migrations and seeds run as the owner role (`rage`). The application connects as
`rage_app` (LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE): SELECT/INSERT/UPDATE/DELETE on
application tables, USAGE/SELECT on sequences, and **no** UPDATE/DELETE/TRUNCATE on
`audit_logs` and `match_events` (INSERT/SELECT only). Created/updated idempotently by
`pnpm --filter @rage/db db:grants` (run as owner after `migrate deploy`), password from
`RAGE_APP_DB_PASSWORD`. App `DATABASE_URL` uses `rage_app`; `MIGRATION_DATABASE_URL` (owner)
is used by Prisma CLI/seeds.

## 12. Local Steam login setup
API env (repository `.env`) for plain `http://localhost`:

```
WEB_PUBLIC_URL=http://localhost:3000
API_CORS_ORIGINS=http://localhost:3000
STEAM_OPENID_REALM=http://localhost:4000
STEAM_OPENID_RETURN_URL=http://localhost:4000/api/v1/auth/steam/callback
SESSION_SECRET=<generated>
INTERNAL_SSR_TOKEN=<generated; same value for api and web>
# optional
BOOTSTRAP_SUPER_ADMIN_STEAM_ID64=<your SteamID64>
STEAM_WEB_API_KEY=<from https://steamcommunity.com/dev/apikey>
```

Generate each secret with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
Start the API, check `GET http://localhost:4000/api/v1/meta` → `steamAuth.status: configured`,
then open `http://localhost:4000/api/v1/auth/steam?returnTo=/me` in a browser. Only outbound
HTTPS from the API to `steamcommunity.com` is needed; Steam never calls the API. If Steam refuses
the localhost realm, use an HTTPS tunnel host for realm/return URL (serve the web app on the
same site). Cookies are host-scoped, so SSR on `localhost:3000` receives `rage_session` set by
`localhost:4000`.

## 13. Manual verification still required (cannot be automated here)
One real Steam login through `steamcommunity.com` with a real account, confirming Steam accepts
the configured realm (localhost or tunnel), creating exactly one user; repeat login reuses it.
Record date and redacted SteamID in `docs/PROGRESS.md`.
