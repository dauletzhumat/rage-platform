# RAGE Platform — Operations Runbook

Status: **M0 (foundation)**. Local development and CI are covered and verified; the production
section is an **outline for M7**, not a hardened deployment guide.

---

## 1. Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 24 LTS (`.nvmrc` = `24`) | `engines.node >= 22.12` but CI and images use 24 |
| pnpm | 11.1.3 (pinned by `packageManager`) | via Corepack: `corepack enable` |
| Docker Desktop / Docker Engine + Compose v2 | Compose spec (no `version:` key) | Path A (primary). Verified with Engine 29.9.3, Compose v5.7.0 |
| Git Bash (Windows) | — | All `scripts/*.sh` are bash |
| PostgreSQL 18 client tools | optional | only for `scripts/db-*.sh --mode url` (Path B backups) |

**Windows / Git Bash: Docker CLI on PATH.** If `docker` is not found in Git Bash after installing
Docker Desktop, add it for the session (or in `~/.bashrc`):

```bash
export PATH="/c/Users/$USER/AppData/Local/Programs/DockerDesktop/resources/bin:$PATH"
# older installs: /c/Program Files/Docker/Docker/resources/bin
```

---

## 2. Local services

Pick **one** path — both bind the same ports (5432, 6379). Never run them at the same time.

### Path A — Docker Compose (primary, verified)

| Command | Starts |
| --- | --- |
| `docker compose up -d` | `postgres` (18.6) + `redis` (8.10.3) |
| `docker compose --profile storage up -d` | + `s3` (SeaweedFS S3 API on `127.0.0.1:9000`) + `s3-init` (creates bucket `rage-local`) |
| `docker compose --profile app up -d --build` | + `migrate` (one-shot `prisma migrate deploy`) → `api` (:4000) → `web` (:3000) |
| `docker compose --profile seed run --rm seed` | runs `pnpm --filter @rage/db seed` against the compose DB |
| `docker compose ps` / `docker compose logs -f api` | status / logs |
| `docker compose stop` | stop, keep data |
| `docker compose down` | remove containers, **keep** volumes |
| `docker compose down -v` | **DESTROYS** all local data (postgres, redis, s3 volumes) |

Facts:

- All published ports are bound to **127.0.0.1** only (`5432`, `6379`, `9000`, `4000`, `3000`).
  Host ports can be changed with `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`, `S3_HOST_PORT`,
  `API_HOST_PORT`, `WEB_HOST_PORT` in `.env`.
- Credentials come from `.env` interpolation with dev defaults matching `.env.example`
  (`rage` / `rage_dev_password`; DBs `rage` and `rage_test`). Optional overrides:
  `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_TEST_DB`.
- `rage_test` is created by `docker/postgres/init/01-create-test-db.sh` **only on first
  initialisation** of the `postgres-data` volume. On an existing volume create it manually:
  `docker compose exec postgres psql -U rage -d postgres -c 'CREATE DATABASE rage_test OWNER rage'`.
- Postgres 18 images keep data under `/var/lib/postgresql/18/docker`; the volume is mounted at
  `/var/lib/postgresql` (mounting `.../data` as on ≤17 does not work).
- Redis runs with AOF on and `maxmemory-policy noeviction` (required by BullMQ).
- Inside containers, the API uses `postgres:5432`, `redis:6379`, `http://s3:8333`; SSR in `web`
  uses `API_INTERNAL_URL=http://api:4000/api/v1`. Browser-facing `NEXT_PUBLIC_*` values are
  **baked at image build time** (build args) — rebuild `web` after changing them.
- The `api` image defaults to `NODE_ENV=production`, but the compose `api` service runs with
  `NODE_ENV=${API_CONTAINER_NODE_ENV:-development}` because the API's env validation rejects
  plain `http://` CORS origins in production mode (correct behaviour). Do not "fix" this by
  weakening the validation; production uses HTTPS origins.
- Image sizes (2026-11-11): `rage/api` ≈ 926 MB, `rage/web` ≈ 393 MB, `rage/api-tools`
  (migrate/seed, full dev deps) ≈ 2.7 GB. First build downloads all packages (slow network ⇒
  several minutes); later builds reuse the BuildKit pnpm-store cache.

