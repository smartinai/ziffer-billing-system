#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/opt/ziffer-billing-v2}"
. "$APP_DIR/ops/common.sh"

component=${1:-}
case "$component" in
  app) operation_type=app_health ;;
  backup) operation_type=backup ;;
  teamwork) operation_type=teamwork_sync ;;
  xero) operation_type=xero_status ;;
  disk) operation_type=disk ;;
  deployment) operation_type=deployment ;;
  *) printf 'Usage: %s app|backup|teamwork|xero|disk|deployment\n' "$0" >&2; exit 2 ;;
esac

key="simulation-$component-$(date +%s)"
summary="Simulated $component failure"

incident_action() {
  action=$1
  compose exec -T \
    -e "INCIDENT_ACTION=$action" \
    -e "INCIDENT_KEY=$key" \
    -e "INCIDENT_COMPONENT=$operation_type" \
    -e INCIDENT_SEVERITY=warning \
    -e "INCIDENT_SUMMARY=$summary" \
    app node scripts/record-incident.mjs >/dev/null
}

# Observe the same failure twice to prove the open incident is deduplicated.
incident_action open
incident_action open
"$APP_DIR/ops/send-alert.sh" "[Ziffer] simulation: $summary" "This is a controlled Ziffer alert test. No production service was interrupted."
incident_action notify

"$APP_DIR/ops/send-alert.sh" "[Ziffer] simulation recovered: $component" "The controlled $component alert simulation has recovered."
incident_action recovery
incident_action resolve
record_operation "$operation_type" complete manual "" "{\"simulation\":true,\"dedupeKey\":\"$key\"}"

printf 'Simulated %s failure and recovery using dedupe key %s.\n' "$component" "$key"
