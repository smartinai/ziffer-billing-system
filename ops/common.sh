#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/opt/ziffer-billing-v2}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
STATE_DIR="${STATE_DIR:-/var/lib/ziffer-monitor}"

compose() {
  docker compose -f "$APP_DIR/$COMPOSE_FILE" "$@"
}

record_operation() {
  operation_type=$1
  status=$2
  trigger=${3:-scheduled}
  error_message=${4:-}
  metadata=${5:-}
  [ -n "$metadata" ] || metadata='{}'
  compose exec -T \
    -e "OPERATION_TYPE=$operation_type" \
    -e "OPERATION_STATUS=$status" \
    -e "OPERATION_TRIGGER=$trigger" \
    -e "OPERATION_ERROR=$error_message" \
    -e "OPERATION_METADATA=$metadata" \
    app node scripts/record-operation.mjs >/dev/null 2>&1 || true
}

rotate_log() {
  log_file=$1
  max_bytes=${2:-5242880}
  mkdir -p "$(dirname "$log_file")"
  if [ -f "$log_file" ] && [ "$(wc -c < "$log_file")" -gt "$max_bytes" ]; then
    index=4
    while [ "$index" -ge 1 ]; do
      [ ! -f "$log_file.$index" ] || mv "$log_file.$index" "$log_file.$((index + 1))"
      index=$((index - 1))
    done
    mv "$log_file" "$log_file.1"
  fi
}

verify_sha256() {
  file=$1
  checksum_file=$2
  [ -f "$file" ] || { printf 'Checksum target is missing: %s\n' "$file" >&2; return 1; }
  [ -f "$checksum_file" ] || { printf 'Checksum file is missing: %s\n' "$checksum_file" >&2; return 1; }

  expected=$(awk 'NR == 1 { print $1 }' "$checksum_file")
  actual=$(sha256sum "$file" | awk '{ print $1 }')
  [ -n "$expected" ] && [ "$actual" = "$expected" ] || {
    printf 'Checksum validation failed for %s.\n' "$file" >&2
    return 1
  }
}
