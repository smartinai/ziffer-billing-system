#!/bin/sh
set -eu

APP_DIR="/opt/ziffer-billing-v2"
LOG_DIR="$APP_DIR/logs"
LOG_FILE="$LOG_DIR/teamwork-sync.log"
LOCK_FILE="/tmp/ziffer-teamwork-sync.lock"

mkdir -p "$LOG_DIR"

if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE")" -gt 5242880 ]; then
  index=4
  while [ "$index" -ge 1 ]; do
    if [ -f "$LOG_FILE.$index" ]; then
      mv "$LOG_FILE.$index" "$LOG_FILE.$((index + 1))"
    fi
    index=$((index - 1))
  done
  mv "$LOG_FILE" "$LOG_FILE.1"
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

exec >>"$LOG_FILE" 2>&1
printf '\n[%s] Starting scheduled Teamwork sync\n' "$(date --iso-8601=seconds)"
cd "$APP_DIR"
docker compose -f docker-compose.production.yml run --rm app npm run sync:teamwork:scheduled
printf '[%s] Scheduled Teamwork sync completed\n' "$(date --iso-8601=seconds)"
