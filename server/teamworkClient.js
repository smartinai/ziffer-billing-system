import { config } from "./config.js";

let activeBaseUrl = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeHeaders() {
  if (!config.teamworkApiKey) {
    throw new Error("TEAMWORK_API_KEY is not configured.");
  }

  if (config.teamworkAuthMode !== "basic") {
    throw new Error(`Unsupported Teamwork auth mode: ${config.teamworkAuthMode}`);
  }

  const encoded = Buffer.from(`${config.teamworkApiKey}:x`).toString("base64");
  return {
    Accept: "application/json",
    Authorization: `Basic ${encoded}`
  };
}

function buildUrl(baseUrl, path, params = {}) {
  const url = new URL(path, baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    url.searchParams.set(key, String(value));
  });
  return url;
}

function retryDelay(response, attempt) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1000;
  }
  return Math.min(6000, 600 * 2 ** attempt);
}

async function requestJson(path, params = {}, attempt = 0, baseUrl = activeBaseUrl) {
  const candidates = baseUrl
    ? [baseUrl]
    : [...new Set([activeBaseUrl, ...config.teamworkBaseUrls].filter(Boolean))];

  let lastError = null;

  for (const candidate of candidates) {
    const url = buildUrl(candidate, path, params);
    try {
      const response = await fetch(url, { headers: makeHeaders() });

      if ((response.status === 429 || response.status >= 500) && attempt < 4) {
        await sleep(retryDelay(response, attempt));
        return requestJson(path, params, attempt + 1, candidate);
      }

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Teamwork request failed (${response.status}) for ${url.host}: ${detail.slice(0, 300)}`);
      }

      activeBaseUrl = candidate;
      return {
        body: await response.json(),
        headers: response.headers,
        url: url.toString()
      };
    } catch (error) {
      lastError = error;
      if (candidate === activeBaseUrl) activeBaseUrl = null;
    }
  }

  throw lastError || new Error("Teamwork request failed.");
}

function readPageMeta(body, headers, page) {
  const metaPage = body?.meta?.page || body?.meta?.pagination || body?.page || {};
  const totalPagesHeader = Number(headers.get("x-pages") || headers.get("x-total-pages"));
  const currentPage = Number(metaPage.page || metaPage.currentPage || page);
  const totalPages = Number(metaPage.totalPages || metaPage.pages || totalPagesHeader);
  const hasMore =
    Boolean(metaPage.hasMore) ||
    Boolean(metaPage.has_more) ||
    (Number.isFinite(totalPages) && currentPage < totalPages);

  return { hasMore, page: currentPage, totalPages };
}

function extractCollection(body, collectionKeys) {
  for (const key of collectionKeys) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.items)) return body.items;
  return [];
}

export async function fetchAllPages(path, params, collectionKeys) {
  const rows = [];
  const pageSize = config.pageSize;
  const maxPages = Number(process.env.TEAMWORK_MAX_PAGES || 80);
  let page = 1;
  let lastUrl = null;

  while (page <= maxPages) {
    const response = await requestJson(path, {
      ...params,
      page,
      pageSize
    });
    lastUrl = response.url;
    rows.push(...extractCollection(response.body, collectionKeys));

    const pageMeta = readPageMeta(response.body, response.headers, page);
    if (!pageMeta.hasMore) {
      return { rows, metadata: { pagesFetched: page, partial: false, sourceUrl: lastUrl } };
    }

    page += 1;
    await sleep(config.pageDelayMs);
  }

  return {
    rows,
    metadata: {
      pagesFetched: maxPages,
      partial: true,
      sourceUrl: lastUrl,
      warning: `Stopped after ${maxPages} pages to protect Teamwork API usage.`
    }
  };
}

export async function fetchUsers() {
  return fetchAllPages(
    "/projects/api/v3/people.json",
    {
      include: "companies,currencies",
      includeClients: "false",
      showDeleted: "false"
    },
    ["people", "users"]
  );
}

export async function fetchProjects() {
  return fetchAllPages(
    "/projects/api/v3/projects.json",
    {
      include: "companies",
      projectType: "normal"
    },
    ["projects"]
  );
}

export async function fetchTimeEntries(startDate, endDate) {
  return fetchAllPages(
    "/projects/api/v3/time.json",
    {
      billableType: "all",
      endDate,
      include: "users,projects,projects.companies",
      invoicedType: "all",
      returnBillableInfo: "true",
      showDeleted: "false",
      startDate
    },
    ["timelogs", "timeEntries", "time"]
  );
}

export function getTeamworkStatus() {
  return {
    activeBaseUrl,
    configured: Boolean(config.teamworkApiKey && config.teamworkBaseUrls.length)
  };
}
