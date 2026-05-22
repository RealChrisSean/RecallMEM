#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${RECALLMEM_REPO_URL:-https://github.com/RealChrisSean/RecallMEM.git}"
BRANCH="${RECALLMEM_BRANCH:-main}"
APP_DIR="${RECALLMEM_APP_DIR:-/home/sprite/recallmem}"
DB_NAME="${RECALLMEM_DB_NAME:-recallmem}"
DB_USER="${RECALLMEM_DB_USER:-recallmem}"
DB_PASS_FILE="${RECALLMEM_DB_PASS_FILE:-/home/sprite/.recallmem_db_password}"
HTTP_PORT="${PORT:-8080}"
POSTGRES_MAJOR="${POSTGRES_MAJOR:-17}"
NPM_BIN="${NPM_BIN:-$(command -v npm)}"

case "$DB_NAME" in
  *[!a-zA-Z0-9_]*|"") echo "Invalid DB_NAME: $DB_NAME" >&2; exit 1 ;;
esac

case "$DB_USER" in
  *[!a-zA-Z0-9_]*|"") echo "Invalid DB_USER: $DB_USER" >&2; exit 1 ;;
esac

echo "==> Installing system packages"
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates \
  curl \
  ffmpeg \
  git \
  openssl \
  poppler-utils \
  postgresql \
  postgresql-contrib \
  "postgresql-${POSTGRES_MAJOR}-pgvector"

echo "==> Starting Postgres for setup"
sudo pg_ctlcluster "$POSTGRES_MAJOR" main start >/dev/null 2>&1 || sudo service postgresql start

if [ ! -f "$DB_PASS_FILE" ]; then
  openssl rand -hex 24 > "$DB_PASS_FILE"
  chmod 600 "$DB_PASS_FILE"
fi

DB_PASS="$(cat "$DB_PASS_FILE")"

echo "==> Creating database and pgvector extension"
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE \"${DB_USER}\" WITH LOGIN PASSWORD '${DB_PASS}';"
else
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE \"${DB_USER}\" LOGIN PASSWORD '${DB_PASS}';"
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo "==> Cloning or updating RecallMEM"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

echo "==> Writing app environment"
cat > "$APP_DIR/.env.local" <<EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=gemma4:26b
OLLAMA_FAST_MODEL=gemma4:e4b
OLLAMA_EMBED_MODEL=embeddinggemma
NEXT_PUBLIC_APP_VERSION=sprite
EOF
chmod 600 "$APP_DIR/.env.local"

echo "==> Installing Node dependencies, migrating, and building"
cd "$APP_DIR"
npm ci
npm run migrate
npm run build

if command -v sprite-env >/dev/null 2>&1; then
  echo "==> Registering Sprite services"
  sprite-env services delete recallmem >/dev/null 2>&1 || true
  sprite-env services delete postgres >/dev/null 2>&1 || true

  # The setup phase starts Postgres through pg_ctlcluster/service so migrations can run.
  # Sprite services need the foreground postgres process instead, so stop the setup
  # daemon before registering the managed service.
  sudo pg_ctlcluster "$POSTGRES_MAJOR" main stop >/dev/null 2>&1 || sudo service postgresql stop >/dev/null 2>&1 || true

  sprite-env services create postgres \
    --cmd /usr/bin/sudo \
    --args "-u,postgres,/usr/lib/postgresql/${POSTGRES_MAJOR}/bin/postgres,-D,/var/lib/postgresql/${POSTGRES_MAJOR}/main,-c,config_file=/etc/postgresql/${POSTGRES_MAJOR}/main/postgresql.conf" \
    --no-stream

  sprite-env services create recallmem \
    --cmd "$NPM_BIN" \
    --args "run,start,--,-H,0.0.0.0,-p,${HTTP_PORT}" \
    --dir "$APP_DIR" \
    --needs postgres \
    --http-port "$HTTP_PORT" \
    --duration 15s
fi

echo "==> Done"
