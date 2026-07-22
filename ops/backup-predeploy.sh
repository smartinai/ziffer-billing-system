#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/opt/ziffer-billing-v2}"
. "$APP_DIR/ops/common.sh"

BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups/daily}"
LOCK_FILE="/tmp/ziffer-backup.lock"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

exec 9>"$LOCK_FILE"
flock -n 9 || { printf 'Another backup is running.\n' >&2; exit 1; }

timestamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
temporary="$BACKUP_DIR/.ziffer-$timestamp.dump.tmp"
backup="$BACKUP_DIR/ziffer-$timestamp.dump"
checksum="$backup.sha256"

cleanup() {
  code=$?
  rm -f "$temporary"
  exit "$code"
}
trap cleanup EXIT INT TERM

compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$temporary"
compose exec -T postgres pg_restore --list < "$temporary" >/dev/null
mv "$temporary" "$backup"
chmod 600 "$backup"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$backup")" > "$(basename "$checksum")")
chmod 600 "$checksum"
verify_sha256 "$backup" "$checksum"

find "$BACKUP_DIR" -type f -name 'ziffer-*.dump' -mtime +14 -delete
find "$BACKUP_DIR" -type f -name 'ziffer-*.dump.sha256' -mtime +14 -delete

size=$(wc -c < "$backup" | tr -d ' ')
record_operation backup complete deploy "" "{\"path\":\"$backup\",\"bytes\":$size,\"offsite\":false}"
printf '[%s] Validated local pre-deployment backup: %s\n' "$(date --iso-8601=seconds)" "$backup"
trap - EXIT INT TERM
