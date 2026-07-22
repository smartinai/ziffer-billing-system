#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/opt/ziffer-billing-v2}"
. "$APP_DIR/ops/common.sh"

BACKUP_ENV="${BACKUP_ENV:-/etc/ziffer-backup.env}"
LOG_FILE="$APP_DIR/logs/restore-drill.log"
LOCK_FILE="/tmp/ziffer-restore-drill.lock"
drill_id="ziffer-restore-$(date +%s)"
container="$drill_id-postgres"
restore_root=$(mktemp -d /tmp/ziffer-restore.XXXXXX)
started_epoch=$(date +%s)

mkdir -p "$APP_DIR/logs" "$STATE_DIR"
rotate_log "$LOG_FILE"
exec >>"$LOG_FILE" 2>&1
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

cleanup() {
  code=$?
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$restore_root"
  if [ "$code" -ne 0 ]; then
    record_operation restore_drill failed scheduled "Restore drill failed; inspect $LOG_FILE"
    "$APP_DIR/ops/send-alert.sh" "[Ziffer] critical: Restore drill failed" "The isolated weekly restore drill failed at $(date --iso-8601=seconds). Inspect $LOG_FILE." || true
  fi
  exit "$code"
}
trap cleanup EXIT INT TERM

[ -r "$BACKUP_ENV" ] || { printf 'Missing %s\n' "$BACKUP_ENV" >&2; exit 1; }
set -a
. "$BACKUP_ENV"
set +a
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
[ -n "${RESTIC_PASSWORD:-}" ] || [ -r "${RESTIC_PASSWORD_FILE:-}" ] || { printf 'RESTIC_PASSWORD or a readable RESTIC_PASSWORD_FILE is required.\n' >&2; exit 1; }

printf '[%s] Checking encrypted off-site repository.\n' "$(date --iso-8601=seconds)"
restic check
restic restore latest --tag ziffer-production --target "$restore_root"
dump=$(find "$restore_root" -type f -name 'ziffer-*.dump' -printf '%T@ %p\n' | sort -nr | awk 'NR==1 {$1=""; sub(/^ /, ""); print}')
[ -n "$dump" ] || { printf 'No production dump found in latest snapshot.\n' >&2; exit 1; }
checksum="$dump.sha256"
[ -f "$checksum" ] || { printf 'Checksum missing for %s.\n' "$dump" >&2; exit 1; }
verify_sha256 "$dump" "$checksum"

docker run -d --name "$container" --network none \
  -e POSTGRES_DB=ziffer_restore \
  -e POSTGRES_USER=ziffer_drill \
  -e POSTGRES_PASSWORD=ziffer_restore_only \
  postgres:17-alpine >/dev/null

attempt=0
until docker exec "$container" pg_isready -U ziffer_drill -d ziffer_restore >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 30 ] || { printf 'Restore PostgreSQL did not become ready.\n' >&2; exit 1; }
  sleep 1
done

docker cp "$dump" "$container:/tmp/ziffer.dump"
docker exec "$container" pg_restore -U ziffer_drill -d ziffer_restore --no-owner --no-privileges /tmp/ziffer.dump

for migration in "$APP_DIR"/migrations/*.sql; do
  migration_id=$(basename "$migration" .sql)
  applied=$(docker exec "$container" psql -U ziffer_drill -d ziffer_restore -Atc "select count(*) from schema_migrations where id = '$migration_id'" 2>/dev/null || printf 0)
  if [ "$applied" = "0" ]; then
    docker cp "$migration" "$container:/tmp/migration.sql"
    docker exec "$container" psql -v ON_ERROR_STOP=1 -U ziffer_drill -d ziffer_restore -f /tmp/migration.sql >/dev/null
    docker exec "$container" psql -v ON_ERROR_STOP=1 -U ziffer_drill -d ziffer_restore -c "insert into schema_migrations (id, name) values ('$migration_id', '$migration_id')" >/dev/null
  fi
done

docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U ziffer_drill -d ziffer_restore <<'SQL'
do $$
begin
  if not exists (
    select 1 from app_users
    join app_user_roles on app_user_roles.user_id = app_users.id
    join app_roles on app_roles.id = app_user_roles.role_id and app_roles.name = 'admin'
    where app_users.status = 'active'
  ) then
    raise exception 'No active administrator restored';
  end if;
  if not exists (select 1 from teamwork_sync_runs where status = 'complete' and partial = false) then
    raise exception 'No complete Teamwork coverage checkpoint restored';
  end if;
  if exists (select 1 from pg_constraint where not convalidated) then
    raise exception 'One or more restored constraints are not validated';
  end if;
  if exists (select 1 from quote_lines line left join quote_previews preview on preview.id = line.quote_preview_id where preview.id is null) then
    raise exception 'Orphaned quote lines detected';
  end if;
  if exists (select 1 from annual_invoice_usage where max_hours < 0 or used_hours < 0 or (max_hours is not null and used_hours > max_hours + 0.0001)) then
    raise exception 'Invalid annual usage balance detected';
  end if;
  if exists (
    select 1 from annual_invoice_usage_events
    where action = 'quote_send_to_xero'
      and abs((next_used_hours - previous_used_hours) - coalesce((metadata->>'hours')::numeric, 0)) > 0.0001
  ) then
    raise exception 'Annual usage event arithmetic is inconsistent';
  end if;
  if exists (
    select annual_invoice_usage_id, metadata->>'quotePreviewId'
    from annual_invoice_usage_events
    where action = 'quote_send_to_xero'
    group by annual_invoice_usage_id, metadata->>'quotePreviewId'
    having count(*) > 1
  ) then
    raise exception 'Annual usage was applied more than once for a draft';
  end if;
  if exists (select idempotency_key from xero_quotes group by idempotency_key having count(*) > 1) then
    raise exception 'Duplicate Xero idempotency keys detected';
  end if;
  if exists (
    select 1 from xero_send_attempts attempt
    left join xero_quotes quote on quote.quote_preview_id = attempt.quote_preview_id
    where attempt.state = 'succeeded' and quote.id is null
  ) then
    raise exception 'Succeeded Xero attempt has no local document record';
  end if;
end $$;

select 'app_users', count(*) from app_users
union all select 'quote_previews', count(*) from quote_previews
union all select 'xero_quotes', count(*) from xero_quotes
union all select 'teamwork_time_entries', count(*) from teamwork_time_entries;
SQL

duration=$(( $(date +%s) - started_epoch ))
[ "$duration" -le 7200 ] || { printf 'Restore drill exceeded the two-hour recovery target.\n' >&2; exit 1; }
restic forget --tag ziffer-production --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune
date --iso-8601=seconds > "$STATE_DIR/last-restore-drill-success"
chmod 600 "$STATE_DIR/last-restore-drill-success"
record_operation restore_drill complete scheduled "" "{\"durationSeconds\":$duration,\"source\":\"offsite\"}"
printf '[%s] Restore drill completed in %s seconds.\n' "$(date --iso-8601=seconds)" "$duration"
trap - EXIT INT TERM
docker rm -f "$container" >/dev/null
rm -rf "$restore_root"
