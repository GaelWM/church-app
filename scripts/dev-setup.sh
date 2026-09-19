#!/usr/bin/env bash
# One-time (re-runnable) local setup: Postgres in Docker, migrations, seed, demo data, dev config files.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo "Docker is required for the local database."; exit 1; }
docker compose up -d --wait db
export DATABASE_URL=postgres://postgres:pw@localhost:54320/church
bun install
(cd packages/db && bun src/migrate.ts && bun src/seed.ts && bun src/dev-seed.ts)
(cd packages/db && APP_DB_PASSWORD=app bun src/grant-app-role.ts)
# Local-only config (git-ignored). DEV_AUTH is never set in wrangler.jsonc.
cat > apps/api/.dev.vars <<'VARS'
DEV_AUTH=1
APP_URL=http://localhost:5173
AUTH0_M2M_CLIENT_ID=unused-locally
AUTH0_M2M_CLIENT_SECRET=unused-locally
VARS
# The Worker serves apps/web/dist on :8787. Locally, use Vite on :5173 instead of a stale build.
rm -rf apps/web/dist && mkdir -p apps/web/dist
echo '<!doctype html><meta charset="utf-8"><p>Mode local : ouvrez <a href="http://localhost:5173">http://localhost:5173</a></p>' > apps/web/dist/index.html
echo "Ready. Start with: bun run dev, then open http://localhost:5173"
