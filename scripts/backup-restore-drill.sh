#!/usr/bin/env bash
# Backup and restore drill. Proves a backup is actually restorable, and that what comes back is complete and trustworthy:
#   1. dumps the source database (pg_dump, custom format)
#   2. restores it into a brand-new scratch database on the same server
#   3. compares row counts of the core tables, source vs restored
#   4. re-verifies EVERY organisation's audit hash chain in the restored copy
#   5. drops the scratch database
# It only reads the source. Run it on a schedule against a staging copy or production replica and keep the output.
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host:5432/pathora scripts/backup-restore-drill.sh
# Needs pg_dump, pg_restore and psql on PATH. For local development where they live in the docker container instead:
#   PG_DOCKER=pathora-postgres DATABASE_URL=postgresql://pathora:pathora@localhost:5432/pathora scripts/backup-restore-drill.sh
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL to the source database}"

SRC_DB="${DATABASE_URL##*/}"; SRC_DB="${SRC_DB%%\?*}"
SERVER_URL="${DATABASE_URL%/*}"
SCRATCH="pathora_restore_drill_$(date +%s)"
SCRATCH_URL="$SERVER_URL/$SCRATCH"
USER_NAME="$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-z]+://([^:@]+).*#\1#')"
WORK="$(mktemp -d)"

# Tool wrappers: run against the server directly, or inside the docker container that hosts it.
if [ -n "${PG_DOCKER:-}" ]; then
  run_psql()   { docker exec -i "$PG_DOCKER" psql -U "$USER_NAME" -d "$1" "${@:2}"; }
  dump()       { docker exec -i "$PG_DOCKER" pg_dump -U "$USER_NAME" -Fc "$1"; }
  restore()    { docker exec -i "$PG_DOCKER" pg_restore -U "$USER_NAME" -d "$1" --no-owner; }
else
  run_psql()   { psql "$SERVER_URL/$1" "${@:2}"; }
  dump()       { pg_dump -Fc "$SERVER_URL/$1"; }
  restore()    { pg_restore -d "$SERVER_URL/$1" --no-owner "$WORK/dump.pgc"; }
fi
cleanup() { run_psql postgres -qc "DROP DATABASE IF EXISTS \"$SCRATCH\"" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
say() { printf '\n== %s\n' "$*"; }

COUNTS="SELECT 'Organization', count(*) FROM \"Organization\" UNION ALL SELECT 'User', count(*) FROM \"User\"
 UNION ALL SELECT 'Facility', count(*) FROM \"Facility\" UNION ALL SELECT 'Patient', count(*) FROM \"Patient\"
 UNION ALL SELECT 'ReferralCase', count(*) FROM \"ReferralCase\" UNION ALL SELECT 'CaseMilestone', count(*) FROM \"CaseMilestone\"
 UNION ALL SELECT 'Consent', count(*) FROM \"Consent\" UNION ALL SELECT 'CommsLog', count(*) FROM \"CommsLog\"
 UNION ALL SELECT 'AuditEvent', count(*) FROM \"AuditEvent\" ORDER BY 1"

say "1/5 Dumping $SRC_DB"
dump "$SRC_DB" > "$WORK/dump.pgc"
echo "  dump size: $(wc -c < "$WORK/dump.pgc") bytes"

say "2/5 Restoring into scratch database $SCRATCH"
run_psql postgres -qc "CREATE DATABASE \"$SCRATCH\""
if [ -n "${PG_DOCKER:-}" ]; then restore "$SCRATCH" < "$WORK/dump.pgc"; else restore "$SCRATCH"; fi
echo "  restored"

say "3/5 Comparing row counts (source vs restored)"
run_psql "$SRC_DB"  -At -F' ' -c "$COUNTS" > "$WORK/src.txt"
run_psql "$SCRATCH" -At -F' ' -c "$COUNTS" > "$WORK/dst.txt"
paste "$WORK/src.txt" "$WORK/dst.txt" | awk '{ ok = ($2==$4) ? "ok" : "MISMATCH"; printf "  %-14s source=%-7s restored=%-7s %s\n", $1, $2, $4, ok; if (ok != "ok") bad=1 } END { exit bad }'

say "4/5 Verifying every audit hash chain in the RESTORED copy"
SCRATCH_DB_URL="$SCRATCH_URL" npx --no-install tsx scripts/verify-audit-chain.ts

say "5/5 Cleaning up"
cleanup
trap - EXIT
echo; echo "DRILL PASSED: the backup restored completely and every audit chain verified."
