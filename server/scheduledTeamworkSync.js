import { recordAuditEvent } from "./auditRepository.js";
import { config } from "./config.js";
import { runIncrementalTeamworkSync } from "./reportingService.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scheduledErrorMessage(error) {
  if (error?.code === "TEAMWORK_SYNC_IN_PROGRESS") return "Another Teamwork sync was already running.";
  if (error?.code === "TEAMWORK_SYNC_PARTIAL") return "Teamwork returned incomplete data.";
  return "Teamwork synchronization failed. Check the server sync log for details.";
}

export async function runScheduledTeamworkSync({
  attempts = config.teamworkScheduledSyncAttempts,
  delay = wait,
  retryDelayMs = config.teamworkScheduledSyncRetryMs,
  sync = runIncrementalTeamworkSync,
  record = recordAuditEvent
} = {}) {
  const totalAttempts = Math.max(1, Number(attempts || 1));
  let lastError = null;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const store = await sync({ attempt, trigger: "scheduled" });
      await record({
        action: "teamwork_sync_scheduled_success",
        actor: "system",
        entityId: store?.database?.syncRunId || "",
        entityType: "teamwork_sync",
        metadata: {
          attempt,
          coverageEnd: store?.coverageEnd || "",
          coverageStart: store?.coverageStart || "",
          summary: `Scheduled Teamwork sync completed on attempt ${attempt}`
        }
      });
      return { attempt, store };
    } catch (error) {
      lastError = error;
      console.error(`Scheduled Teamwork sync attempt ${attempt}/${totalAttempts} failed: ${error.message}`);
      if (attempt < totalAttempts) await delay(retryDelayMs);
    }
  }

  const message = scheduledErrorMessage(lastError);
  await record({
    action: "teamwork_sync_scheduled_failure",
    actor: "system",
    entityType: "teamwork_sync",
    metadata: {
      attempts: totalAttempts,
      message,
      summary: `Scheduled Teamwork sync failed after ${totalAttempts} attempts`
    }
  });
  throw lastError || new Error(message);
}

export const scheduledTeamworkSyncTestHooks = {
  scheduledErrorMessage
};
