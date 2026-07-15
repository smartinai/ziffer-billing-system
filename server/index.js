import cookieParser from "cookie-parser";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listAuditEvents, recordAuditEvent } from "./auditRepository.js";
import { listAnnualInvoices, updateAnnualInvoiceUsage } from "./annualInvoiceRepository.js";
import { csrfTokenHandler, loginHandler, loginRateLimit, logoutHandler, requireAuth, requireCsrf, sessionHandler, updateAccountHandler } from "./auth.js";
import { listBillingClients, updateBillingClient } from "./billingClientRepository.js";
import { getBillingQuoteDetail, listBillingQuotes, startXeroStatusPoller, syncXeroDocumentStatuses } from "./billingQuoteRepository.js";
import { config } from "./config.js";
import { checkDatabase } from "./db.js";
import {
  acquireQuoteDraftLock,
  archiveQuoteDraft,
  createQuotePreview,
  getArchivedQuoteDraft,
  listQuoteDrafts,
  releaseQuoteDraftLocksForSession,
  renewQuoteDraftLock,
  restoreQuoteDraft,
  sendQuotePreviewToXero,
  updateQuotePreviewMetadata,
  updateQuotePreviewTimeEntryBillable
} from "./quotePreviewRepository.js";
import { getReportingSummary, getSourceStatus, refreshStoredReportingSummary } from "./reportingService.js";
import { securityHeaders } from "./securityHeaders.js";
import {
  buildXeroAuthorizationUrl,
  createXeroOAuthState,
  disconnectXero,
  getXeroConnectionStatus,
  handleXeroCallback,
  XERO_STATE_COOKIE
} from "./xeroClient.js";
import { getXeroReference, syncXeroReferenceData } from "./xeroReferenceRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);
const app = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(securityHeaders({ isProduction: config.isProduction }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "ziffer-reporting" });
});

app.get("/api/health/db", async (_req, res) => {
  const status = await checkDatabase();
  res.status(status.ok ? 200 : 503).json(status);
});

app.get("/api/auth/session", sessionHandler);
app.get("/api/auth/csrf", requireAuth, csrfTokenHandler);
app.post("/api/auth/login", loginRateLimit, loginHandler);
app.post("/api/auth/logout", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    await releaseQuoteDraftLocksForSession(req.user.userId, req.body?.editorSessionId);
    await logoutHandler(req, res);
  } catch (error) {
    next(error);
  }
});
app.patch("/api/auth/account", requireAuth, requireCsrf, updateAccountHandler);

function parseDateRange(req, res) {
  const startDate = String(req.query.startDate || config.defaultStartDate);
  const endDate = String(req.query.endDate || new Date().toISOString().slice(0, 10));
  const validDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!validDate.test(startDate) || !validDate.test(endDate) || startDate > endDate) {
    res.status(400).json({ message: "Use a valid startDate and endDate in YYYY-MM-DD format." });
    return null;
  }
  return { endDate, startDate };
}

app.get("/api/reporting/source-status", requireAuth, (_req, res) => {
  res.json(getSourceStatus());
});

app.get("/api/reporting/summary", requireAuth, async (req, res, next) => {
  try {
    const range = parseDateRange(req, res);
    if (!range) return;
    res.json(await getReportingSummary(range.startDate, range.endDate));
  } catch (error) {
    next(error);
  }
});

