# Progress tracker

| Milestone | Status | Evidence | Blocker |
|---|---|---|---|
| M0 Architecture / repository scaffold | **Verified** (local + GitHub CI green; QA gate conditions closed) | See "M0 evidence"; CI run https://github.com/dauletzhumat/rage-platform/actions/runs/43248240833 | — |
| M1 Steam Login / player accounts | **Verified** (real Steam login 2026-11-13 + GitHub CI green) | See "M1 evidence"; PR https://github.com/dauletzhumat/rage-platform/pull/14; CI runs https://github.com/dauletzhumat/rage-platform/actions/runs/43476165887 and https://github.com/dauletzhumat/rage-platform/actions/runs/43477663040 | — |
| M2 Team applications / invitation roster | **Verified** (real two-account run 2026-11-14 + GitHub CI green) | See "M2 evidence"; contract `docs/TEAMS.md`, ADR-019; security + QA gates passed, findings fixed | — |
| M3 Tournament registration / brackets | Not started | | Depends on M2 |
| M4 Server Agent / match control | Not started | | Needs a CS2 dedicated server + MatchZy/CounterStrikeSharp compatibility check |
| M5 Live stats / match history | Not started | | Depends on M4 (real server events) |
| M6 Public HLTV-like pages / rankings | Not started | | |
| M7 CS2 E2E / hardening / deploy | Not started | | Production host, domain/TLS |

Update this table after every milestone. `Verified` requires actual test evidence.

---

## M2 evidence (2026-11-13 → 2026-11-14)

### Done
- Contract `docs/TEAMS.md` (+ §12 as-built notes, §13 hardening) and ADR-019 (roster cap 7, one
  active membership incl. substitutes, 7-day invitations with lazy expiry, captain transfer rules,
  SUPER_ADMIN override audited).
- DB migration `20261113000000_m2_teams`: `idempotency_keys`, pending-tag uniqueness, M2 role and
  tag CHECKs, roster-history index.
- API: applications (submit/withdraw/list) and admin approve/reject with row locks; invitations
  (invite/revoke/accept/decline, lazy expiry, cap 10, 24 h re-invite cooldown); remove/leave/
  captain transfer; public roster history; `/me` membership; generic `Idempotency-Key` layer;
  audit for every mutation. Security follow-up L-4 closed: the CSRF wiring test enumerates every
  controller in the app graph (meta-test proves it catches unguarded handlers).
- Web: `/teams/apply`, `/me/invitations`, `/teams/[slug]/manage`, `/admin/team-applications`,
  roster history on `/teams/[slug]`, membership card on `/me`; all error codes in en/ru/kk;
  generated client types.
- **Security gate** (0 Critical/High). Fixed: M-1 `POST /teams` removed (assigned a captain without
  consent; ADR-018 Q1 amended); L-1 lock order; L-2 invisible/filler characters in team names and
  nicknames; L-3 5 applications per 24 h; L-4 idempotency row purge; L-5 re-invite cooldown; L-6
  transfer only to ACTIVE users; I-1/I-2/I-5/I-8. Open: mixed-script look-alike names (tracked),
  I-3/I-4/I-6/I-7 accepted or tracked.
- **QA gate** PASS WITH CONDITIONS (no P0/P1). Fixed: P2-1 same-user double-accept race test; P3-1
  sample applications cannot be rejected and are flagged in the admin queue; P3-2/P3-3 doc drift;
  P3-5 extra races (invite cap, leave vs remove). Open: P3-4 e2e for roster history.
- Integration test runner switched to worker threads (`apps/api/vitest.integration.config.ts`):
  forked workers crashed intermittently on Windows with 0xC0000409 (runner process, not the API).

### Verified (commands actually run, 2026-11-14, after gate fixes)
- format ✓; lint 8/8; typecheck 8/8; unit db 32 + api 216 + web 224 + client 4; integration db 56 +
  api 118 (includes concurrent double approve ×5, last-slot accept, one user two teams, same-user
  double accept, accept vs revoke, transfer vs remove, leave vs remove, invite cap, same
  idempotency key ×5, manager-grant revoke vs invite); build 6/6.
- QA gate (pre-fix snapshot 44ae19b): integration ×2 without flakes, Postgres lock-wait log proved
  real contention (13 waits, 0 deadlocks), OpenAPI drift none, e2e live API 41 passed / 5 skipped,
  API down 37 / 9, i18n complete.

