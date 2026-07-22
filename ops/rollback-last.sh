#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/opt/ziffer-billing-v2}"
. "$APP_DIR/ops/common.sh"

marker="$STATE_DIR/previous-deploy-image"
[ -r "$marker" ] || { printf 'No previous deployment image is recorded.\n' >&2; exit 1; }
target_image=$(cat "$marker")
record_operation deployment failed deploy "Post-deployment browser smoke failed; rolling back to $target_image" "{\"rollbackImage\":\"$target_image\"}"
"$APP_DIR/ops/send-alert.sh" "[Ziffer] critical: Production browser smoke failed" "The approved release failed its post-deployment browser smoke and is rolling back to $target_image." || true
exec sh "$APP_DIR/ops/rollback.sh" "$target_image"
