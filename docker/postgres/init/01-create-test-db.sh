#!/bin/sh
# Runs ONCE, on first initialisation of an empty postgres-data volume
# (official image: /docker-entrypoint-initdb.d). Creates the integration-test
# database next to the main one, owned by the same dev role.
#
# Dev/CI only. Re-running requires `docker compose down -v` (destroys data).
set -eu

test_db="${POSTGRES_TEST_DB:-rage_test}"

case "$test_db" in
  *[!a-z0-9_]* | [!a-z_]*)
    echo "01-create-test-db: refusing invalid database name '$test_db'" >&2
    exit 1
    ;;
esac

exists="$(psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '$test_db'")"

if [ "$exists" = "1" ]; then
  echo "01-create-test-db: database $test_db already exists"
else
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -c "CREATE DATABASE \"$test_db\" OWNER \"$POSTGRES_USER\""
  echo "01-create-test-db: created database $test_db"
fi