**Verified on 2026-11-11** (Docker Engine 29.9.3, Compose v5.7.0, Windows 11): `postgres`/`redis`
healthy, `rage` + `rage_test` created; `--profile storage`: `s3` healthy, `s3-init` created
`rage-local` (re-run idempotent), S3 put/get/delete round-trip OK, anonymous access 403;
`--profile app`: all three images built, `migrate` exited 0, `api` healthy (`/health/live` 200,
`/health/ready` 200 with database+redis up, `/api/docs` 200, runs as uid 1000), `web` healthy
and server-rendered seeded teams fetched from `api` over the compose network.

### Path B — no Docker (`pnpm local:services`, dev-only fallback)

```bash
pnpm local:services            # embedded PostgreSQL 18 + Redis (native or WSL)
```

Runs a real PostgreSQL 18.6 from `embedded-postgres` (data in `.local/`) and `redis-server`
natively or through WSL. No object storage (only needed from M5). Development/test only —
never production. Details: `tools/local-services/README.md`.

### Object storage choice (S3-compatible, used from M5)

**SeaweedFS `weed mini`** (`chrislusf/seaweedfs:4.52`, Apache-2.0), profile `storage`.

- MinIO is no longer a viable default: the `minio/minio` GitHub repository is **archived** and the
  `minio/minio` Docker Hub repository no longer returns tags (checked 2026-11-11); the community
  edition was moved to source-only/maintenance in 2025 and is AGPL-3.0.
- SeaweedFS: actively released (4.53 on 2026-11-08; 4.52 pinned to respect the 7-day release-age
  policy), permissive Apache-2.0 license, single-process `mini` mode, static S3 credentials from
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, `/healthz` endpoint, multi-arch images.
- Alternatives considered: Garage (AGPL-3.0, keys must be generated/imported via its CLI — more
  bootstrap work), RustFS (Apache-2.0, MinIO-like, but its 1.0 line is very recent), Versity
  S3 Gateway, LocalStack (AWS emulator, heavier). The application uses only the plain S3 API
  (`S3_ENDPOINT`, `S3_FORCE_PATH_STYLE=true`), so the backend can be swapped; `s3-init` uses
  `aws-cli` and is backend-agnostic. Production will likely use a managed S3 service (M7).
- The SeaweedFS admin UI is not published (it binds to loopback inside the container without
  `WEED_ADMIN_PASSWORD`).

---

## 3. First-time setup

```bash
corepack enable
pnpm install                       # frozen by pnpm-lock.yaml
cp .env.example .env               # never commit .env
docker compose up -d               # Path A   (or: pnpm local:services in another terminal — Path B)
pnpm db:generate                   # Prisma client
pnpm db:migrate                    # prisma migrate deploy (committed migrations only)
pnpm db:seed                       # base seed
pnpm --filter @rage/db seed:sample # OPTIONAL sample data (clearly marked as sample, not real stats)
pnpm dev                           # api + web in watch mode
```

| URL | What |
| --- | --- |
| http://localhost:3000 | Web (Next.js) |
| http://localhost:4000/api/v1 | API base |
| http://localhost:4000/api/docs | Swagger UI (only when `API_DOCS_ENABLED=true`) |
| http://localhost:4000/api/v1/health/live | liveness |
| http://localhost:4000/api/v1/health/ready | readiness |

Schema changes during development: `pnpm db:migrate:dev` (creates a migration; dev DB only).
Never run `migrate dev`/`migrate reset` against shared or production databases.

---

## 4. Tests

```bash
pnpm format:check && pnpm lint && pnpm typecheck
pnpm test                          # unit
pnpm test:integration              # uses TEST_DATABASE_URL (rage_test) — wiped/migrated by tests
pnpm build
pnpm openapi:generate && git diff --exit-code packages/api-client   # OpenAPI client drift
pnpm --filter @rage/web exec playwright install chromium            # once
pnpm --filter @rage/web test:e2e                                    # Playwright (needs API running)
```

CI (`.github/workflows/ci.yml`) runs the same on `ubuntu-latest` with `postgres:18.6-trixie` and
`redis:8.10.3-alpine` service containers: install (frozen) → generate → create `rage_test` →
migrate fresh DB → seed + sample seed → format → lint → typecheck → unit → integration → build →
OpenAPI drift. A separate `e2e` job (currently `continue-on-error`) builds, starts the API and runs
Playwright, uploading the report as an artifact. Dependabot (`.github/dependabot.yml`) proposes
weekly npm / GitHub Actions / Docker updates with a 7-day cooldown.

