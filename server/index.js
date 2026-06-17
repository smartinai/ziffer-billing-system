import cookieParser from "cookie-parser";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loginHandler, logoutHandler, requireAuth, sessionHandler } from "./auth.js";
import { config } from "./config.js";
import { getReportingSummary, getSourceStatus, refreshStoredReportingSummary } from "./reportingService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "ziffer-reporting" });
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
  res.status(500).json({
    message: error.message || "Unexpected server error."
  });
});

app.listen(config.port, () => {
  console.log(`Ziffer reporting server listening on http://127.0.0.1:${config.port}`);
});
