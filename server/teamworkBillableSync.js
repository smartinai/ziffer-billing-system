import { recordAuditEvent } from "./auditRepository.js";
import { updateTimeEntriesBillable } from "./teamworkClient.js";
import { updateStoredTimeEntriesBillable } from "./teamworkRepository.js";

export async function syncBillableStateToTeamwork(input, dependencies = {}) {
  const updateRemote = dependencies.updateRemote || updateTimeEntriesBillable;
  const updateStored = dependencies.updateStored || updateStoredTimeEntriesBillable;
  const recordAudit = dependencies.recordAudit || recordAuditEvent;
  const logError = dependencies.logError || console.error;
  const entryIds = [...new Set((input.entryIds || []).map((value) => String(value || "").trim()).filter(Boolean))];
  const result = await updateRemote(entryIds, input.isBillable);

  if (result.updatedEntryIds.length) {
    await updateStored(result.updatedEntryIds, input.isBillable);
  }

  if (!result.failures.length) {
    return {
      failedEntryIds: [],
      ok: true,
      updatedCount: result.updatedEntryIds.length
    };
  }

  const failedEntryIds = result.failures.map((failure) => failure.entryId);
  const summary = `Teamwork billable update failed for ${failedEntryIds.length} of ${entryIds.length} time ${entryIds.length === 1 ? "entry" : "entries"}`;
  logError(
    `${summary} on draft ${input.quotePreviewId}: ${result.failures
      .map((failure) => `${failure.entryId}: ${failure.message}`)
      .join("; ")}`
  );
  await recordAudit({
    action: "teamwork_billable_sync_error",
    actor: input.actor,
    entityId: input.quotePreviewId,
    entityType: "quote_preview",
    metadata: {
      failedEntryIds,
      failureMessages: result.failures.map((failure) => failure.message),
      isBillable: Boolean(input.isBillable),
      summary,
      updatedEntryIds: result.updatedEntryIds
    }
  });

  return {
    failedEntryIds,
    ok: false,
    updatedCount: result.updatedEntryIds.length
  };
}