### Real two-account run (A3/A4 UI) — 2026-11-14
Performed by the owner with two real Steam accounts (A = bootstrap SUPER_ADMIN, B = second
account) on local api + web; checked afterwards in the DB, audit log and public API.
- Both accounts applied; both applications APPROVED → teams FURIAZ (captain B) and CASPIANZ
  (captain A). `team_application.submit` ×2, `approve` ×2, `team.create` ×2.
- A invited B; B was blocked by the one-active-membership rule (`ALREADY_IN_TEAM`) while sole
  captain of FURIAZ. **Found a gap:** a sole captain could neither leave nor transfer. Fixed
  (TEAMS.md §6.2a: sole captain leaving disbands the team, revokes its invitations, audits
  `team.disband`; archived team pages and history stay public, unlisted).
- After the fix B left FURIAZ (DISBANDED, `team.disband`), accepted the CASPIANZ invitation
  (ACCEPTED, `team_invitation.accept`, `team_membership.join`), A transferred captaincy to B
  (rows closed/opened with `captain_transfer`), and A was then removed (`removed`).
- Public roster history of CASPIANZ shows all 4 rows in order with enumerated reasons only.
- 9 idempotency keys COMPLETED, no IN_PROGRESS leftovers.
- Not exercised in the UI: reject with visible reason, decline, revoke, expiry (covered by
  integration tests).

### CI
- GitHub CI green on the M2 PR (commits `4788ecb`, `02b8701`; final commit re-checked before merge).

---

## M1 evidence (2026-11-12 → 2026-11-13)

### Done
- Steam OpenID 2.0 sign-in (`check_authentication` against the real Steam endpoint only, strict
  assertion rules, signed state cookie, single-use Redis nonce, fail-closed), opaque sessions
  (SHA-256 at rest, absolute + idle expiry, rotation on re-login), CSRF (HMAC token bound to the
  session + Origin/Referer allowlist), RBAC from `user_role_grants`, `/me` + profile editing,
  admin users/roles/audit API and UI, bootstrap SUPER_ADMIN (ADR-017), DB app role `rage_app`
  (ADR-016), nonce CSP on web, SSR token channel, 429 UI state. Contract: `docs/AUTH.md`.
- M0-carried prerequisites closed: SEC-M0-M3 (nonce CSP), M4 (least-privilege DB role), L6
  (strict prod env), L9 (SHA-pinned Actions), QA-M0-P2-1 (SSR rate-limit keying; Redis storage
  remains M7).
- **Security gate** (0 Critical/High). Fixed with regression tests:
  - M-1 revoked bootstrap SUPER_ADMIN re-granted on next login → bootstrap is one-shot per user;
  - M-2 SSR client IP taken from the client-controlled first XFF hop → `WEB_TRUST_PROXY_HOPS`
    (right-most trusted hop, default 0 = no forwarded IP);
  - L-1 `returnTo` dot segments / encoded separators rejected (API + web);
  - L-2 role grant re-checks the actor's SUPER_ADMIN under `FOR SHARE` (race test);
  - L-3 only post-`check_authentication` rejections are audited (no anonymous audit flooding);
  - L-5 nickname NFC, biography rejects control/bidi characters.
  Open (follow-up): L-4 enumerate all controllers in the CSRF wiring test (before M2 adds
  controllers); mixed-script nickname lookalikes; Info items (session row cleanup, digest-pinned
  images, `__Host-` cookies, nonce for prerendered global-error page).
- **QA gate** PASS WITH CONDITIONS (no P0–P2). P3 fixed: standard `Retry-After` on 429
  (P3-1), audit flooding (P3-2 = L-3), `REVOKE TEMPORARY` for the app role (P3-4), RUNBOOK
  `--no-deps` note (P3-6). Open P3: HSTS sent over local http (harmless), `next start` vs
  standalone warning.

### Verified (commands actually run)
- QA gate run (before gate fixes): format, lint 8/8, typecheck 8/8, unit 349, integration 116 ×2
  (no flakes), build 6/6, OpenAPI drift none (21 paths), `db:grants` idempotent, `rage_app`
  privilege checks via psql, e2e live API 38 passed / 5 skipped and API down 34 / 9 skipped,
  Docker app profile (api connects as `rage_app`, SSR token absent from image and bundle).
- Live probes: forged/garbled callbacks, host-suffix, op_endpoint, return_to, unsigned
  claimed_id, parameter pollution, replay, state swap → all rejected; one forged assertion sent
  to Steam → `invalid_assertion`, no session.
