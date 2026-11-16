#!/usr/bin/env bash
# Recria um banco local de testes com o stub do Supabase + migrações.
set -euo pipefail
HOST=${PGHOST:-/tmp}; PORT=${PGPORT:-54329}; DB=${PGDATABASE_TEST:-bonnie_test}
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
psql -h "$HOST" -p "$PORT" -U postgres -q -c "drop database if exists $DB with (force)" -c "create database $DB"
psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 -f "$DIR/tests/db/supabase-stub.sql"
psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 -c "create extension if not exists pgcrypto with schema extensions; create extension if not exists unaccent with schema extensions;"
for f in "$DIR"/supabase/migrations/*.sql; do
  psql -h "$HOST" -p "$PORT" -U postgres -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f"
done
echo "ok: $DB"
