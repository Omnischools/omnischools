#!/usr/bin/env bash
# Boot (or reuse) a throwaway PostgreSQL cluster for the Oversight test suite.
#
# The §6 gate is a claim about two databases, RLS, transaction ordering and grants. None of that is
# testable against a mock: a fake read-back client would happily "enforce" a consent check that the
# real one gets wrong, and a stubbed audit writer cannot fail the way a real INSERT under an RLS
# policy fails. So the tests run against real Postgres, and this script produces it.
#
# Idempotent: initdb only if there is no cluster, start only if nothing answers on the port.
# Prints the superuser URL on stdout; everything else goes to stderr.
set -euo pipefail

PGBIN="${OVERSIGHT_TEST_PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${OVERSIGHT_TEST_PGDATA:-/tmp/oversight-test-pg}"
PGPORT="${OVERSIGHT_TEST_PGPORT:-55999}"

if [ ! -x "$PGBIN/initdb" ]; then
  echo "postgres binaries not found at $PGBIN — set OVERSIGHT_TEST_PGBIN, or point OVERSIGHT_TEST_DATABASE_URL at an existing server" >&2
  exit 2
fi

# initdb and postgres refuse to run as root, so when we are root we do the work as the `postgres`
# system user and hand it ownership of the data directory.
RUNAS=""
if [ "$(id -u)" = "0" ]; then RUNAS="postgres"; fi

run() {
  if [ -n "$RUNAS" ]; then su "$RUNAS" -c "$1"; else bash -c "$1"; fi
}

mkdir -p "$PGDATA"
if [ -n "$RUNAS" ]; then chown -R postgres:postgres "$PGDATA"; fi

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  run "$PGBIN/initdb -D '$PGDATA' -U postgres -A trust --no-sync" >&2
fi

if ! "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1; then
  run "$PGBIN/pg_ctl -D '$PGDATA' -o '-p $PGPORT -k $PGDATA -c listen_addresses=127.0.0.1 -c fsync=off' -l '$PGDATA/server.log' -w start" >&2
fi

echo "postgresql://postgres@127.0.0.1:$PGPORT/postgres"