- After gate fixes (2026-11-13): format ✓; lint 8/8; typecheck 8/8; unit api 199 + web 144
  + db 32 + client 4; integration db 42 + api 76 (incl. M-1 revoke-sticks and L-2 grant/revoke
  race tests); build 6/6; e2e live API 38 passed / 5 skipped (opt-in session spec). Live: hostile
  `returnTo=/..//evil.com` signed as `/`; 429 carries `Retry-After: 60`; anonymous garbage
  callback → `state_mismatch` with 0 new audit rows.

### Real Steam login (A1/A2) — 2026-11-13
Performed by the owner against the real Steam OpenID endpoint (`http://localhost` realm, local
api + web, Docker Postgres/Redis). SteamID redacted: `7656119833337****`.
- Exactly **1** non-sample user created (status ACTIVE); the second sign-in reused it
  (`auth.login` ×2, `last_login_at` updated, no second user).
- Player profile auto-created (slug `player-<last6>`), then edited via `/me` (`profile.update`).
- Bootstrap: exactly one `SUPER_ADMIN/GLOBAL` grant (`reason=bootstrap:env`, `issued_by` NULL)
  and one `role_grant.bootstrap` audit row; `/admin/users` accessible.
- Sessions: 2 rows, logout revoked the first (`auth.logout`), 1 active; 0 `auth.login_rejected`;
  no API warnings/errors in the log.
- Steam display name/avatar not synced — expected, `STEAM_WEB_API_KEY` is not set (optional).

### CI
- GitHub CI: **green** on PR #14 (commits `8600b9a`, `ee68a5f`; both jobs incl. blocking e2e).

### Not run (optional)
- `auth-session.spec.ts` (opt-in, needs a real session cookie in `E2E_SESSION_COOKIE`) not run.

---

## M0 evidence (2026-11-11 → 2026-11-12)

Environment: Windows 11, Node 24.15.0, pnpm 11.1.3, Docker Desktop 29.9.3 / Compose v5.7.0,
PostgreSQL 18.6 + Redis 8.10.3 via Docker Compose.

### Done
- **Workspace:** pnpm 11 workspaces + Turborepo; TypeScript 6.0.3; ESLint 10 flat config; Prettier;
  supply-chain policy (7-day `minimumReleaseAge`, `allowBuilds` allowlist) — ADR-007, ADR-008.
- **Infrastructure:** `docker-compose.yml` (postgres, redis; `storage` profile SeaweedFS S3;
  `app` profile migrate/api/web; all ports on 127.0.0.1), Dockerfiles (non-root, standalone web),
  Docker-free fallback `tools/local-services` (ADR-009), backup/restore scripts, `docs/RUNBOOK.md`.
- **Database (`packages/db`):** Prisma 7.10.1 schema covering all of `docs/SCHEMA.md` (36 models);
  migrations `20261111000000_init` (+ raw SQL CHECKs, partial/expression unique indexes,
  append-only triggers on `audit_logs`/`match_events`) and `20261111020000_sample_steam_id_consistency`;
  base seed (no fake data) + dev-only sample seed (`is_sample`, reserved SteamID range, no statistics,
  refuses production and databases holding real users) — ADR-011.
- **API (`apps/api`):** NestJS 12 (ESM) with validated env, helmet/CSP, CORS allowlist, rate limiting,
  normalized error envelope + request ids, allowlisted request logging (no query strings/secrets),
  `/api/v1/health/live`, `/health/ready` (cached probes), `/meta` (Steam/CS2 honestly `not_implemented`),
  read-only public `players`/`teams`/`tournaments`/`matches` (+ detail) with visibility rules,
  Swagger at `/api/docs`. Conventions: `docs/API_CONVENTIONS.md`.
- **Typed client (`packages/api-client`):** generated from the API's OpenAPI document
  (`pnpm openapi:generate`); web resource types come from it (contract drift = compile error) — ADR-010.
- **Web (`apps/web`):** Next.js 16 + Tailwind 4 original RAGE design system, public/protected/admin
  layouts, all routes from MASTER_PROMPT, honest loading/empty/error/sign-in-required states,
  i18n en/ru/kk without URL prefixes (ADR-012), security headers.
- **CI:** `.github/workflows/ci.yml` (fresh migrate, seeds, format, lint, typecheck, unit, integration,
  build, OpenAPI drift; non-blocking Playwright job) + Dependabot.
