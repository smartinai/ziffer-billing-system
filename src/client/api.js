export const demoMode = import.meta.env.VITE_DEMO_MODE === "true";

let csrfTokenPromise = null;

async function getDemoSummary(range) {
  const { getDemoReport } = await import("./demoData.js");
  return getDemoReport(range);
}

function isWriteMethod(method = "GET") {
  return ["POST", "PATCH", "PUT", "DELETE"].includes(String(method).toUpperCase());
}

async function getCsrfToken() {
  if (!csrfTokenPromise) {
    csrfTokenPromise = fetch("/api/auth/csrf", {
      credentials: "include",
      headers: { "Content-Type": "application/json" }
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || "Could not prepare security token.");
        return payload.csrfToken;
      })
      .catch((error) => {
        csrfTokenPromise = null;
        throw error;
      });
  }
  return csrfTokenPromise;
}

async function request(path, options = {}) {
  const method = options.method || "GET";
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (isWriteMethod(method) && path !== "/api/auth/login") {
    headers["x-csrf-token"] = await getCsrfToken();
  }

  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 403) csrfTokenPromise = null;
    const error = new Error(payload.message || "Request failed.");
    error.code = payload.code || "REQUEST_FAILED";
    error.details = payload.details || {};
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function getSession() {
  if (demoMode) {
    return Promise.resolve({ authenticated: true, user: { name: "demo" } });
  }
  return request("/api/auth/session");
}

export function login(username, password) {
  if (demoMode) {
    return Promise.resolve({ authenticated: true, user: { name: "demo" } });
  }
  return request("/api/auth/login", {
    body: JSON.stringify({ password, username }),
    method: "POST"
  }).then((payload) => {
    csrfTokenPromise = null;
    return payload;
  });
}

export function logout(editorSessionId = "") {
  if (demoMode) {
    return Promise.resolve({ authenticated: true, user: { name: "demo" } });
  }
  return request("/api/auth/logout", {
    body: JSON.stringify({ editorSessionId }),
    method: "POST"
  }).finally(() => {
    csrfTokenPromise = null;
  });
}

export function updateAccount(input) {
  if (demoMode) {
    return Promise.resolve({ authenticated: true, user: { displayName: input.displayName, name: input.displayName || "demo" } });
  }
  return request("/api/auth/account", {
    body: JSON.stringify(input),
    method: "PATCH"
  });
}

export function getSummary(range) {
  if (demoMode) {
    return getDemoSummary(range);
  }
  const params = new URLSearchParams(range);
  return request(`/api/reporting/summary?${params}`);
}

export function getReportingSourceStatus() {
  if (demoMode) {
    return Promise.resolve({ lastAttempt: null, lastScheduledAttempt: null, lastSuccess: null, schedule: null });
  }
  return request("/api/reporting/source-status");
}

export function refreshSummary(range) {
  if (demoMode) {
    return getDemoSummary(range);
  }
  const params = new URLSearchParams(range);
  return request(`/api/reporting/refresh?${params}`, { method: "POST" });
}

export function getBillingClients() {
  if (demoMode) {
    return Promise.resolve({ clients: [] });
  }
  return request("/api/billing/clients");
}

export function getBillingQuotes() {
  if (demoMode) {
    return Promise.resolve({
      quotes: [],
      summary: {
        avgPaidWithinDays: null,
        outstandingAmount: 0,
        totalPaidAmount: 0,
        totalQuotes: 0,
        totalSentAmount: 0,
        totalTeamworkAfterAnnual: 0,
        totalTeamworkEstimate: 0
      }
    });
  }
  return request("/api/billing/quotes");
}

export function getAuditEvents(filters = {}) {
  if (demoMode) {
    return Promise.resolve({ actions: [], actors: [], entityTypes: [], events: [] });
  }
  const params = new URLSearchParams();
  if (filters.action && filters.action !== "all") params.set("action", filters.action);
  if (filters.actor && filters.actor !== "all") params.set("actor", filters.actor);
  if (filters.entityType && filters.entityType !== "all") params.set("entityType", filters.entityType);
  const query = params.toString();
  return request(`/api/audit-events${query ? `?${query}` : ""}`);
}

export function getBillingQuoteDetail(id) {
  if (demoMode) {
    return Promise.resolve({ latestResponse: {}, lines: [], logs: [], payload: {}, quote: null });
  }
  return request(`/api/billing/quotes/${id}`);
}

export function syncBillingQuoteXeroStatus(id) {
  if (demoMode) {
    return Promise.resolve({ failed: 0, skipped: 0, synced: 0, total: 0 });
  }
  return request(`/api/billing/quotes/${id}/sync-xero-status`, { method: "POST" });
}

export function syncBillingQuotesXeroStatus() {
  if (demoMode) {
    return Promise.resolve({ failed: 0, skipped: 0, synced: 0, total: 0 });
  }
  return request("/api/billing/quotes/sync-xero-status", { method: "POST" });
}

export function getXeroReference({ force = false } = {}) {
  if (demoMode) {
    return Promise.resolve({ accounts: [], contacts: [], taxRates: [] });
  }
  const params = new URLSearchParams();
  if (force) params.set("force", "true");
  const query = params.toString();
  return request(`/api/xero/reference${query ? `?${query}` : ""}`);
}

export function getXeroStatus() {
  if (demoMode) {
    return Promise.resolve({ configured: false, connected: false, status: "demo" });
  }
  return request("/api/xero/status");
}

