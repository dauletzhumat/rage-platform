#!/usr/bin/env bash
# RAGE Platform — PostgreSQL logical backup (pg_dump custom format).
#
# Usage:
#   scripts/db-backup.sh [--mode compose|url] [--db NAME] [--out-dir DIR]
#
# Modes:
#   compose (default)  pg_dump runs INSIDE the compose `postgres` container
#                      (`docker compose exec -T postgres pg_dump ...`); no local client needed.
#   url                pg_dump runs on this host against $DATABASE_URL (or --url).
#                      Requires PostgreSQL 18 client tools on PATH, or PG_BIN=/path/to/bin.
#
# Output: <out-dir>/<db>-<UTC timestamp>.dump plus a .sha256 checksum file.
# Default out-dir is .local/backups (gitignored). Backups contain user data — store
# them encrypted and access-controlled; never commit them.
#
# Read-only against the database. Safe to run at any time.
set -euo pipefail

mode="compose"
db=""
out_dir=""
url="${DATABASE_URL:-}"
compose_service="${COMPOSE_PG_SERVICE:-postgres}"

usage() { sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "db-backup: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --mode) mode="${2:?--mode needs a value}"; shift 2 ;;
    --db) db="${2:?--db needs a value}"; shift 2 ;;
    --out-dir) out_dir="${2:?--out-dir needs a value}"; shift 2 ;;
    --url) url="${2:?--url needs a value}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
out_dir="${out_dir:-$repo_root/.local/backups}"
# umask first so the backup directory itself is private (0700), not just the files.
umask 077
mkdir -p "$out_dir"

# Move a password embedded in the postgres URL held in $base into PGPASSWORD so it never
# appears on a command line (visible in the process list). Mutates $base in place —
# must NOT be called in a $(...) subshell, or the export would be lost.
strip_base_password() {
  if [[ "$base" =~ ^(postgres(ql)?://)([^:@/]+):([^@/]*)@(.*)$ ]]; then
    local pw="${BASH_REMATCH[4]}"
    # percent-decode (%40 -> @ etc.)
    PGPASSWORD="$(printf '%b' "${pw//%/\\x}")"
    export PGPASSWORD
    base="${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}"
  fi
}

valid_db_name() { [[ "$1" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; }

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"
  else shasum -a 256 "$1"; fi
}

ts="$(date -u +%Y%m%dT%H%M%SZ)"

case "$mode" in
  compose)
    command -v docker >/dev/null 2>&1 || die "docker not found (use --mode url for a non-Docker setup)"
    db="${db:-${POSTGRES_DB:-rage}}"
    valid_db_name "$db" || die "invalid database name: $db"
    file="$out_dir/$db-$ts.dump"
    echo "db-backup: dumping database '$db' from compose service '$compose_service' -> $file"
    # Inside the container the official image trusts local socket connections for POSTGRES_USER.
    docker compose -f "$repo_root/docker-compose.yml" exec -T "$compose_service" \
      sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$1" --format=custom --no-owner --no-privileges' _ "$db" \
      > "$file.partial"
    ;;
  url)
    [ -n "$url" ] || die "--mode url requires DATABASE_URL or --url"
    pg_dump_bin="${PG_BIN:+$PG_BIN/}pg_dump"
    command -v "$pg_dump_bin" >/dev/null 2>&1 || die "pg_dump not found (install PostgreSQL 18 client tools or set PG_BIN)"
    # libpq rejects Prisma's ?schema=... query parameter; strip the query string.
    base="${url%%\?*}"
    strip_base_password
    if [ -n "$db" ]; then
      valid_db_name "$db" || die "invalid database name: $db"
      base="${base%/*}/$db"
    fi
    db="${base##*/}"
    valid_db_name "$db" || die "could not determine database name from URL"
    file="$out_dir/$db-$ts.dump"
    echo "db-backup: dumping database '$db' via $pg_dump_bin -> $file"
    "$pg_dump_bin" --dbname="$base" --format=custom --no-owner --no-privileges > "$file.partial"
    ;;
  *) die "unknown --mode '$mode' (compose|url)" ;;
esac

[ -s "$file.partial" ] || { rm -f "$file.partial"; die "dump is empty — aborting"; }
mv "$file.partial" "$file"
(cd "$out_dir" && sha256 "$(basename "$file")" > "$(basename "$file").sha256")
echo "db-backup: OK $(wc -c < "$file" | tr -d ' ') bytes, checksum $(basename "$file").sha256"
echo "$file"
