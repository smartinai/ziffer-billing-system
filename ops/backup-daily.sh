#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/opt/ziffer-billing-v2}"
. "$APP_DIR/ops/common.sh"

BACKUP_ENV="${BACKUP_ENV:-/etc/ziffer-backup.env}"
BACKUP_DIR="${BACKUP_DIR:-/opt/ziffer-backups/daily}"
LOG_FILE="$BACKUP_DIR/backup.log"
LOCK_FILE="/tmp/ziffer-backup.lock"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
rotate_log "$LOG_FILE"
exec >>"$LOG_FILE" 2>&1

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  printf '[%s] Backup already running; skipping.\n' "$(date --iso-8601=seconds)"
  exit 0
fi

started_at=$(date --iso-8601=seconds)
timestamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
temporary="$BACKUP_DIR/.ziffer-$timestamp.dump.tmp"
backup="$BACKUP_DIR/ziffer-$timestamp.dump"
checksum="$backup.sha256"

cleanup() {
  code=$?
  rm -f "$temporary"
  if [ "$code" -ne 0 ]; then
    record_operation backup failed scheduled "Daily backup failed; inspect $LOG_FILE" "{\"startedAt\":\"$started_at\"}"
    "$APP_DIR/ops/send-alert.sh" "[Ziffer] critical: Database backup failed" "The daily database backup failed at $(date --iso-8601=seconds). Inspect $LOG_FILE." || true
    printf '[%s] Backup failed.\n' "$(date --iso-8601=seconds)"
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM

if [ ! -r "$BACKUP_ENV" ]; then
  printf 'Missing root-only backup configuration: %s\n' "$BACKUP_ENV" >&2
  exit 1
fi

set -a
. "$BACKUP_ENV"
set +a

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
[ -n "${RESTIC_PASSWORD:-}" ] || [ -r "${RESTIC_PASSWORD_FILE:-}" ] || { printf 'RESTIC_PASSWORD or a readable RESTIC_PASSWORD_FILE is required.\n' >&2; exit 1; }
command -v restic >/dev/null 2>&1 || { printf 'restic is not installed.\n' >&2; exit 1; }

printf '[%s] Starting validated production backup.\n' "$started_at"
compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$temporary"
compose exec -T postgres pg_restore --list < "$temporary" >/dev/null
mv "$temporary" "$backup"
chmod 600 "$backup"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$backup")" > "$(basename "$checksum")")
chmod 600 "$checksum"
verify_sha256 "$backup" "$checksum"

restic backup "$backup" "$checksum" --tag ziffer-production --host "$(hostname)"
restic forget --tag ziffer-production --keep-daily 14 --keep-weekly 8 --keep-monthly 12

find "$BACKUP_DIR" -type f -name 'ziffer-*.dump' -mtime +14 -delete
find "$BACKUP_DIR" -type f -name 'ziffer-*.dump.sha256' -mtime +14 -delete

size=$(wc -c < "$backup" | tr -d ' ')
record_operation backup complete scheduled "" "{\"path\":\"$backup\",\"bytes\":$size,\"offsite\":true}"
printf '[%s] Validated local and off-site backup: %s\n' "$(date --iso-8601=seconds)" "$backup"
trap - EXIT INT TERM
