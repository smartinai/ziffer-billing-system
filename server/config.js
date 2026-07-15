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
const isProduction = process.env.NODE_ENV === "production";
const localSessionSecret = "local-dev-ziffer-session-secret";

function productionSecret(name, fallbackValue, { minLength = 32 } = {}) {
  const value = process.env[name] || fallbackValue;
  if (!isProduction) return value;

  if (!process.env[name] || String(value).length < minLength || String(value).includes("replace-with")) {
    throw new Error(`${name} must be set to a long random value before running in production.`);
  }

  return value;
}

function productionRequired(name, fallbackValue = "", { label = name } = {}) {
  const value = process.env[name] || fallbackValue;
  if (!isProduction) return value;

  if (!process.env[name] || !String(value).trim() || String(value).includes("replace-with")) {
    throw new Error(`${label} must be set before running in production.`);
  }

  return value;
}

function productionHttpsUrl(name, fallbackValue = "") {
  const value = productionRequired(name, fallbackValue);
  if (!isProduction) return value;

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL before running in production.`);
  }

  if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error(`${name} must be a public HTTPS URL before running in production.`);
  }

  return value;
}

function splitScopes(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export const config = {
  cacheTtlMs: Number(process.env.CACHE_TTL_MS || 15 * 60 * 1000),
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : isProduction,
  currency: process.env.DEFAULT_CURRENCY || "EUR",
  databaseSsl: process.env.DATABASE_SSL === "true",
  databaseUrl: productionRequired("DATABASE_URL"),
  defaultStartDate: process.env.DEFAULT_START_DATE || "2026-01-01",
  isProduction,
  pageDelayMs: Number(process.env.TEAMWORK_PAGE_DELAY_MS || 200),
  pageSize: Number(process.env.TEAMWORK_PAGE_SIZE || 100),
  port,
  sessionSecret: productionSecret("SESSION_SECRET", localSessionSecret),
  teamworkApiKey: productionRequired("TEAMWORK_API_KEY"),
  teamworkAuthMode: process.env.TEAMWORK_AUTH_MODE || "basic",
  teamworkBaseUrls: buildTeamworkBaseUrls(),
  teamworkScheduledSyncAttempts: Math.max(1, Number(process.env.TEAMWORK_SCHEDULED_SYNC_ATTEMPTS || 4)),
  teamworkScheduledSyncRetryMs: Math.max(0, Number(process.env.TEAMWORK_SCHEDULED_SYNC_RETRY_MS || 10 * 60 * 1000)),
  timezone: process.env.DEFAULT_TIMEZONE || "Europe/Amsterdam",
  xeroApiBaseUrl: normalizeBaseUrl(process.env.XERO_API_BASE_URL || "https://api.xero.com/api.xro/2.0"),
  xeroAuthUrl: process.env.XERO_AUTH_URL || "https://login.xero.com/identity/connect/authorize",
  xeroClientId: productionRequired("XERO_CLIENT_ID"),
  xeroClientSecret: productionRequired("XERO_CLIENT_SECRET"),
  xeroConnectionsUrl: process.env.XERO_CONNECTIONS_URL || "https://api.xero.com/connections",
  xeroRedirectUri: productionHttpsUrl("XERO_REDIRECT_URI", `http://localhost:${port}/api/xero/callback`),
  xeroReturnUrl: productionHttpsUrl("XERO_RETURN_URL", `http://127.0.0.1:${port}/#billing-create-quote`),
  xeroReferenceSyncTtlMs: Number(process.env.XERO_REFERENCE_SYNC_TTL_MS || 6 * 60 * 60 * 1000),
  xeroScopes: splitScopes(process.env.XERO_SCOPES || "offline_access accounting.invoices accounting.contacts.read accounting.settings.read"),
  xeroStatusPollIntervalMs: Number(process.env.XERO_STATUS_POLL_INTERVAL_MS || 60 * 60 * 1000),
  xeroTokenEncryptionKey: productionSecret("XERO_TOKEN_ENCRYPTION_KEY", process.env.SESSION_SECRET || localSessionSecret),
  xeroTokenUrl: process.env.XERO_TOKEN_URL || "https://identity.xero.com/connect/token",
  xeroTenantId: process.env.XERO_TENANT_ID || ""
};
