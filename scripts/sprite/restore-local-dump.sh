#!/usr/bin/env bash
set -euo pipefail

DUMP_PATH="${1:-/tmp/recallmem-local.dump}"
DB_NAME="${RECALLMEM_DB_NAME:-recallmem}"
DB_USER="${RECALLMEM_DB_USER:-recallmem}"

case "$DB_NAME" in
  *[!a-zA-Z0-9_]*|"") echo "Invalid DB_NAME: $DB_NAME" >&2; exit 1 ;;
esac

case "$DB_USER" in
  *[!a-zA-Z0-9_]*|"") echo "Invalid DB_USER: $DB_USER" >&2; exit 1 ;;
esac

if [ ! -f "$DUMP_PATH" ]; then
  echo "Dump not found: $DUMP_PATH" >&2
  exit 1
fi

if command -v sprite-env >/dev/null 2>&1; then
  sprite-env services stop recallmem >/dev/null 2>&1 || true
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();"

sudo -u postgres dropdb --if-exists "$DB_NAME"
sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS vector;"
sudo -u postgres pg_restore --no-owner --no-acl --exit-on-error -d "$DB_NAME" "$DUMP_PATH"

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL
DO \$\$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT c.relkind, n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
  LOOP
    EXECUTE format(
      'ALTER %s %I.%I OWNER TO %I',
      CASE item.relkind
        WHEN 'S' THEN 'SEQUENCE'
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        WHEN 'f' THEN 'FOREIGN TABLE'
        ELSE 'TABLE'
      END,
      item.nspname,
      item.relname,
      '$DB_USER'
    );
  END LOOP;
END
\$\$;

ALTER SCHEMA public OWNER TO "$DB_USER";
GRANT ALL ON SCHEMA public TO "$DB_USER";
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "$DB_USER";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "$DB_USER";
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO "$DB_USER";
SQL

if command -v sprite-env >/dev/null 2>&1; then
  sprite-env services start recallmem >/dev/null 2>&1 || true
fi

echo "Restore complete"
