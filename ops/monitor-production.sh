#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/opt/ziffer-billing-v2}"
. "$APP_DIR/ops/common.sh"

LOCK_FILE="/tmp/ziffer-monitor.lock"
LOG_FILE="$APP_DIR/logs/operations-monitor.log"
PUBLIC_READY_URL="${PUBLIC_READY_URL:-https://app.ziffer.lu/api/health/ready}"
BACKUP_DIR="${BACKUP_DIR:-/opt/ziffer-backups/daily}"
RESTORE_MARKER="$STATE_DIR/last-restore-drill-success"

mkdir -p "$STATE_DIR" "$APP_DIR/logs"
chmod 700 "$STATE_DIR"
rotate_log "$LOG_FILE"
exec >>"$LOG_FILE" 2>&1
exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

refresh_recipients() {
  temporary="$STATE_DIR/admin-emails.tmp"
  if compose exec -T app node scripts/list-admin-emails.mjs > "$temporary" 2>/dev/null && [ -s "$temporary" ]; then
    mv "$temporary" "$STATE_DIR/admin-emails"
    chmod 600 "$STATE_DIR/admin-emails"
  else
    rm -f "$temporary"
  fi
}

record_observation() {
  operation_type=$1
  status=$2
  message=${3:-}
  metadata=${4:-}
  [ -n "$metadata" ] || metadata='{}'
  marker="$STATE_DIR/operation-$operation_type"
  now=$(date +%s)
  previous_status=""
  previous_time=0
  if [ -r "$marker" ]; then
    previous_status=$(sed -n '1p' "$marker")
    previous_time=$(sed -n '2p' "$marker")
  fi
  case "$previous_time" in (*[!0-9]*) previous_time=0;; esac
  if [ "$status" != "$previous_status" ] || [ $((now - previous_time)) -ge 3600 ]; then
    record_operation "$operation_type" "$status" monitor "$message" "$metadata"
    printf '%s\n%s\n' "$status" "$now" > "$marker"
    chmod 600 "$marker"
  fi
}

record_incident() {
  action=$1
  key=$2
  component=$3
  severity=$4
  summary=$5
  compose exec -T \
    -e "INCIDENT_ACTION=$action" \
    -e "INCIDENT_KEY=$key" \
    -e "INCIDENT_COMPONENT=$component" \
    -e "INCIDENT_SEVERITY=$severity" \
    -e "INCIDENT_SUMMARY=$summary" \
    app node scripts/record-incident.mjs >/dev/null 2>&1 || true
}

notify() {
  key=$1
  subject=$2
  body=$3
  notification_kind=${4:-notify}
  if "$APP_DIR/ops/send-alert.sh" "$subject" "$body"; then
    record_incident "$notification_kind" "$key" app_health warning "$subject"
    date +%s > "$STATE_DIR/$key.notified"
  else
    printf '[%s] Could not send alert %s.\n' "$(date --iso-8601=seconds)" "$key"
  fi
}

observe() {
  key=$1
  component=$2
  severity=$3
  threshold=$4
  healthy=$5
  summary=$6
  recovery_threshold=${7:-1}
  count_file="$STATE_DIR/$key.count"
  success_file="$STATE_DIR/$key.success"
  alerted_file="$STATE_DIR/$key.alerted"
  notified_file="$STATE_DIR/$key.notified"

  count=0
  [ ! -f "$count_file" ] || count=$(cat "$count_file" 2>/dev/null || printf 0)
  case "$count" in (*[!0-9]*) count=0;; esac

  if [ "$healthy" = "true" ]; then
    printf '0\n' > "$count_file"
    successes=0
    [ ! -f "$success_file" ] || successes=$(cat "$success_file" 2>/dev/null || printf 0)
    case "$successes" in (*[!0-9]*) successes=0;; esac
    successes=$((successes + 1))
    printf '%s\n' "$successes" > "$success_file"
    if [ -f "$alerted_file" ]; then
      [ "$successes" -ge "$recovery_threshold" ] || return
      notify "$key" "[Ziffer] Recovered: $summary" "The $component check recovered at $(date --iso-8601=seconds)." recovery
      record_incident resolve "$key" "$component" "$severity" "$summary"
      rm -f "$alerted_file"
    fi
    return
  fi

  count=$((count + 1))
  printf '0\n' > "$success_file"
  printf '%s\n' "$count" > "$count_file"
  record_incident open "$key" "$component" "$severity" "$summary"
  if [ "$count" -lt "$threshold" ]; then return; fi

  now=$(date +%s)
  last=0
  [ ! -f "$notified_file" ] || last=$(cat "$notified_file" 2>/dev/null || printf 0)
  if [ ! -f "$alerted_file" ] || [ $((now - last)) -ge 86400 ]; then
    if [ -f "$notified_file" ]; then notification_kind=reminder; else notification_kind=notify; fi
    notify "$key" "[Ziffer] ${severity}: $summary" "Component: $component\nObserved: $(date --iso-8601=seconds)\nOccurrences: $count\n\nInspect $LOG_FILE and the Admin Operations page." "$notification_kind"
    touch "$alerted_file"
  fi
}

refresh_recipients

