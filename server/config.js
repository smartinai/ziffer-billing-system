import dotenv from "dotenv";

dotenv.config();

function normalizeBaseUrl(value) {
  if (!value) return "";
  const raw = value.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function buildTeamworkBaseUrls() {
  if (process.env.TEAMWORK_BASE_URL) {
    return [normalizeBaseUrl(process.env.TEAMWORK_BASE_URL)];
  }

  const site = process.env.TEAMWORK_SITE_NAME?.trim();
  if (!site) return [];

  if (/^https?:\/\//i.test(site)) return [normalizeBaseUrl(site)];

  const urls = [];
  if (site.includes(".")) {
    urls.push(`https://${site}.teamwork.com`);
    urls.push(`https://${site}`);
  } else {
    urls.push(`https://${site}.teamwork.com`);
  }
  return urls;
}

const port = Number(process.env.PORT || 3000);

function splitScopes(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export const config = {
  adminPassword: process.env.ADMIN_PASSWORD || "admin",
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  cacheTtlMs: Number(process.env.CACHE_TTL_MS || 15 * 60 * 1000),
  currency: process.env.DEFAULT_CURRENCY || "EUR",
  databaseSsl: process.env.DATABASE_SSL === "true",
  databaseUrl: process.env.DATABASE_URL || "",
  defaultStartDate: process.env.DEFAULT_START_DATE || "2026-01-01",
  pageDelayMs: Number(process.env.TEAMWORK_PAGE_DELAY_MS || 200),
  pageSize: Number(process.env.TEAMWORK_PAGE_SIZE || 100),
  port,
  sessionSecret: process.env.SESSION_SECRET || "local-dev-ziffer-session-secret",
  teamworkApiKey: process.env.TEAMWORK_API_KEY || "",
  teamworkAuthMode: process.env.TEAMWORK_AUTH_MODE || "basic",
  teamworkBaseUrls: buildTeamworkBaseUrls(),
  timezone: process.env.DEFAULT_TIMEZONE || "Europe/Amsterdam",
  xeroApiBaseUrl: normalizeBaseUrl(process.env.XERO_API_BASE_URL || "https://api.xero.com/api.xro/2.0"),
  xeroAuthUrl: process.env.XERO_AUTH_URL || "https://login.xero.com/identity/connect/authorize",
  xeroClientId: process.env.XERO_CLIENT_ID || "",
  xeroClientSecret: process.env.XERO_CLIENT_SECRET || "",
  xeroConnectionsUrl: process.env.XERO_CONNECTIONS_URL || "https://api.xero.com/connections",
  xeroRedirectUri: process.env.XERO_REDIRECT_URI || `http://localhost:${port}/api/xero/callback`,
  xeroReturnUrl: process.env.XERO_RETURN_URL || `http://127.0.0.1:${port}/#billing-create-quote`,
  xeroReferenceSyncTtlMs: Number(process.env.XERO_REFERENCE_SYNC_TTL_MS || 6 * 60 * 60 * 1000),
  xeroScopes: splitScopes(process.env.XERO_SCOPES || "offline_access accounting.invoices accounting.contacts.read accounting.settings.read"),
  xeroStatusPollIntervalMs: Number(process.env.XERO_STATUS_POLL_INTERVAL_MS || 60 * 60 * 1000),
  xeroTokenEncryptionKey: process.env.XERO_TOKEN_ENCRYPTION_KEY || process.env.SESSION_SECRET || "local-dev-ziffer-session-secret",
  xeroTokenUrl: process.env.XERO_TOKEN_URL || "https://identity.xero.com/connect/token",
  xeroTenantId: process.env.XERO_TENANT_ID || ""
};
