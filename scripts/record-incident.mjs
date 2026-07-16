import { markIncidentNotificationByKey, openAlertIncident, resolveAlertIncident } from "../server/operationsRepository.js";

const action = process.env.INCIDENT_ACTION || "open";
const dedupeKey = process.env.INCIDENT_KEY || "";
const incident = action === "resolve"
  ? await resolveAlertIncident(dedupeKey)
  : ["notify", "reminder", "recovery"].includes(action)
    ? await markIncidentNotificationByKey(dedupeKey, { recovery: action === "recovery", reminder: action === "reminder" })
    : await openAlertIncident({
      dedupeKey,
      component: process.env.INCIDENT_COMPONENT || "app_health",
      severity: process.env.INCIDENT_SEVERITY || "warning",
      summary: process.env.INCIDENT_SUMMARY || "Operational check failed"
      });

process.stdout.write(`${incident?.id || ""}\n`);
