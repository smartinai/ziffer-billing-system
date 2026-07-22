#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/opt/ziffer-billing-v2}"
. "$APP_DIR/ops/common.sh"

LOG_FILE="$APP_DIR/logs/xero-reconciliation.log"
mkdir -p "$APP_DIR/logs"
rotate_log "$LOG_FILE"
exec >>"$LOG_FILE" 2>&1
exec 9>"/tmp/ziffer-xero-reconciliation.lock"
flock -n 9 || exit 0

compose run --rm app node scripts/reconcile-xero-sends.mjs
