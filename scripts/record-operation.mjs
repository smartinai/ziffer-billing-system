import { recordAuditEvent } from "../server/auditRepository.js";
import { recordOperationRun } from "../server/operationsRepository.js";

let metadata = {};
try { metadata = JSON.parse(process.env.OPERATION_METADATA || "{}"); } catch { metadata = {}; }

const operation = await recordOperationRun({
  operationType: process.env.OPERATION_TYPE,
  status: process.env.OPERATION_STATUS || "complete",
  trigger: process.env.OPERATION_TRIGGER || "scheduled",
  errorMessage: process.env.OPERATION_ERROR || "",
  finishedAt: new Date(),
  metadata
});

if (["deployment", "rollback"].includes(operation.operationType) && metadata.simulation !== true) {
  await recordAuditEvent({
    action: `production_${operation.operationType}_${operation.status}`,
    actor: "system",
    entityId: operation.id,
    entityType: "operation_run",
    metadata: {
      ...metadata,
      summary: `${operation.operationType === "deployment" ? "Production deployment" : "Production rollback"} ${operation.status}`
    }
  });
}

process.stdout.write(`${operation.id}\n`);
