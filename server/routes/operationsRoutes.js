import { Router } from "express";
import { recordAuditEvent } from "../auditRepository.js";
import { requireAuth, requireCsrf, requireRole } from "../auth.js";
import { operationsEmailConfigured, sendOperationsEmail } from "../mailer.js";
import { getOperationsOverview, recordOperationRun } from "../operationsRepository.js";

export const operationsRouter = Router();

operationsRouter.use(requireAuth, requireRole("admin"));

operationsRouter.get("/", async (req, res, next) => {
  try {
    const payload = await getOperationsOverview({ limit: req.query.limit });
    res.json({ ...payload, emailConfigured: operationsEmailConfigured() });
  } catch (error) {
    next(error);
  }
});

operationsRouter.post("/test-alert", requireCsrf, async (req, res, next) => {
  const startedAt = new Date();
  try {
    const result = await sendOperationsEmail({
      subject: "[Ziffer] Test operational alert",
      text: `This is a test operational alert requested by ${req.user.email || req.user.name || "an administrator"} at ${startedAt.toISOString()}.`
    });
    const run = await recordOperationRun({
      operationType: "app_health",
      trigger: "manual",
      status: "complete",
      startedAt,
      finishedAt: new Date(),
      createdBy: req.user.userId,
      metadata: { recipientCount: result.recipients.length, testAlert: true }
    });
    await recordAuditEvent({
      action: "operations_test_alert",
      actor: req.user,
      entityId: run.id,
      entityType: "operation_run",
      metadata: { recipientCount: result.recipients.length, summary: "Sent an operational test alert" }
    });
    res.json({ ok: true, recipientCount: result.recipients.length, run });
  } catch (error) {
    try {
      await recordOperationRun({
        operationType: "app_health",
        trigger: "manual",
        status: "failed",
        startedAt,
        finishedAt: new Date(),
        createdBy: req.user.userId,
        errorMessage: error.message,
        metadata: { testAlert: true }
      });
    } catch {
      // Preserve the original mail/configuration failure.
    }
    next(error);
  }
});
