#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/opt/ziffer-billing-v2}"
. "$APP_DIR/ops/common.sh"

target_ref=${1:-}
[ -n "$target_ref" ] || { printf 'Usage: %s <previous-commit-sha-or-image>\n' "$0" >&2; exit 2; }
case "$target_ref" in
  *:*|*/*) target_image="$target_ref" ;;
  *) target_image="ziffer-billing:$target_ref" ;;
esac
DEPLOY_ENV="$APP_DIR/.deploy.env"
docker image inspect "$target_image" >/dev/null 2>&1 || { printf 'Image %s is not retained on this host.\n' "$target_image" >&2; exit 1; }

exec 9>"/tmp/ziffer-deploy.lock"
flock -n 9 || { printf 'A deploy or rollback is already running.\n' >&2; exit 1; }
printf 'APP_IMAGE=%s\n' "$target_image" > "$DEPLOY_ENV"
chmod 600 "$DEPLOY_ENV"
APP_IMAGE="$target_image" compose up -d --no-deps app

attempt=0
until curl --fail --silent --max-time 10 https://app.ziffer.lu/api/health/ready >/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 18 ]; then
    record_operation rollback failed deploy "Rollback to $target_ref failed readiness" "{\"target\":\"$target_ref\"}"
    "$APP_DIR/ops/send-alert.sh" "[Ziffer] critical: Production rollback failed" "Rollback to $target_ref failed readiness. Immediate operator action is required." || true
    exit 1
  fi
  sleep 5
done

record_operation rollback complete deploy "" "{\"target\":\"$target_ref\",\"image\":\"$target_image\"}"
printf '[%s] Rolled back application image to %s.\n' "$(date --iso-8601=seconds)" "$target_image"
