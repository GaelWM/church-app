#!/usr/bin/env bash
# Starts a throwaway Postgres in Docker, migrates, seeds, and prints the env for API tests.
#   eval "$(scripts/test-db.sh)" && bun test
set -euo pipefail
NAME=church-test-pg; PORT=${TEST_PG_PORT:-54329}
docker rm -f $NAME >/dev/null 2>&1 || true
docker run -d --name $NAME -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=church -p $PORT:5432 postgres:16-alpine >/dev/null
until docker exec $NAME pg_isready -U postgres -d church >/dev/null 2>&1; do sleep 1; done
export DATABASE_URL=postgres://postgres:pw@localhost:$PORT/church
(cd packages/db && bun src/migrate.ts && bun src/seed.ts) >&2
docker exec -i $NAME psql -U postgres -d church < packages/db/test-setup.sql >&2
echo "export TEST_ADMIN_DATABASE_URL=$DATABASE_URL TEST_APP_DATABASE_URL=postgres://app_user:app@localhost:$PORT/church"
