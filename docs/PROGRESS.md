# Progress tracker

| Milestone | Status | Evidence | Blocker |
|---|---|---|---|
| M0 Architecture / repository scaffold | **Verified** (local + GitHub CI green; QA gate conditions closed) | See "M0 evidence"; CI run https://github.com/dauletzhumat/rage-platform/actions/runs/43248240833 | — |
| M1 Steam Login / player accounts | Not started | Prerequisites listed in `docs/ROADMAP.md` (M1 → security prerequisites) | Real Steam login test needs a Steam account + reachable callback (see ROADMAP M1) |
| M2 Team applications / invitation roster | Not started | DB constraints already in place (23 constraint tests) | Depends on M1 |
| M3 Tournament registration / brackets | Not started | | Depends on M2 |
| M4 Server Agent / match control | Not started | | Needs a CS2 dedicated server + MatchZy/CounterStrikeSharp compatibility check |
| M5 Live stats / match history | Not started | | Depends on M4 (real server events) |
| M6 Public HLTV-like pages / rankings | Not started | | |
| M7 CS2 E2E / hardening / deploy | Not started | | Production host, domain/TLS |

Update this table after every milestone. `Verified` requires actual test evidence.

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
