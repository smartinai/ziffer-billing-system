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

export const config = {
  adminPassword: process.env.ADMIN_PASSWORD || "admin",
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  cacheTtlMs: Number(process.env.CACHE_TTL_MS || 15 * 60 * 1000),
  currency: process.env.DEFAULT_CURRENCY || "EUR",
  defaultStartDate: process.env.DEFAULT_START_DATE || "2026-01-01",
  pageDelayMs: Number(process.env.TEAMWORK_PAGE_DELAY_MS || 200),
  pageSize: Number(process.env.TEAMWORK_PAGE_SIZE || 100),
  port: Number(process.env.PORT || 3000),
  sessionSecret: process.env.SESSION_SECRET || "local-dev-ziffer-session-secret",
  teamworkApiKey: process.env.TEAMWORK_API_KEY || "",
  teamworkAuthMode: process.env.TEAMWORK_AUTH_MODE || "basic",
  teamworkBaseUrls: buildTeamworkBaseUrls(),
  timezone: process.env.DEFAULT_TIMEZONE || "Europe/Amsterdam"
};
