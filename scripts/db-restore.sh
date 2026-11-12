#!/usr/bin/env bash
# RAGE Platform — restore a pg_dump custom-format backup. DESTRUCTIVE for the target DB.
#
# Usage:
#   scripts/db-restore.sh --file PATH.dump --target-db NAME --i-understand-this-overwrites-data \
#                         [--mode compose|url] [--url URL] [--create] [--allow-remote-host]
#
# Safety rules (by design there are NO defaults for the dangerous parts):
#   * --target-db is required; it is never inferred from DATABASE_URL.
#   * --i-understand-this-overwrites-data is required.
#   * Refuses when NODE_ENV/RAGE_ENV is "production" unless RAGE_ALLOW_PROD_RESTORE=yes
#     (production restores belong to the M7 incident procedure in docs/RUNBOOK.md).
#   * --mode url refuses non-local hosts (anything but localhost/127.0.0.1/::1) unless
#     --allow-remote-host is given.
#   * Verifies the .sha256 checksum next to the dump when present.
#
# --create   drop-and-recreate the target database first (use for restore rehearsals into a
#            scratch DB, e.g. --target-db rage_restore_check). Without it, objects are
#            restored with --clean --if-exists into the existing database.
#
# Modes: compose (default) runs pg_restore inside the compose `postgres` container;
#        url runs local pg_restore/psql (PostgreSQL 18 client tools, or PG_BIN=/path/to/bin).
set -euo pipefail

mode="compose"
file=""
target_db=""
confirm="no"
create="no"
allow_remote="no"
url="${DATABASE_URL:-}"
compose_service="${COMPOSE_PG_SERVICE:-postgres}"

usage() { sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "db-restore: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --file) file="${2:?--file needs a value}"; shift 2 ;;
    --target-db) target_db="${2:?--target-db needs a value}"; shift 2 ;;
    --mode) mode="${2:?--mode needs a value}"; shift 2 ;;
    --url) url="${2:?--url needs a value}"; shift 2 ;;
    --create) create="yes"; shift ;;
    --allow-remote-host) allow_remote="yes"; shift ;;
    --i-understand-this-overwrites-data) confirm="yes"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done

[ -n "$file" ] || die "--file is required"
[ -f "$file" ] || die "backup file not found: $file"
[ -n "$target_db" ] || die "--target-db is required (no default, on purpose)"
[[ "$target_db" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "invalid database name: $target_db"
case "$target_db" in postgres|template0|template1) die "refusing to restore into system database '$target_db'" ;; esac
[ "$confirm" = "yes" ] || die "refusing: pass --i-understand-this-overwrites-data to confirm restoring into '$target_db'"

for v in "${NODE_ENV:-}" "${RAGE_ENV:-}"; do
  if [ "$v" = "production" ] && [ "${RAGE_ALLOW_PROD_RESTORE:-}" != "yes" ]; then
    die "refusing: production environment detected (set RAGE_ALLOW_PROD_RESTORE=yes only during an approved incident)"
  fi
done

if [ -f "$file.sha256" ]; then
  expected="$(awk '{print $1}' "$file.sha256")"
  if command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$file" | awk '{print $1}')"
  else actual="$(shasum -a 256 "$file" | awk '{print $1}')"; fi
  [ "$expected" = "$actual" ] || die "checksum mismatch for $file"
  echo "db-restore: checksum OK"
else
  echo "db-restore: WARNING no $file.sha256 found; skipping checksum verification" >&2
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
restore_flags=(--no-owner --no-privileges --exit-on-error)

case "$mode" in
  compose)
    command -v docker >/dev/null 2>&1 || die "docker not found (use --mode url for a non-Docker setup)"
    dc=(docker compose -f "$repo_root/docker-compose.yml" exec -T "$compose_service")
    if [ "$create" = "yes" ]; then
      echo "db-restore: recreating database '$target_db' (compose)"
      "${dc[@]}" sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
        -c "DROP DATABASE IF EXISTS \"$1\" WITH (FORCE)" \
        -c "CREATE DATABASE \"$1\" OWNER \"$POSTGRES_USER\""' _ "$target_db"
    else
      restore_flags+=(--clean --if-exists)
    fi
    echo "db-restore: restoring $file -> '$target_db' (compose service '$compose_service')"
    "${dc[@]}" sh -c 'db="$1"; shift; exec pg_restore -U "$POSTGRES_USER" -d "$db" "$@"' _ "$target_db" "${restore_flags[@]}" < "$file"
    tables="$("${dc[@]}" sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" -tAc "$2"' _ "$target_db" \
      "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public'")"
    echo "db-restore: public tables restored: $tables"
    ;;
  url)
    [ -n "$url" ] || die "--mode url requires DATABASE_URL or --url"
    base="${url%%\?*}"
    # Keep the password off command lines (process list): move it into PGPASSWORD.
    if [[ "$base" =~ ^(postgres(ql)?://)([^:@/]+):([^@/]*)@(.*)$ ]]; then
      pw="${BASH_REMATCH[4]}"
      PGPASSWORD="$(printf '%b' "${pw//%/\\x}")"
      export PGPASSWORD
      base="${BASH_REMATCH[1]}${BASH_REMATCH[3]}@${BASH_REMATCH[5]}"
      unset pw
    fi
    hostpart="${base#*://}"; hostpart="${hostpart#*@}"; hostpart="${hostpart%%/*}"
    case "$hostpart" in
      \[*\]*) host="${hostpart%%]*}"; host="${host#[}" ;;
      *) host="${hostpart%%:*}" ;;
    esac
    case "$host" in
      localhost|127.0.0.1|::1) ;;
      *) [ "$allow_remote" = "yes" ] || die "refusing non-local host '$host' (pass --allow-remote-host if intended)" ;;
    esac
    target_url="${base%/*}/$target_db"
    admin_url="${base%/*}/postgres"
    pg_restore_bin="${PG_BIN:+$PG_BIN/}pg_restore"
    psql_bin="${PG_BIN:+$PG_BIN/}psql"
    command -v "$pg_restore_bin" >/dev/null 2>&1 || die "pg_restore not found (install PostgreSQL 18 client tools or set PG_BIN)"
    command -v "$psql_bin" >/dev/null 2>&1 || die "psql not found (install PostgreSQL 18 client tools or set PG_BIN)"
    if [ "$create" = "yes" ]; then
      echo "db-restore: recreating database '$target_db' on $host"
      "$psql_bin" "$admin_url" -v ON_ERROR_STOP=1 \
        -c "DROP DATABASE IF EXISTS \"$target_db\" WITH (FORCE)" \
        -c "CREATE DATABASE \"$target_db\""
    else
      restore_flags+=(--clean --if-exists)
    fi
    echo "db-restore: restoring $file -> '$target_db' on $host"
    "$pg_restore_bin" --dbname="$target_url" "${restore_flags[@]}" "$file"
    echo "db-restore: public tables restored: $("$psql_bin" "$target_url" -tAc "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public'")"
    ;;
  *) die "unknown --mode '$mode' (compose|url)" ;;
esac

echo "db-restore: OK"
