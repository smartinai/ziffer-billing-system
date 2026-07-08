import cookieParser from "cookie-parser";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listAnnualInvoices, updateAnnualInvoiceUsage } from "./annualInvoiceRepository.js";
import { loginHandler, logoutHandler, requireAuth, sessionHandler } from "./auth.js";
import { listBillingClients, updateBillingClient } from "./billingClientRepository.js";
import { getBillingQuoteDetail, listBillingQuotes, startXeroStatusPoller, syncXeroDocumentStatuses } from "./billingQuoteRepository.js";
import { config } from "./config.js";
import { checkDatabase } from "./db.js";
import { createQuotePreview, sendQuotePreviewToXero, updateQuotePreviewMetadata, updateQuotePreviewTimeEntryBillable } from "./quotePreviewRepository.js";
import { getReportingSummary, getSourceStatus, refreshStoredReportingSummary } from "./reportingService.js";
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
const app = express();

app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "ziffer-reporting" });
});

app.get("/api/health/db", async (_req, res) => {
  const status = await checkDatabase();
  res.status(status.ok ? 200 : 503).json(status);
});

app.get("/api/auth/session", sessionHandler);
app.post("/api/auth/login", loginHandler);
app.post("/api/auth/logout", logoutHandler);

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

app.post("/api/reporting/refresh", requireAuth, async (req, res, next) => {
  try {
    const range = parseDateRange(req, res);
    if (!range) return;
    res.json(await refreshStoredReportingSummary(range.startDate, range.endDate));
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

app.patch("/api/billing/clients/:id", requireAuth, async (req, res, next) => {
  try {
    res.json({ client: await updateBillingClient(req.params.id, req.body) });
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

app.patch("/api/billing/annual-invoices", requireAuth, async (req, res, next) => {
  try {
    res.json({ usage: await updateAnnualInvoiceUsage(req.body) });
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

app.post("/api/billing/quotes/:id/sync-xero-status", requireAuth, async (req, res, next) => {
  try {
    res.json(await syncXeroDocumentStatuses({ quoteId: req.params.id }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/billing/quote-previews", requireAuth, async (req, res, next) => {
  try {
    res.json(await createQuotePreview(req.body));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/billing/quote-previews/:id", requireAuth, async (req, res, next) => {
  try {
    res.json(await updateQuotePreviewMetadata(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/billing/quote-previews/:id/time-entries/:entryId", requireAuth, async (req, res, next) => {
  try {
    res.json(await updateQuotePreviewTimeEntryBillable(req.params.id, {
      entryId: req.params.entryId,
      isBillable: req.body?.isBillable
    }));
  } catch (error) {
    next(error);
  }
});

app.post("/api/billing/quote-previews/:id/send-to-xero", requireAuth, async (req, res, next) => {
  try {
    res.json(await sendQuotePreviewToXero(req.params.id, req.body || {}));
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

app.post("/api/xero/reference/sync", requireAuth, async (_req, res, next) => {
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
    const state = createXeroOAuthState();
    res.cookie(XERO_STATE_COOKIE, state, {
      httpOnly: true,
      maxAge: 10 * 60 * 1000,
      sameSite: "lax",
      secure: false
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
    await handleXeroCallback({
      code: req.query.code,
      expectedState: req.cookies?.[XERO_STATE_COOKIE],
      state: req.query.state
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

app.post("/api/xero/disconnect", requireAuth, async (_req, res, next) => {
  try {
    res.json(await disconnectXero());
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
    message: error.message || "Unexpected server error."
  });
});

app.listen(config.port, () => {
  console.log(`Ziffer reporting server listening on http://127.0.0.1:${config.port}`);
  startXeroStatusPoller({ intervalMs: config.xeroStatusPollIntervalMs });
});
