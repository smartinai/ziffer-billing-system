#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/opt/ziffer-billing-v2}"
. "$APP_DIR/ops/common.sh"

image=${1:-}
dump=${2:-}
[ -n "$image" ] || { printf 'Usage: %s <candidate-image> [validated-dump]\n' "$0" >&2; exit 2; }

if [ -z "$dump" ]; then
  dump=$(find "${BACKUP_DIR:-/opt/ziffer-backups/daily}" -maxdepth 1 -type f -name 'ziffer-*.dump' -printf '%T@ %p\n' | sort -nr | awk 'NR==1 {$1=""; sub(/^ /, ""); print}')
fi
[ -f "$dump" ] || { printf 'Validated migration preflight dump not found.\n' >&2; exit 1; }
[ -f "$dump.sha256" ] || { printf 'Migration preflight checksum is missing.\n' >&2; exit 1; }
verify_sha256 "$dump" "$dump.sha256"

suffix=$(date +%s)
network="ziffer-migration-preflight-$suffix"
database="ziffer-migration-preflight-db-$suffix"

cleanup() {
  docker rm -f "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker network create --internal "$network" >/dev/null
docker run -d --name "$database" --network "$network" \
  -e POSTGRES_DB=ziffer_preflight \
  -e POSTGRES_USER=ziffer_preflight \
  -e POSTGRES_PASSWORD=ziffer_preflight_only \
  postgres:17-alpine >/dev/null

attempt=0
until docker exec "$database" pg_isready -U ziffer_preflight -d ziffer_preflight >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 30 ] || { printf 'Migration preflight PostgreSQL did not become ready.\n' >&2; exit 1; }
  sleep 1
done

docker cp "$dump" "$database:/tmp/ziffer.dump"
docker exec "$database" pg_restore -U ziffer_preflight -d ziffer_preflight --no-owner --no-privileges /tmp/ziffer.dump

docker run --rm --network "$network" \
  -e DATABASE_URL="postgres://ziffer_preflight:ziffer_preflight_only@$database:5432/ziffer_preflight" \
  -e DATABASE_SSL=false \
  "$image" npm run db:migrate

docker exec "$database" psql -v ON_ERROR_STOP=1 -U ziffer_preflight -d ziffer_preflight -Atc \
  "select count(*) from schema_migrations; select count(*) from app_users; select count(*) from quote_previews;" >/dev/null
printf '[%s] Candidate migrations passed against an isolated restored database.\n' "$(date --iso-8601=seconds)"
