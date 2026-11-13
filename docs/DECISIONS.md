# Architecture decision log

- ADR-001: Player identity via Steam OpenID and immutable SteamID64; no local password for players.
- ADR-002: Team creation is an admin-reviewed application, never direct self-service provisioning.
- ADR-003: Team roster mutable; tournament rosters copied into immutable versioned snapshots.
- ADR-004: RAGE Match Manager owns official game state; MatchZy and CS2 plugins are adapters, not authoritative tournament databases.
- ADR-005: HLTV and FACEIT are inspiration for UX/information architecture only; original visuals and ranking algorithms.
- ADR-006: Agent-originated outbound connection supports both local and remote game servers without public RCON exposure.

Add new ADRs with date, context, considered alternatives, decision, tradeoffs and validation.

---

## ADR-007: Toolchain and versions
- **Date:** 2026-11-11 · **Status:** Accepted
- **Context:** MASTER_PROMPT requires verified, stable, compatible versions pinned via lockfile. Versions were checked on the npm registry on 2026-11-11.
- **Alternatives:** npm/yarn workspaces; Nx instead of Turborepo; TypeScript 7.0 (native Go port); Next.js Pages Router; Jest.
- **Decision:** pnpm 11.1.3 workspaces + Turborepo 2.11; Node ≥22.12 (dev on 24.15, `.nvmrc`); **TypeScript 6.0.3** (`~6.0.3`); NestJS 12.3.x (ESM-only packages); Prisma 7.10.1 with `@prisma/adapter-pg`; Next.js 16.4.x App Router, React 19.3, Tailwind 4.3, next-intl 4.14; Vitest 5.1; Playwright 1.64; ESLint 10 flat config.
- **Tradeoffs:** TS 7 rejected because typescript-eslint 8.72 peer range is `<6.1.0` and @nestjs/swagger 12 peer is `^5.5 || ^6`; we forgo TS 7 compile speed. Nest 12 ESM forces ESM for the API (ADR-010). Very recent majors carry ecosystem-lag risk.
- **Validation:** `pnpm install --frozen-lockfile`, typecheck, lint, test, build pass in CI on a clean checkout; re-check peer ranges before any major bump.

## ADR-008: Supply-chain policy for dependencies
- **Date:** 2026-11-11 · **Status:** Accepted
- **Context:** Install scripts and freshly published malicious versions are the main npm supply-chain vectors.
- **Alternatives:** allow all build scripts; `--ignore-scripts` globally; Renovate-only gating without registry age.
- **Decision:** `pnpm-workspace.yaml` sets `minimumReleaseAge: 10080` (7 days) and an explicit `allowBuilds` allowlist. Approved: `prisma`, `@prisma/engines`, `esbuild`, `@swc/core`, `@embedded-postgres/*` platform binaries, `sharp`, `unrs-resolver`. Denied: `@scarf/scarf` (install-time telemetry via swagger-ui-dist), `@parcel/watcher` (prebuilt binaries suffice). Lockfile committed; CI uses `--frozen-lockfile`.
- **Tradeoffs:** urgent security patches wait 7 days unless explicitly overridden (requires a new ADR note); new native deps need an allowlist edit and review.
- **Validation:** CI install succeeds with frozen lockfile; reviewers reject PRs adding `allowBuilds` entries without justification.

## ADR-009: Local services without Docker (fallback)
- **Date:** 2026-11-11 · **Status:** Accepted
- **Context:** Some dev machines (Windows without virtualization) cannot run Docker; integration tests must still hit real PostgreSQL/Redis.
- **Alternatives:** SQLite for tests; pg-mem/mocks; require Docker everywhere; cloud dev databases.
- **Decision:** Docker Compose is the primary path. Fallback `tools/local-services/start.mjs` runs real PostgreSQL 18.6 from `embedded-postgres` binaries plus real Redis via native/WSL `redis-server`, bound to 127.0.0.1. Dev/test only. Integration tests always run against real PostgreSQL — never SQLite or mocks for DB constraints (partial unique indexes, locking, transactions).
- **Tradeoffs:** two local paths to maintain; embedded-postgres version may lag Compose image; Redis on Windows depends on WSL/native build.
- **Validation:** both paths documented in RUNBOOK; integration suite passes on Compose (CI) and on the fallback on at least one Windows dev machine.
  - 2026-11-11: fallback verified on Windows 11 (PostgreSQL 18.6 embedded + Redis via WSL); `packages/db` migrations/seeds first applied there.
  - 2026-11-11: Docker Desktop installed; Compose path verified (postgres:18.6-trixie + redis:8.10.3-alpine healthy, `rage`/`rage_test` created by init script). `packages/db` (28) and `apps/api` (28) integration suites pass against Compose. Compose is now the default local path.

