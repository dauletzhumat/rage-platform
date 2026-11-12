# RAGE Platform

Counter-Strike 2 tournament platform: Steam-verified identity, admin-reviewed team creation,
locked tournament rosters, server-confirmed match results and truthful public statistics.

> **Status: milestone M0 (foundation).** Steam sign-in (M1) and CS2 server integration (M4+)
> are **not implemented yet** — the UI and `/api/v1/meta` say so explicitly. See
> [`docs/PROGRESS.md`](docs/PROGRESS.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Repository layout

| Path                            | What                                                                      |
| ------------------------------- | ------------------------------------------------------------------------- |
| `apps/api`                      | NestJS 12 REST API (`/api/v1`), OpenAPI at `/api/docs`                    |
| `apps/web`                      | Next.js 16 App Router web app (public, protected, admin shells; en/ru/kk) |
| `packages/db`                   | Prisma 7 schema, SQL migrations (constraints/triggers), seeds             |
| `packages/api-client`           | Typed API client generated from the API's OpenAPI document                |
| `tools/local-services`          | Docker-free fallback: real PostgreSQL (embedded binaries) + Redis         |
| `docker-compose.yml`, `docker/` | Local infrastructure and app images                                       |
| `docs/`                         | Spec, architecture, ADRs, API conventions, roadmap, runbook, progress     |
| `.claude/agents/`               | Specialist Claude Code agent definitions                                  |

## Quick start

Full instructions: [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

```sh
corepack enable
pnpm install
cp .env.example .env

# Infrastructure — EITHER Docker:
docker compose up -d postgres redis
# OR, without Docker (dev only; keep running in its own terminal):
pnpm local:services

pnpm db:generate
pnpm db:migrate
pnpm db:seed                               # production-safe reference data
pnpm --filter @rage/db seed:sample         # optional, dev-only data labelled "Sample"
pnpm build
pnpm dev                                   # web :3000, api :4000 (Swagger /api/docs)
```

## Checks

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
pnpm test:integration    # needs PostgreSQL (TEST_DATABASE_URL) + Redis running
pnpm build
pnpm openapi:generate    # regenerate the typed client after API changes
```

## Ground rules

Read [`CLAUDE.md`](CLAUDE.md) first. Never commit `.env`, RCON passwords, Steam keys or other
secrets. Sample data is always flagged `isSample` and uses SteamID64 values that can never belong
to a real Steam account (ADR-011). No statistics are fabricated.
