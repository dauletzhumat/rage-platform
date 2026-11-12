# @rage/local-services — Docker-free dev fallback

`start.mjs` runs **real** PostgreSQL and Redis servers for machines where Docker is not
available. It is a fallback for local development and testing only — **never use it in
production**. The primary local setup is Docker Compose (see `docs/RUNBOOK.md`, Path A).

## What it starts

| Service    | How                                                                                                                                         | Address          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| PostgreSQL | [`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres) (zonky PostgreSQL 18 binaries), cluster in `.local/postgres-<port>/` | `127.0.0.1:5432` |
| Redis      | native `redis-server` on `PATH`, otherwise `wsl -e redis-server` on Windows; skipped if neither exists                                      | `127.0.0.1:6379` |

- Role/password and databases match `.env.example`: user `rage`, password
  `rage_dev_password`, databases `rage` and `rage_test` (created if missing).
- Postgres listens on `127.0.0.1` only and uses `scram-sha-256` auth.
- Redis runs without persistence (`--save ""`, `--appendonly no`), bound to `127.0.0.1`,
  protected mode on.
- If port 6379 is already open, the script assumes an existing Redis and does not start
  another one. If port 5432 is already open it **fails** (stop the other Postgres or set
  `LOCAL_PG_PORT`).
- Object storage (S3) is **not** provided here; it is only needed from M5. Use
  `docker compose --profile storage up -d` or any S3-compatible endpoint.

## Usage

```bash
pnpm local:services                 # from the repo root (postgres + redis)
node tools/local-services/start.mjs --no-redis
```

Leave it running in its own terminal; `Ctrl+C` stops both servers cleanly. Data persists
in `.local/` (gitignored). To reset, stop the process and delete `.local/postgres-5432/`.

### Environment overrides

| Variable             | Default             |
| -------------------- | ------------------- |
| `LOCAL_PG_PORT`      | `5432`              |
| `LOCAL_PG_USER`      | `rage`              |
| `LOCAL_PG_PASSWORD`  | `rage_dev_password` |
| `LOCAL_PG_DATABASES` | `rage,rage_test`    |
| `LOCAL_REDIS_PORT`   | `6379`              |

If you change these, update `DATABASE_URL`, `TEST_DATABASE_URL` and `REDIS_URL` in `.env`.

## Redis on Windows via WSL

```bash
wsl -e sh -c "sudo apt-get update && sudo apt-get install -y redis-server"
```

WSL2 forwards `localhost` ports to Windows by default, so `redis://127.0.0.1:6379` works
from Node on Windows. If it does not (custom `networkingMode`, firewall), the script logs
that Redis is unreachable and the API readiness check reports Redis as down.

## Notes

- `embedded-postgres` is a prerelease (`18.6.0-beta.19`) package pinned exactly; its
  platform binary packages are allow-listed in `pnpm-workspace.yaml` (`allowBuilds`).
- The embedded distribution ships the server only (no `psql`/`pg_dump`). For
  `scripts/db-backup.sh --mode url` install PostgreSQL 18 client tools or set `PG_BIN`.