if curl --fail --silent --show-error --max-time 15 "$PUBLIC_READY_URL" >/dev/null; then app_ok=true; else app_ok=false; fi
observe app-unavailable app_health critical 2 "$app_ok" "Application readiness check failed" 2
if [ "$app_ok" = "true" ]; then record_observation app_health complete; else record_observation app_health failed "Application readiness check failed"; fi

if compose exec -T postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then db_ok=true; else db_ok=false; fi
observe database-unavailable database_health critical 2 "$db_ok" "PostgreSQL is unavailable" 2
if [ "$db_ok" = "true" ]; then record_observation database_health complete; else record_observation database_health failed "PostgreSQL is unavailable"; fi

running_services=$(compose ps --services --filter status=running 2>/dev/null || true)
containers_ok=true
for required_service in app postgres caddy; do
  printf '%s\n' "$running_services" | grep -qx "$required_service" || containers_ok=false
done
observe containers-unhealthy app_health critical 2 "$containers_ok" "One or more production containers are not running" 2

disk_percent=$(df -P / | awk 'NR==2 {gsub(/%/, "", $5); print $5}')
if [ "$disk_percent" -ge 90 ]; then
  observe disk-critical disk critical 1 false "VPS disk usage is ${disk_percent}%"
elif [ "$disk_percent" -ge 80 ]; then
  observe disk-warning disk warning 1 false "VPS disk usage is ${disk_percent}%"
  observe disk-critical disk critical 1 true "VPS disk usage returned below 90%"
else
  observe disk-warning disk warning 1 true "VPS disk usage returned below 80%"
  observe disk-critical disk critical 1 true "VPS disk usage returned below 90%"
fi
if [ "$disk_percent" -ge 90 ]; then
  record_observation disk failed "VPS disk usage is ${disk_percent}%" "{\"percent\":$disk_percent}"
elif [ "$disk_percent" -ge 80 ]; then
  record_observation disk warning "VPS disk usage is ${disk_percent}%" "{\"percent\":$disk_percent}"
else
  record_observation disk complete "" "{\"percent\":$disk_percent}"
fi

latest_backup=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'ziffer-*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -nr | awk 'NR==1 {$1=""; sub(/^ /, ""); print}')
backup_ok=false
if [ -n "$latest_backup" ]; then
  age=$(( $(date +%s) - $(stat -c %Y "$latest_backup") ))
  offsite_state=$(printf "%s" "select case when status = 'complete' and finished_at > now() - interval '26 hours' and coalesce((metadata->>'offsite')::boolean, false) then 'ok' else 'bad' end from operation_runs where operation_type = 'backup' order by started_at desc limit 1" | compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' 2>/dev/null || true)
  if [ "$age" -le 93600 ] && [ "$offsite_state" = "ok" ] && verify_sha256 "$latest_backup" "$latest_backup.sha256" >/dev/null 2>&1; then backup_ok=true; fi
fi
observe backup-stale backup critical 1 "$backup_ok" "Validated database backup is missing or older than 26 hours"

teamwork_ok=false
teamwork_state=$(printf "%s" "select case when status = 'complete' and partial = false and coverage_end >= (now() at time zone 'Europe/Amsterdam')::date then 'ok' else 'bad' end from teamwork_sync_runs where trigger = 'scheduled' order by started_at desc limit 1" | compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' 2>/dev/null || true)
[ "$teamwork_state" = "ok" ] && teamwork_ok=true
hour=$(TZ=Europe/Amsterdam date +%H | sed 's/^0//')
if [ "$hour" -ge 1 ]; then observe teamwork-nightly teamwork_sync warning 1 "$teamwork_ok" "Nightly Teamwork sync has no complete checkpoint for today"; fi

restore_ok=false
if [ -f "$RESTORE_MARKER" ] && [ $(( $(date +%s) - $(stat -c %Y "$RESTORE_MARKER") )) -le 691200 ]; then restore_ok=true; fi
observe restore-drill-stale restore_drill warning 1 "$restore_ok" "No successful restore drill has been recorded within eight days"

xero_unknown=$(printf "%s" "select count(*) from xero_send_attempts where state in ('sending', 'unknown') and last_attempt_at < now() - interval '10 minutes'" | compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' 2>/dev/null || printf 0)
case "$xero_unknown" in (*[!0-9]*) xero_unknown=0;; esac
if [ "$xero_unknown" -gt 0 ]; then xero_unknown_ok=false; else xero_unknown_ok=true; fi
observe xero-send-unknown xero_status critical 1 "$xero_unknown_ok" "$xero_unknown unresolved Xero send attempt(s) are older than ten minutes"

xero_poller_severity=$(printf "%s" "select severity from alert_incidents where resolved_at is null and dedupe_key = 'xero-status-poller' order by last_seen_at desc limit 1" | compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' 2>/dev/null || true)
if [ "$xero_poller_severity" = "warning" ]; then xero_polling_ok=false; else xero_polling_ok=true; fi
observe xero-polling-failed xero_status warning 1 "$xero_polling_ok" "Three consecutive Xero status polling cycles failed"
if [ "$xero_poller_severity" = "critical" ]; then xero_connection_ok=false; else xero_connection_ok=true; fi
observe xero-connection-failed xero_status critical 1 "$xero_connection_ok" "Xero connection or token refresh failed"

printf '[%s] Monitor completed.\n' "$(date --iso-8601=seconds)"
