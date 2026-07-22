#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/opt/ziffer-billing-v2}"
. "$APP_DIR/ops/common.sh"

target_sha=${1:-}
[ -n "$target_sha" ] || { printf 'Usage: %s <commit-sha>\n' "$0" >&2; exit 2; }
LOCK_FILE="/tmp/ziffer-deploy.lock"
DEPLOY_ENV="$APP_DIR/.deploy.env"
LOG_FILE="$APP_DIR/logs/deploy.log"
previous_image=""

mkdir -p "$APP_DIR/logs"
rotate_log "$LOG_FILE"
exec >>"$LOG_FILE" 2>&1
exec 9>"$LOCK_FILE"
flock -n 9 || { printf 'Another deployment is running.\n' >&2; exit 1; }

cd "$APP_DIR"
git fetch --prune origin
git cat-file -e "$target_sha^{commit}"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { printf 'Tracked server files are not clean.\n' >&2; exit 1; }
target_sha=$(git rev-parse "$target_sha^{commit}")
target_image="ziffer-billing:$target_sha"
[ ! -f "$DEPLOY_ENV" ] || previous_image=$(sed -n 's/^APP_IMAGE=//p' "$DEPLOY_ENV" | head -1)
if [ -z "$previous_image" ]; then
  current_app_container=$(compose ps -q app 2>/dev/null || true)
  [ -z "$current_app_container" ] || previous_image=$(docker inspect -f '{{.Config.Image}}' "$current_app_container" 2>/dev/null || true)
fi

failure() {
  code=$?
  record_operation deployment failed deploy "Deployment of $target_sha failed; inspect $LOG_FILE" "{\"commit\":\"$target_sha\"}"
  "$APP_DIR/ops/send-alert.sh" "[Ziffer] critical: Production deployment failed" "Deployment of $target_sha failed. Inspect $LOG_FILE." || true
  if [ -n "$previous_image" ] && docker image inspect "$previous_image" >/dev/null 2>&1; then
    printf 'APP_IMAGE=%s\n' "$previous_image" > "$DEPLOY_ENV"
    APP_IMAGE="$previous_image" docker compose -f "$COMPOSE_FILE" up -d --no-deps app || true
  fi
  exit "$code"
}
trap failure EXIT INT TERM

sh "$APP_DIR/ops/backup-predeploy.sh"
git checkout --detach "$target_sha"
docker build --label ziffer.release=true --label "ziffer.commit=$target_sha" -t "$target_image" .

APP_IMAGE="$target_image" docker compose -f "$COMPOSE_FILE" run --rm --no-deps app npm test
sh "$APP_DIR/ops/migration-preflight.sh" "$target_image"
APP_IMAGE="$target_image" docker compose -f "$COMPOSE_FILE" run --rm app npm run db:migrate
if [ -n "$previous_image" ]; then
  mkdir -p "$STATE_DIR"
  printf '%s\n' "$previous_image" > "$STATE_DIR/previous-deploy-image"
  chmod 600 "$STATE_DIR/previous-deploy-image"
fi
printf 'APP_IMAGE=%s\n' "$target_image" > "$DEPLOY_ENV"
chmod 600 "$DEPLOY_ENV"
APP_IMAGE="$target_image" docker compose -f "$COMPOSE_FILE" up -d --no-deps app

attempt=0
until curl --fail --silent --max-time 10 https://app.ziffer.lu/api/health/ready >/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 18 ] || { printf 'Candidate failed readiness.\n' >&2; exit 1; }
  sleep 5
done

record_operation deployment complete deploy "" "{\"commit\":\"$target_sha\",\"image\":\"$target_image\"}"
docker images --filter label=ziffer.release=true --format '{{.Repository}}:{{.Tag}} {{.CreatedAt}}' | sort -rk2 | awk 'NR>5 {print $1}' | xargs -r docker image rm >/dev/null 2>&1 || true
printf '[%s] Deployed %s.\n' "$(date --iso-8601=seconds)" "$target_sha"
trap - EXIT INT TERM