- **Docs:** ROADMAP, API_CONVENTIONS, ADR-007…013, ARCHITECTURE additions, RUNBOOK, README.
- **Reviews:** security review (0 Critical/High; Medium M1/M2 + Low L1–L5, L7, L8 fixed with
  regression tests; M3/M4/L6/L9 scheduled as M1 prerequisites) and QA gate.

### Verified (commands actually run; final results)
| Check | Command | Result |
|---|---|---|
| Format | `pnpm format:check` | pass |
| Lint | `pnpm lint` | 8/8 tasks pass |
| Typecheck | `pnpm typecheck` | 8/8 tasks pass |
| Unit tests | `pnpm test` | db 16, api 46, web 51, api-client 4 — all pass |
| Integration (real Postgres + Redis) | `pnpm test:integration` | db 30/30 (fresh-DB migration, constraints incl. concurrent captain race, triggers, seeds), api 33/33 (visibility rules, errors, CORS, headers, rate limit, readiness down-paths, security regressions) |
| Build | `pnpm build` | 6/6 tasks; web 26 routes, standalone output |
| OpenAPI drift | `pnpm openapi:generate` + hash compare | no drift (QA) |
| Migrations | `pnpm --filter @rage/db migrate:deploy` / `migrate:status` | 2 migrations, "up to date" |
| Seeds | `seed`, `seed:sample` ×2 | idempotent; 12 sample users / 2 teams / 1 tournament / 1 match, all `is_sample`, 0 stats rows |
| E2E — API down | `pnpm --filter @rage/web test:e2e` | 28 passed, 5 skipped (live-data specs) |
| E2E — real API + sample data | `E2E_API_URL=http://127.0.0.1:4000/api/v1 pnpm --filter @rage/web test:e2e` | 32 passed, 1 skipped (API-down spec) |
| Docker infra | `docker compose up -d postgres redis` | healthy; `rage` + `rage_test` created |
| Docker storage | `docker compose --profile storage up -d` | S3 healthy, bucket bootstrap idempotent, anon GET 403 |
| Docker app | `docker compose --profile app build` + `up -d migrate api web` | migrate exit 0; api ready (db+redis up, uid 1000); web SSR shows sample teams |
| Backup/restore | `scripts/db-backup.sh` → `db-restore.sh` into scratch DB | identical row counts in all 37 tables; 7 safety refusals verified |
| GitHub CI (ubuntu-latest) | push `8a3079e` → workflow `CI` | **success**: job "Lint, typecheck, test, build" (fresh migrate, seeds, format, lint, typecheck, unit, integration, build, OpenAPI drift) and job "Web e2e (Playwright)" against a live API — run 43248240833 |
| Honesty | grep + DB checks | no fake Steam/CS2 code; `/meta` reports `not_implemented`; sample↔SteamID range enforced by DB CHECK |

### Blocked / not verified
- **A1/A2/A7 (real Steam / real CS2)** — out of M0 scope; not implemented and reported as such.
- A3–A6, A8 — no business flows yet (M2–M5); DB-level constraints exist and are tested.

### Known limitations / risks (tracked)
- Soft-404 on dynamic detail pages (HTTP 200 + robots noindex due to streaming) → M6.
- CSP `'unsafe-inline'`, superuser DB role, strict Steam env schema, SHA-pinned Actions,
  SSR rate-limit keying → **M1 prerequisites** (ROADMAP M1).
- One non-reproducible Windows vitest worker crash (0xC0000409) in `packages/db` integration
  (1 of ~10 runs; 0 recurrences in QA's 4 runs; not seen on Linux CI) — watch.
- `pg` deprecation warning ("client.query() while already executing") from Prisma's adapter in batch
  transactions — upstream; no functional impact observed.
- `rage/api-tools` (migrate/seed) image is 2.68 GB — slim later.

### Next
1. ✅ Remote `github.com/dauletzhumat/rage-platform` created; first CI run green; e2e job now blocking.
2. Decide open questions Q1–Q5 in `docs/ROADMAP.md` (e.g. `POST /teams` vs ADR-002, slug vs id) as ADRs.
3. Start **M1 — real Steam OpenID login** with the security prerequisites listed in ROADMAP M1
   (steam-auth + backend + database + frontend agents; security + qa gates). Needs a Steam account
   for the manual real-login verification.