app.post("/api/reporting/refresh", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const range = parseDateRange(req, res);
    if (!range) return;
    const payload = await refreshStoredReportingSummary(range.startDate, range.endDate);
    await recordAuditEvent({
      action: "teamwork_sync_refresh",
      actor: req.user,
      entityType: "teamwork_sync",
      metadata: {
        endDate: range.endDate,
        startDate: range.startDate,
        summary: `Teamwork refreshed ${range.startDate} to ${range.endDate}`
      }
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/billing/clients", requireAuth, async (_req, res, next) => {
  try {
    res.json({ clients: await listBillingClients() });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/billing/clients/:id", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const client = await updateBillingClient(req.params.id, req.body);
    await recordAuditEvent({
      action: "billing_client_update",
      actor: req.user,
      entityId: req.params.id,
      entityType: "billing_client",
      metadata: {
        clientName: client.displayName,
        status: client.status,
        summary: `Updated billing client ${client.displayName}`
      }
    });
    res.json({ client });
  } catch (error) {
    next(error);
  }
});

app.get("/api/billing/annual-invoices", requireAuth, async (req, res, next) => {
  try {
    res.json(await listAnnualInvoices(req.query.year));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/billing/annual-invoices", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const usage = await updateAnnualInvoiceUsage(req.body);
    await recordAuditEvent({
      action: "annual_invoice_update",
      actor: req.user,
      entityId: usage.usageId,
      entityType: "annual_invoice_usage",
      metadata: {
        annualHours: usage.annualHours,
        billingClientId: usage.billingClientId,
        clientName: usage.clientName,
        serviceId: usage.serviceId,
        serviceName: usage.serviceName,
        summary: `Updated annual invoice usage for ${usage.clientName || "client"} / ${usage.serviceName || "service"} / ${usage.year}`,
        usedHours: usage.usedHours,
        year: usage.year
      }
    });
    res.json({ usage });
  } catch (error) {
    next(error);
  }
});

app.get("/api/audit-events", requireAuth, async (req, res, next) => {
  try {
    res.json(await listAuditEvents({
      action: req.query.action,
      actor: req.query.actor,
      entityType: req.query.entityType
    }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/billing/quotes", requireAuth, async (_req, res, next) => {
  try {
    res.json(await listBillingQuotes());
  } catch (error) {
    next(error);
  }
});

app.get("/api/billing/quotes/:id", requireAuth, async (req, res, next) => {
  try {
    res.json(await getBillingQuoteDetail(req.params.id));
  } catch (error) {
    next(error);
  }
});

app.post("/api/billing/quotes/sync-xero-status", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const payload = await syncXeroDocumentStatuses();
    await recordAuditEvent({
      action: "xero_status_refresh",
      actor: req.user,
      entityType: "xero_document",
      metadata: {
        failed: payload.failed,
        skipped: payload.skipped,
        summary: `Refreshed Xero status for ${payload.total} document${payload.total === 1 ? "" : "s"}: ${payload.synced} synced, ${payload.failed} failed`,
        synced: payload.synced,
        total: payload.total
      }
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/billing/quotes/:id/sync-xero-status", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const payload = await syncXeroDocumentStatuses({ quoteId: req.params.id });
    await recordAuditEvent({
      action: "xero_status_refresh",
      actor: req.user,
      entityId: req.params.id,
      entityType: "xero_document",
      metadata: {
        failed: payload.failed,
        skipped: payload.skipped,
        summary: "Refreshed Xero status for document",
        synced: payload.synced,
        total: payload.total
      }
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/billing/quote-previews", requireAuth, async (req, res, next) => {
  try {
    res.json(await listQuoteDrafts({ editorSessionId: req.query.editorSessionId }));
  } catch (error) {
    next(error);
  }
});

app.get("/api/billing/quote-previews/:id", requireAuth, async (req, res, next) => {
  try {
    res.json(await getArchivedQuoteDraft(req.params.id));
  } catch (error) {
    next(error);
  }
});

app.post("/api/billing/quote-previews/:id/editor-lock", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    res.json(await acquireQuoteDraftLock(req.params.id, req.body || {}, req.user));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/billing/quote-previews/:id/editor-lock", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    res.json(await renewQuoteDraftLock(req.params.id, req.body || {}, req.user));
  } catch (error) {
    next(error);
  }
});

app.post("/api/billing/quote-previews", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const payload = await createQuotePreview(req.body, req.user);
    await recordAuditEvent({
      action: "document_preview_create",
      actor: req.user,
      entityId: payload.preview?.id,
      entityType: "quote_preview",
      metadata: {
        billingClientId: req.body?.billingClientId,
        clientName: payload.preview?.billingClient?.displayName,
        endDate: req.body?.endDate,
        startDate: req.body?.startDate,
        summary: `Created document preview for ${payload.preview?.billingClient?.displayName || "client"}`
      }
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/billing/quote-previews/:id", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const payload = await updateQuotePreviewMetadata(req.params.id, req.body, req.user);
    const lineUpdates = Array.isArray(req.body?.lines) ? req.body.lines : [];
    await recordAuditEvent({
      action: lineUpdates.length ? "document_rows_update" : "document_metadata_update",
      actor: req.user,
      entityId: req.params.id,
      entityType: "quote_preview",
      metadata: {
        documentNumber: payload.preview?.quoteNumber,
        lineUpdateCount: lineUpdates.length,
        manualRowsAdded: lineUpdates.filter((line) => line && !line.id).length,
        summary: lineUpdates.length
          ? `${lineUpdates.filter((line) => line && !line.id).length ? `Added ${lineUpdates.filter((line) => line && !line.id).length} manual row${lineUpdates.filter((line) => line && !line.id).length === 1 ? "" : "s"} to ` : `Updated ${lineUpdates.length} document row${lineUpdates.length === 1 ? "" : "s"} on `}${payload.preview?.quoteNumber || "document"}`
          : `Updated document metadata ${payload.preview?.quoteNumber || ""}`.trim()
      }
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/billing/quote-previews/:id/time-entries/:entryId", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const payload = await updateQuotePreviewTimeEntryBillable(req.params.id, {
      editorSessionId: req.body?.editorSessionId,
      entryId: req.params.entryId,
      isBillable: req.body?.isBillable,
      version: req.body?.version
    }, req.user);
    await recordAuditEvent({
      action: "time_entry_billable_update",
      actor: req.user,
      entityId: req.params.entryId,
      entityType: "teamwork_time_entry",
      metadata: {
        isBillable: req.body?.isBillable,
        quotePreviewId: req.params.id,
        summary: `Marked time entry ${req.params.entryId} ${req.body?.isBillable ? "billable" : "unbillable"}`
      }
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/billing/quote-previews/:id/send-to-xero", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const payload = await sendQuotePreviewToXero(req.params.id, req.body || {}, req.user);
    await recordAuditEvent({
      action: "send_to_xero",
      actor: req.user,
      entityId: payload.xero?.xeroQuoteLogId || req.params.id,
      entityType: "xero_document",
      metadata: {
        clientName: payload.preview?.billingClient?.displayName,
        documentNumber: payload.preview?.quoteNumber,
        documentType: payload.xero?.documentType,
        lineCount: payload.xero?.lineCount,
        mode: payload.xero?.mode,
        status: payload.xero?.status,
        sentAmount: payload.preview?.amount,
        summary: `Sent ${payload.xero?.documentLabel || "document"} ${payload.preview?.quoteNumber || ""} to Xero for ${payload.preview?.billingClient?.displayName || "client"} (${payload.preview?.amount ?? 0} EUR)`.trim()
      }
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/billing/quote-previews/:id/time-entries", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const entryIds = Array.isArray(req.body?.entryIds) ? req.body.entryIds : [];
    const payload = await updateQuotePreviewTimeEntryBillable(req.params.id, {
      editorSessionId: req.body?.editorSessionId,
      entryIds,
      isBillable: req.body?.isBillable,
      version: req.body?.version
    }, req.user);
    await recordAuditEvent({
      action: "time_entry_billable_update",
      actor: req.user,
      entityId: req.params.id,
      entityType: "quote_preview",
      metadata: {
        entryCount: entryIds.length,
        isBillable: req.body?.isBillable,
        quotePreviewId: req.params.id,
        summary: `Marked ${entryIds.length} task time ${entryIds.length === 1 ? "entry" : "entries"} ${req.body?.isBillable ? "billable" : "unbillable"}`
      }
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/billing/quote-previews/:id/archive", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const payload = await archiveQuoteDraft(req.params.id, req.body || {}, req.user);
    await recordAuditEvent({
      action: "document_draft_archive",
      actor: req.user,
      entityId: req.params.id,
      entityType: "quote_preview",
      metadata: { summary: `Archived document draft ${req.params.id}` }
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/billing/quote-previews/:id/restore", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const payload = await restoreQuoteDraft(req.params.id, req.body || {}, req.user);
    await recordAuditEvent({
      action: "document_draft_restore",
      actor: req.user,
      entityId: req.params.id,
      entityType: "quote_preview",
      metadata: { summary: `Restored document draft ${payload.preview?.quoteNumber || req.params.id}` }
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/xero/reference", requireAuth, async (req, res, next) => {
  try {
    res.json(await getXeroReference({
      force: req.query.force === "true",
      sync: req.query.sync !== "false"
    }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/xero/reference/sync", requireAuth, requireCsrf, async (_req, res, next) => {
  try {
    await syncXeroReferenceData({ force: true });
    res.json(await getXeroReference());
  } catch (error) {
    next(error);
  }
});

app.get("/api/xero/status", requireAuth, async (_req, res, next) => {
  try {
    res.json(await getXeroConnectionStatus());
  } catch (error) {
    next(error);
  }
});

app.get("/api/xero/connect", requireAuth, (req, res, next) => {
  try {
    const state = createXeroOAuthState(req.user);
    res.cookie(XERO_STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: 10 * 60 * 1000,
      sameSite: "lax",
      secure: config.cookieSecure
    });
    res.redirect(buildXeroAuthorizationUrl(state));
  } catch (error) {
    next(error);
  }
});

function xeroReturnUrl(params = {}) {
  const url = new URL(config.xeroReturnUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }
  return url.toString();
}

app.get("/api/xero/callback", async (req, res, next) => {
  try {
    const payload = await handleXeroCallback({
      code: req.query.code,
      expectedState: req.cookies?.[XERO_STATE_COOKIE],
      state: req.query.state
    });
    await recordAuditEvent({
      action: "xero_connect",
      actor: payload?.actor || "unknown",
      entityType: "xero_connection",
      metadata: {
        summary: `Connected Xero${payload?.tenantName ? `: ${payload.tenantName}` : ""}`,
        tenantName: payload?.tenantName || ""
      }
    });
    res.clearCookie(XERO_STATE_COOKIE);
    res.redirect(xeroReturnUrl({ xero: "connected" }));
  } catch (error) {
    res.clearCookie(XERO_STATE_COOKIE);
    if (res.headersSent) return next(error);
    const message = error.message || "Xero connection failed.";
    res.redirect(xeroReturnUrl({ message, xero: "error" }));
  }
});

app.post("/api/xero/disconnect", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const payload = await disconnectXero();
    await recordAuditEvent({
      action: "xero_disconnect",
      actor: req.user,
      entityType: "xero_connection",
      metadata: { summary: "Disconnected Xero" }
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

const distDir = path.resolve(__dirname, "../dist");
app.use(express.static(distDir));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(distDir, "index.html"), (error) => {
    if (error) next();
  });
});

app.use((error, _req, res, _next) => {
  console.error(error.message);
  res.status(error.statusCode || 500).json({
    code: error.code || undefined,
    details: error.details || undefined,
    message: error.message || "Unexpected server error."
  });
});

export { app };

export function startServer() {
  return app.listen(config.port, () => {
    console.log(`Ziffer reporting server listening on http://127.0.0.1:${config.port}`);
    startXeroStatusPoller({ intervalMs: config.xeroStatusPollIntervalMs });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer();
}