## ADR-010: API module system and HTTP contract
- **Date:** 2026-11-11 · **Status:** Accepted
- **Context:** Nest 12 ships ESM-only packages; web and API must share a typed contract without hand-maintained duplicates.
- **Alternatives:** CommonJS API with interop shims; tRPC/ts-rest shared contract; hand-written client; zod-first contract generating OpenAPI.
- **Decision:** API is ESM (`"type":"module"`, `module/moduleResolution: nodenext`). OpenAPI generated from Nest decorators is the single source of truth for HTTP. `packages/api-client` is generated with `openapi-typescript` + `openapi-fetch`; CI fails on contract drift. Web never calls `fetch` from pages directly — only via `apps/web/src/lib/api`. Conventions in `docs/API_CONVENTIONS.md`.
- **Tradeoffs:** decorators must be complete or types degrade; generation step in build graph; ESM requires `.js` import suffixes.
- **Validation:** `pnpm openapi:generate` then `git diff --exit-code packages/api-client` in CI; lint rule/grep forbidding raw `fetch(` in `apps/web/src/app/**`.

## ADR-011: Sample data marking
- **Date:** 2026-11-11 · **Status:** Accepted
- **Context:** Non-negotiable rule: no fake production statistics; sample UI/seed data must be clearly marked and must never collide with real Steam identities.
- **Alternatives:** separate sample database; prefix names only; no seed data.
- **Decision:** `is_sample boolean NOT NULL DEFAULT false` on users, teams, tournaments, matches. Sample seed refuses `NODE_ENV=production`. Sample SteamID64 values are in `76561190000000001–76561190000000999`, below the individual-account base `76561197960265728`, so they cannot be a real individual Steam account. M1 auth must reject them. UI shows a "Sample data" badge. No statistics are seeded.
- **Tradeoffs:** extra column and filter on public queries; samples cannot exercise stats UIs (empty states instead).
- **Validation:** seed test asserts refusal under production; M1 test asserts sample-range SteamID rejected; UI test asserts badge rendered for `isSample`.

## ADR-012: i18n without locale URL prefixes
- **Date:** 2026-11-11 · **Status:** Accepted
- **Context:** MASTER_PROMPT fixes exact route paths (`/teams/[slug]`, …) and requires en/ru/kk readiness.
- **Alternatives:** `/[locale]/…` prefixes (next-intl default); subdomains per locale.
- **Decision:** next-intl without locale prefixes; locale from cookie `NEXT_LOCALE`, then `Accept-Language`, default `en`. Locales: `en`, `ru`, `kk`.
- **Tradeoffs:** no per-locale URLs for SEO (`hreflang` alternates impossible without prefixes); CDN caching must vary on cookie/Accept-Language or bypass for HTML.
- **Validation:** route paths match MASTER_PROMPT exactly; switching locale changes UI text without URL change; missing-key check in CI for all three catalogs.

