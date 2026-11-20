#!/bin/sh
# Container entrypoint. Optionally applies database migrations before the app starts, then runs the command it was given.
#
#   MIGRATE_ON_START=true   run `prisma migrate deploy` first; if it fails, the container exits and the app does NOT start.
#
# Prefer the platform's pre-deploy step (Railway: preDeployCommand in railway.json) so migrations run once per release, before any new
# instance takes traffic. This switch is the fallback for platforms or plans without one. It is safe with several
# instances starting at once: Prisma takes a database lock, so migrations are applied exactly once. It needs DATABASE_URL
# as a plain environment variable.
set -eu

if [ "${MIGRATE_ON_START:-}" = "true" ]; then
  echo "[entrypoint] applying database migrations"
  npx --no-install prisma migrate deploy
  echo "[entrypoint] migrations are up to date"
fi

exec "$@"