export function getAnnualInvoices(year) {
  if (demoMode) {
    return Promise.resolve({ clients: [], services: [], usage: [], year, years: [2025, 2026] });
  }
  const params = new URLSearchParams();
  if (year) params.set("year", year);
  return request(`/api/billing/annual-invoices?${params}`);
}

export function updateAnnualInvoiceUsage(input) {
  if (demoMode) {
    return Promise.resolve({ usage: { ...input, usageId: `${input.billingClientId}-${input.serviceId}-${input.year}` } });
  }
  return request("/api/billing/annual-invoices", {
    body: JSON.stringify(input),
    method: "PATCH"
  });
}

export function updateBillingClient(id, client) {
  if (demoMode) {
    return Promise.resolve({ client: { ...client, id } });
  }
  return request(`/api/billing/clients/${id}`, {
    body: JSON.stringify(client),
    method: "PATCH"
  });
}

export function createQuotePreview(input) {
  if (demoMode) {
    return Promise.resolve({ preview: null });
  }
  return request("/api/billing/quote-previews", {
    body: JSON.stringify(input),
    method: "POST"
  });
}

export function getOperations() {
  if (demoMode) {
    return Promise.resolve({ checkedAt: new Date().toISOString(), components: [], incidents: [], recentRuns: [], emailConfigured: false });
  }
  return request("/api/admin/operations");
}

export function sendOperationsTestAlert() {
  if (demoMode) return Promise.resolve({ ok: true, recipientCount: 0 });
  return request("/api/admin/operations/test-alert", { method: "POST" });
}

export function getQuoteDrafts(editorSessionId = "") {
  if (demoMode) return Promise.resolve({ archived: [], drafts: [] });
  const params = new URLSearchParams();
  if (editorSessionId) params.set("editorSessionId", editorSessionId);
  return request(`/api/billing/quote-previews${params.size ? `?${params}` : ""}`);
}

export function acquireQuoteDraft(previewId, editorSessionId) {
  if (demoMode) return Promise.resolve({ preview: null });
  return request(`/api/billing/quote-previews/${previewId}/editor-lock`, {
    body: JSON.stringify({ editorSessionId }),
    method: "POST"
  });
}

export function renewQuoteDraft(previewId, editorSessionId) {
  if (demoMode) return Promise.resolve({ lock: null });
  return request(`/api/billing/quote-previews/${previewId}/editor-lock`, {
    body: JSON.stringify({ editorSessionId }),
    method: "PATCH"
  });
}

export function getArchivedQuoteDraft(previewId) {
  if (demoMode) return Promise.resolve({ preview: null });
  return request(`/api/billing/quote-previews/${previewId}`);
}

export function archiveQuoteDraft(previewId, input) {
  if (demoMode) return Promise.resolve({ draft: { id: previewId } });
  return request(`/api/billing/quote-previews/${previewId}/archive`, {
    body: JSON.stringify(input),
    method: "POST"
  });
}

export function restoreQuoteDraft(previewId, input) {
  if (demoMode) return Promise.resolve({ preview: null });
  return request(`/api/billing/quote-previews/${previewId}/restore`, {
    body: JSON.stringify(input),
    method: "POST"
  });
}

export function updateQuotePreview(id, input) {
  if (demoMode) {
    return Promise.resolve({ preview: { ...input, id } });
  }
  return request(`/api/billing/quote-previews/${id}`, {
    body: JSON.stringify(input),
    method: "PATCH"
  });
}

export function updateQuoteTimeEntryBillable(previewId, entryId, isBillable, lifecycle = {}) {
  if (demoMode) {
    return Promise.resolve({ preview: null });
  }
  return request(`/api/billing/quote-previews/${previewId}/time-entries/${entryId}`, {
    body: JSON.stringify({ ...lifecycle, isBillable }),
    method: "PATCH"
  });
}

export function updateQuoteTimeEntriesBillable(previewId, entryIds, isBillable, lifecycle = {}) {
  if (demoMode) {
    return Promise.resolve({ preview: null });
  }
  return request(`/api/billing/quote-previews/${previewId}/time-entries`, {
    body: JSON.stringify({ ...lifecycle, entryIds, isBillable }),
    method: "PATCH"
  });
}

export function sendQuoteToXero(previewId, input = {}) {
  if (demoMode) {
    const documentType = input.documentType === "draft_quote" ? "draft_quote" : "draft_invoice";
    const documentLabel = documentType === "draft_quote" ? "draft quote" : "draft invoice";
    return Promise.resolve({
      preview: { id: previewId, status: "approved_for_xero" },
      xero: {
        annualUsageApplied: [],
        documentLabel,
        documentType,
        lineCount: 0,
        message: `Demo ${documentLabel} prepared.`,
        mode: "prepared",
        status: "prepared"
      }
    });
  }
  return request(`/api/billing/quote-previews/${previewId}/send-to-xero`, {
    body: JSON.stringify(input),
    method: "POST"
  });
}

export function reconcileQuoteXeroSend(previewId, input = {}) {
  if (demoMode) {
    return Promise.resolve({
      preview: { id: previewId, status: "preview", xeroSendState: "failed" },
      xero: { state: "not_found", canRetry: true, message: "No demo Xero document was found." }
    });
  }
  return request(`/api/billing/quote-previews/${previewId}/reconcile-xero-send`, {
    body: JSON.stringify(input),
    method: "POST"
  });
}
