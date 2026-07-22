import { closeDatabase } from "../server/db.js";
import { recordOperationRun } from "../server/operationsRepository.js";
import { reconcileStaleXeroSendAttempts } from "../server/quotePreviewRepository.js";

const startedAt = new Date();
try {
  const result = await reconcileStaleXeroSendAttempts();
  const failures = result.outcomes.filter((outcome) => outcome.status === "failed");
  await recordOperationRun({
    operationType: "xero_status",
    trigger: "scheduled",
    status: failures.length ? "warning" : "complete",
    startedAt,
    finishedAt: new Date(),
    errorMessage: failures.length ? `${failures.length} Xero send reconciliation attempt(s) failed.` : "",
    metadata: { checked: result.checked, failures: failures.length, inProgress: result.inProgress }
  });
  console.log(JSON.stringify({ ...result, failures: failures.length }));
  if (failures.length) process.exitCode = 1;
} catch (error) {
  await recordOperationRun({
    operationType: "xero_status",
    trigger: "scheduled",
    status: "failed",
    startedAt,
    finishedAt: new Date(),
    errorMessage: error.message
  }).catch(() => undefined);
  console.error(error.message || "Xero reconciliation failed.");
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