## ADR-013: Object storage implementation
- **Date:** 2026-11-11 · **Status:** Accepted (dev/CI); production backend to be re-evaluated at M7
- **Context:** Demos and logos need S3-compatible storage (ARCHITECTURE: demo bytes never in DB). MinIO's community edition changed distribution in 2025 (reports: community Docker images/binaries no longer published, repository later in maintenance mode — verify against MinIO's GitHub/Docker Hub before deciding).
- **Candidates:** MinIO (pinned last community image or source build); SeaweedFS (Apache-2.0, S3 gateway); Garage (AGPL-3.0, single binary, `dxflrs/garage` image); RustFS; managed S3 (AWS S3, Cloudflare R2, Backblaze B2) for production with a local emulator for dev.
- **Criteria:** license compatibility; maintained, published, versioned images; S3 API coverage we need (presigned PUT/GET, multipart upload, bucket policy, lifecycle); single-node dev footprint; Windows/no-Docker fallback; backup/restore story; production parity.
- **Evaluation (devops, 2026-11-11):** MinIO rejected — the `minio/minio` GitHub repository is archived and Docker Hub no longer serves `minio/minio` ("object not found"); also AGPL-3.0. Garage rejected for dev (AGPL-3.0; keys must be provisioned via its CLI). RustFS (Apache-2.0) deferred — 1.0 line very new. SeaweedFS chosen: Apache-2.0, actively released (4.49→4.53 between 2026-10-23 and 2026-11-08), single-process `weed mini`, S3 credentials from `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, `/healthz`, multi-arch images.
- **Decision:** Local/CI object storage is **SeaweedFS `chrislusf/seaweedfs:4.52`** (`weed mini`), compose profile `storage`, S3 API published on `127.0.0.1:9000`, bucket created idempotently by an `amazon/aws-cli` one-shot job using plain S3 calls. Application code must use only the AWS SDK v3 S3 API with `S3_ENDPOINT`/`S3_FORCE_PATH_STYLE` so the backend stays swappable (managed S3/R2/B2 are candidates for production at M7).
- **Tradeoffs:** SeaweedFS S3 coverage of presigned multipart + lifecycle must be confirmed when demo upload lands (M5); swap is configuration-only.
- **Validation:** 2026-11-11 on Docker Desktop: `s3` healthy; `s3-init` created `rage-local` (re-run → "already exists"); put/get/delete round-trip OK; anonymous GET → 403. To add at M5: CI smoke test (bucket, presigned upload/download, sha256 match).

## ADR-014: Sessions, cookies and CSRF
- **Date:** 2026-11-12 · **Status:** Accepted (M1)
- **Context:** Players authenticate via Steam OpenID; the web (Next.js SSR) and API are separate processes; A1/A9 require replay-resistant sessions, revocation and CSRF protection.
- **Alternatives:** stateless JWT in cookie (no server-side revocation, rotation complexity); Next.js-managed session (auth logic split across apps); bearer tokens in localStorage (XSS-exfiltrable).
- **Decision:** opaque 32-byte session token in an httpOnly `rage_session` cookie; only its SHA-256 is stored in `auth_sessions`; absolute TTL 14 d, idle 72 h; new session per login; logout/suspension revoke rows. CSRF: session-bound HMAC token in readable `rage_csrf` cookie + required `x-csrf-token` header on unsafe methods + Origin/Referer allowlist; SameSite=Lax. Details: `docs/AUTH.md` §4–5.
- **Tradeoffs:** a DB lookup per authenticated request (indexed hash; `last_seen_at` write throttled to 5 min); web and API must be same-site in production.
- **Validation:** integration tests for expiry, idle timeout, revocation, CSRF missing/wrong/cross-origin, cookie flags.

## ADR-015: Steam OpenID 2.0 verification rules and replay store
- **Date:** 2026-11-12 · **Status:** Accepted (M1)
- **Context:** Steam is an OpenID 2.0 OP; trusting `claimed_id` without verification is a known account-takeover bug class.
- **Alternatives:** third-party passport-steam style libraries (unmaintained/unverified internals); stateful associations (Diffie-Hellman; unnecessary complexity).
- **Decision:** stateless verification via `check_authentication` plus the full rule list in `docs/AUTH.md` §3 (state cookie bound to the browser, exact `return_to`, op_endpoint, claimed_id == identity regex, signed-field coverage, nonce ±5 min + single use). Nonces stored in Redis (`SET NX EX 900`, AOF enabled in compose); Redis unavailable ⇒ fail closed. The OP HTTP transport is an injectable interface; a stub is allowed **only in tests**.
- **Tradeoffs:** login depends on Redis availability; one extra outbound HTTPS call per login.
- **Validation:** adversarial tests (forged/mismatched claimed_id, wrong return_to/op_endpoint, unsigned fields, stale/replayed nonce, is_valid:false, OP timeout, state mismatch, sample/non-individual IDs) + one manual real Steam login (A1).

## ADR-016: Separate database owner and application roles
- **Date:** 2026-11-12 · **Status:** Accepted (M1) — closes SEC-M0-M4
- **Context:** In M0 the API connected as a superuser, so append-only triggers and audit integrity could be bypassed by any application-level compromise.
- **Decision:** owner `rage` runs migrations/seeds; API runs as `rage_app` (no superuser/createdb/createrole), DML on app tables, INSERT/SELECT only on `audit_logs` and `match_events`. Idempotent `db:grants` script (run as owner after `migrate deploy`) creates/updates the role and grants, including default privileges for future tables. `MIGRATION_DATABASE_URL` (owner) vs `DATABASE_URL` (app).
- **Tradeoffs:** one more secret (`RAGE_APP_DB_PASSWORD`) and a deploy step; every new append-only table must be added to the grants script.
- **Validation:** integration test connecting as `rage_app`: UPDATE/DELETE/TRUNCATE on `audit_logs` fail even with `rage.allow_append_only_maintenance='on'`; normal DML works; role is not superuser.

## ADR-017: Bootstrap super administrator via environment + verified login
- **Date:** 2026-11-12 · **Status:** Accepted (M1)
- **Context:** The first SUPER_ADMIN cannot be granted through the admin API. Seeding an admin row without a verified login would be a backdoor.
- **Alternatives:** CLI command granting to an existing user; first-user-is-admin (race-prone, unsafe).
- **Decision:** `BOOTSTRAP_SUPER_ADMIN_STEAM_ID64`: the verified Steam login of exactly that individual SteamID64 receives SUPER_ADMIN (GLOBAL, `issued_by NULL`, reason `bootstrap:env`) idempotently inside the login transaction, audited as `role_grant.bootstrap`. Further admins are granted via the audited admin API.
- **Tradeoffs:** whoever controls server env controls bootstrap (acceptable: they control the DB too); removing the env var does not revoke. **Amended after the M1 security gate (M-1):** bootstrap is one-shot per user — if the user has ever held a global SUPER_ADMIN grant (active or revoked) nothing is issued, so a revocation sticks while the env var is still set.
- **Validation:** tests: matching verified login gets the grant once; non-matching, sample and repeated logins do not duplicate; audit row present.

## ADR-018: Resolution of ROADMAP open questions Q1–Q5, Q8
- **Date:** 2026-11-12 · **Status:** Accepted (lead decision; revisit on product feedback)
- **Q1 `POST /teams`:** exists only for SUPER_ADMIN with mandatory reason, audited (administrative creation, e.g. migrations of legacy teams). Captains create teams only through approved applications (ADR-002). Implemented in M2.
- **Q2 player route id:** `/players/[slug]` with `player_profiles.slug`; SteamID lookup only via `GET /players?steamId=` (M2+).
- **Q3 slug vs UUID path segments:** accepted; slugs can never be UUID-shaped (slug pattern + generation rule).
- **Q4 team manager:** a `user_role_grants` row `TEAM_MANAGER` scoped `TEAM:<teamId>`, granted by captain/admin and audited; `team_staff` is public display only.
- **Q5 series vs map states:** `matches.status` keeps series-level states; map-level progress (`KNIFE`, `MAP_FINISHED`) lives in `match_maps.status`. The current `MatchStatus` enum still contains `KNIFE`/`MAP_FINISHED`; they will not be used for series and will be removed by an M3 migration together with the state machine.
- **Q8 MFA for privileged accounts:** Steam OpenID provides no MFA signal; WebAuthn step-up for SUPER_ADMIN actions is planned for M7. Until then, admin actions are audited and admin sessions follow the same TTLs.