---

## 5. Health and readiness semantics

- `GET /api/v1/health/live` — process is up and serving HTTP. No dependency checks. Used by the
  image `HEALTHCHECK` and should be used for restart decisions (a DB outage must not cause
  restart loops).
- `GET /api/v1/health/ready` — dependencies reachable (PostgreSQL, Redis). Returns non-2xx when any
  is down. Used by compose to gate `web` on `api`, and should gate load-balancer traffic.
- `web` image healthcheck: `GET /` answers with a non-5xx status.
- `postgres`: `pg_isready -h 127.0.0.1` (TCP, so it only passes after init scripts finished);
  `redis`: `redis-cli ping`; `s3`: `GET /healthz`.

---

## 6. Backup and restore

Scripts (bash; Git Bash works on Windows):

```bash
# Backup (read-only). Default: compose mode, DB "rage", output .local/backups/ (gitignored)
scripts/db-backup.sh
scripts/db-backup.sh --db rage --out-dir /secure/backups
scripts/db-backup.sh --mode url              # host pg_dump against $DATABASE_URL (PG 18 client / PG_BIN)

# Restore — DESTRUCTIVE for the target DB. No defaults for the dangerous parts.
scripts/db-restore.sh --file .local/backups/rage-<ts>.dump --target-db rage_restore_check \
  --create --i-understand-this-overwrites-data
```

- Format: `pg_dump --format=custom --no-owner --no-privileges` + `<file>.sha256`.
- `db-restore.sh` refuses unless `--target-db` **and** `--i-understand-this-overwrites-data` are
  given; refuses system DBs; refuses when `NODE_ENV`/`RAGE_ENV` is `production` (override
  `RAGE_ALLOW_PROD_RESTORE=yes` only during an approved incident); in `--mode url` refuses
  non-local hosts unless `--allow-remote-host`; verifies the checksum when present.
- `--create` drops and recreates the target DB (for rehearsals); without it the restore uses
  `--clean --if-exists` into the existing DB.
- Raw equivalents: `docker compose exec -T postgres pg_dump -U rage -d rage -Fc > rage.dump` and
  `docker compose exec -T postgres pg_restore -U rage -d <db> --no-owner --exit-on-error < rage.dump`.

### Restore rehearsal procedure (run at least monthly in prod, before risky migrations, and in M7)

1. `scripts/db-backup.sh` → note the dump path.
2. `scripts/db-restore.sh --file <dump> --target-db rage_restore_check --create --i-understand-this-overwrites-data`
3. Compare table count, `_prisma_migrations` rows and row counts of every public table between
   source and `rage_restore_check` (identical expected).
4. Optionally point a local API at the restored DB and hit `/api/v1/health/ready`.
5. `docker compose exec postgres psql -U rage -d postgres -c 'DROP DATABASE rage_restore_check WITH (FORCE)'`
6. Record date, dump size, duration and result.

Never rehearse into `rage_test` while tests may be running, and never into `rage`.

Last rehearsal: 2026-11-11 (compose, M0 schema + seed): 150 770-byte dump, checksum OK,
37 public tables restored, row counts of every public table identical to `rage`, scratch DB dropped.

