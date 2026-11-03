#!/bin/sh
# PostgreSQL nightly backup — run from host cron or the db container.
#   crontab: 15 2 * * *  /path/to/backup-db.sh
set -eu
: "${POSTGRES_USER:=pcs}" "${POSTGRES_DB:=copysahaayak}" "${POSTGRES_PASSWORD:?}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/copysahaayak}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
export PGPASSWORD="$POSTGRES_PASSWORD"
pg_dump -h "${PGHOST:-127.0.0.1}" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$BACKUP_DIR/db-$STAMP.dump"
# Keep 14 days, then prune
find "$BACKUP_DIR" -name 'db-*.dump' -mtime +14 -delete
echo "backup written: $BACKUP_DIR/db-$STAMP.dump"

# Restore procedure (see docs/DEPLOYMENT.md):
#   pg_restore -h HOST -U pcs -d copysahaayak --clean --if-exists db-<stamp>.dump