---

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `port is already allocated` / `EADDRINUSE` on 5432/6379 | Another Postgres/Redis (Path B, native service, WSL redis) is running. Stop it, or set `POSTGRES_HOST_PORT` / `REDIS_HOST_PORT` and update `.env` URLs. `netstat -ano \| findstr :5432` (Windows) |
| Port 4000/3000 busy when using `--profile app` | stop `pnpm dev`, or set `API_HOST_PORT` / `WEB_HOST_PORT` |
| `rage_test` missing on Compose | init scripts only run on an empty volume — create it manually (§2) |
| Readiness shows Redis down on Path B | install `redis-server` in WSL (`sudo apt-get install -y redis-server`); check WSL localhost forwarding |
| `docker: command not found` in Git Bash | see the PATH note in §1 |
| `pnpm install` warns about ignored build scripts | builds are allow-listed in `pnpm-workspace.yaml` (`allowBuilds`); adding a package with install scripts requires an explicit, reviewed allowlist entry |
| `pnpm add` cannot find a just-published version | `minimumReleaseAge: 10080` (7 days) — intentional supply-chain delay; wait or pin an older version |
| Changing `NEXT_PUBLIC_*` has no effect in the `web` container | they are build-time: `docker compose --profile app build web` |
| Prisma: `DATABASE_URL` not found | `prisma.config.ts` loads the root `.env`; ensure it exists or export the variable |
| Line-ending errors in `docker/postgres/init/*.sh` | `.gitattributes` forces LF; re-checkout if a tool converted to CRLF |
| `next start` warns "does not work with output: standalone" | Harmless for local runs/e2e (it still serves the build). The Docker image runs the standalone server (`node apps/web/server.js`); to mirror it locally: `node apps/web/.next/standalone/apps/web/server.js` after copying `.next/static` + `public` as the Dockerfile does |
| `docker compose --profile app up` restarted `postgres` | Compose recreates a service when its resolved config changed (e.g. after a Docker restart or `.env` edit). Data lives in the `postgres-data` volume and survives; never add `-v` unless you intend to wipe it |
| Detail page for a missing slug returns HTTP 200 | Known M0 limitation: `(public)/loading.tsx` starts streaming, so Next 16 keeps 200 and injects `robots noindex` ("soft 404"). Real 404 status planned for M6 |

---

## 8. Production notes (OUTLINE — to be completed and verified in M7)

- **Host**: Ubuntu LTS, unattended security upgrades, SSH keys only, firewall (`ufw`) allowing
  only 22 (restricted), 80, 443.
- **Reverse proxy with TLS** (Caddy or nginx + Let's Encrypt) in front of `web` and `api`; HSTS;
  forward `X-Forwarded-*`; WebSocket upgrade for Socket.IO; request size limits.
- **Never expose PostgreSQL, Redis, object-storage admin, or RCON publicly.** Bind them to a
  private network / localhost; Redis with ACL password; Postgres with `scram-sha-256` and a
  least-privilege app role separate from the migration role.
- **Secrets** from a secret manager or root-only env files (never in images, git, or client
  bundles): `DATABASE_URL`, `SESSION_SECRET`, `STEAM_WEB_API_KEY`, S3 keys, agent signing keys.
  Disable `API_DOCS_ENABLED` or protect it.
- **Migrations**: one-shot `prisma migrate deploy` job before rolling out the API; back up first.
- **Game servers are separate** from the web/API host. Each CS2 server runs the RAGE **server
  agent** that connects **outbound** to the API (signed, short-lived channel); RCON secrets stay on
  the game host. LAN-hosted servers work behind NAT for the same reason.
- **Backups**: nightly `pg_dump` (plus WAL archiving / PITR when available), encrypted, off-host,
  retention policy, monthly restore rehearsal (§6). Object storage versioning/lifecycle for demos.
- **Monitoring**: liveness/readiness probes, structured JSON logs (pino) shipped centrally, API
  latency, error rate, queue depth, dropped events, command ack latency, agent heartbeats.
- **Resources (initial guess, to be load-tested)**: 2 vCPU / 4 GB for web+api+redis, Postgres on
  its own volume with ≥ 20 GB, object storage sized for demos (~100–300 MB per map demo).
- **Incident procedures**: agent loss/reconnect, DB restore, credential rotation — to be written in M7.

---

## 9. External manual setup required later

| Milestone | What | Notes |
| --- | --- | --- |
| M1 | Steam OpenID realm + return URL | `STEAM_OPENID_REALM` must exactly prefix `STEAM_OPENID_RETURN_URL`; for local testing `http://localhost:4000` works with Steam OpenID; production needs the public HTTPS origin |
| M1 | Steam Web API key (optional) | https://steamcommunity.com/dev/apikey — only for public profile name/avatar sync; server-side only (`STEAM_WEB_API_KEY`) |
| M1 | `SESSION_SECRET` | ≥ 32 random bytes, e.g. `openssl rand -base64 48` |
| M4 | CS2 dedicated server | SteamCMD app 730 dedicated server + Game Server Login Token, Metamod:Source, CounterStrikeSharp, MatchZy — versions verified for compatibility at M4 time; reachable test server required to verify the real handshake |
| M5 | Object storage | dev: `--profile storage`; prod: managed S3-compatible bucket + credentials |
