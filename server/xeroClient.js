import crypto from "node:crypto";
import { config } from "./config.js";
import { getDatabasePool } from "./db.js";

export const XERO_STATE_COOKIE = "ziffer_xero_oauth_state";

const TOKEN_VERSION = "v1";
const OAUTH_STATE_VERSION = "xo1";
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const REFRESH_WINDOW_MS = 2 * 60 * 1000;
const pendingOAuthStates = new Set();

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function encryptionKey() {
  return crypto.createHash("sha256").update(config.xeroTokenEncryptionKey || config.sessionSecret).digest();
}

function signOAuthState(value) {
  return crypto.createHmac("sha256", config.sessionSecret).update(value).digest("base64url");
}

function safeOAuthActor(actor = {}) {
  if (!actor || typeof actor === "string") return { sub: actor || "unknown" };
  return {
    email: actor.email || actor.sub || "",
    name: actor.name || actor.displayName || actor.email || actor.sub || "",
    roles: Array.isArray(actor.roles) ? actor.roles : [],
    sub: actor.sub || actor.email || "",
    userId: actor.userId || actor.id || ""
  };
}

export function encryptToken(value) {
  const text = String(value || "");
  if (!text) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [TOKEN_VERSION, base64Url(iv), base64Url(tag), base64Url(encrypted)].join(":");
}

export function decryptToken(value) {
  if (!value) return "";
  const [version, iv, tag, encrypted] = String(value).split(":");
  if (version !== TOKEN_VERSION || !iv || !tag || !encrypted) {
    throw new Error("Stored Xero token uses an unsupported format.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function requireDatabase() {
  const pool = getDatabasePool();
  if (!pool) {
    const error = new Error("DATABASE_URL is not configured.");
    error.statusCode = 503;
    throw error;
  }
  return pool;
}

function xeroConfigState() {
  const missing = [];
  if (!config.xeroClientId) missing.push("XERO_CLIENT_ID");
  if (!config.xeroClientSecret) missing.push("XERO_CLIENT_SECRET");
  if (!config.xeroRedirectUri) missing.push("XERO_REDIRECT_URI");

  return {
    configured: missing.length === 0,
    missing,
    redirectUri: config.xeroRedirectUri,
    scopes: config.xeroScopes
  };
}

function mapConnection(row) {
  if (!row) return null;
  return {
    connected: row.status === "connected" && Boolean(row.tenantId) && Boolean(row.refreshTokenEncrypted),
    expiresAt: row.expiresAt || null,
    scopes: row.scopes || [],
    status: row.status || "disconnected",
    tenantId: row.tenantId || "",
    tenantName: row.tenantName || ""
  };
}

async function latestConnection(pool) {
  const result = await pool.query(
    `
      select
        id,
        tenant_id as "tenantId",
        tenant_name as "tenantName",
        status,
        scopes,
        token_encrypted as "tokenEncrypted",
        refresh_token_encrypted as "refreshTokenEncrypted",
        expires_at as "expiresAt"
      from xero_connections
      order by updated_at desc, created_at desc
      limit 1
    `
  );
  return result.rows[0] || null;
}

export async function getXeroConnectionStatus() {
  const configState = xeroConfigState();
  if (!getDatabasePool()) {
    return {
      ...configState,
      connected: false,
      status: "database_not_configured"
    };
  }

  const row = await latestConnection(requireDatabase());
  return {
    ...configState,
    ...(mapConnection(row) || { connected: false, status: "disconnected" })
  };
}

export function createXeroOAuthState(actor = {}) {
  const payload = {
    actor: safeOAuthActor(actor),
    exp: Date.now() + OAUTH_STATE_MAX_AGE_MS,
    nonce: crypto.randomBytes(24).toString("base64url")
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const state = `${OAUTH_STATE_VERSION}.${encoded}.${signOAuthState(encoded)}`;
  pendingOAuthStates.add(payload.nonce);
  return state;
}

function consumeOAuthState(state) {
  if (!state || typeof state !== "string") return null;
  const [version, encoded, signature] = state.split(".");
  if (version !== OAUTH_STATE_VERSION || !encoded || !signature) return null;
  if (signature !== signOAuthState(encoded)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!payload?.nonce || !pendingOAuthStates.has(payload.nonce)) return null;
  pendingOAuthStates.delete(payload.nonce);
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

export const xeroOAuthTestHooks = {
  consumeOAuthState
};

export function buildXeroAuthorizationUrl(state) {
  const configState = xeroConfigState();
  if (!configState.configured) {
    const error = new Error(`Configure ${configState.missing.join(", ")} before connecting Xero.`);
    error.statusCode = 503;
    throw error;
  }

  const url = new URL(config.xeroAuthUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.xeroClientId);
  url.searchParams.set("redirect_uri", config.xeroRedirectUri);
  url.searchParams.set("scope", config.xeroScopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

function basicAuthHeader() {
  return `Basic ${Buffer.from(`${config.xeroClientId}:${config.xeroClientSecret}`).toString("base64")}`;
}

async function postTokenForm(params) {
  const response = await fetch(config.xeroTokenUrl, {
    body: new URLSearchParams(params),
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "POST"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error_description || payload.error || "Xero token request failed.");
    error.statusCode = response.status;
    throw error;
  }
  return payload;
}

async function fetchXeroConnections(accessToken) {
  const response = await fetch(config.xeroConnectionsUrl, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`
    }
  });
  const payload = await response.json().catch(() => []);
  if (!response.ok) {
    const error = new Error(payload.Detail || payload.message || "Could not read Xero tenant connections.");
    error.statusCode = response.status;
    throw error;
  }
  return Array.isArray(payload) ? payload : [];
}

function chooseTenant(connections) {
  if (!connections.length) {
    const error = new Error("No Xero tenant connections were returned for this account.");
    error.statusCode = 400;
    throw error;
  }

  if (config.xeroTenantId) {
    const configuredTenant = connections.find((connection) => connection.tenantId === config.xeroTenantId);
    if (configuredTenant) return configuredTenant;

    const error = new Error("XERO_TENANT_ID does not match any connected Xero tenant.");
    error.statusCode = 400;
    throw error;
  }

  return connections[0];
}

function tokenExpiry(payload) {
  const expiresIn = Number(payload.expires_in || 0);
  return new Date(Date.now() + Math.max(expiresIn - 30, 0) * 1000);
}

async function storeConnection(pool, { connection, tokenPayload }) {
  const result = await pool.query(
    `
      select id
      from xero_connections
      where tenant_id = $1
      limit 1
    `,
    [connection.tenantId || ""]
  );

  const tokenEncrypted = encryptToken(tokenPayload.access_token);
  const refreshTokenEncrypted = encryptToken(tokenPayload.refresh_token);
  const scopes = String(tokenPayload.scope || config.xeroScopes.join(" ")).split(/\s+/).filter(Boolean);
  const expiresAt = tokenExpiry(tokenPayload);

  if (result.rowCount) {
    await pool.query(
      `
        update xero_connections
        set tenant_name = $2,
            status = 'connected',
            scopes = $3,
            token_encrypted = $4,
            refresh_token_encrypted = coalesce($5, refresh_token_encrypted),
            expires_at = $6,
            updated_at = now()
        where id = $1
      `,
      [
        result.rows[0].id,
        connection.tenantName || "",
        scopes,
        tokenEncrypted,
        refreshTokenEncrypted,
        expiresAt
      ]
    );
    return;
  }

  await pool.query(
    `
      insert into xero_connections (
        tenant_id,
        tenant_name,
        status,
        scopes,
        token_encrypted,
        refresh_token_encrypted,
        expires_at
      )
      values ($1, $2, 'connected', $3, $4, $5, $6)
    `,
    [
      connection.tenantId || "",
      connection.tenantName || "",
      scopes,
      tokenEncrypted,
      refreshTokenEncrypted,
      expiresAt
    ]
  );
}

export async function handleXeroCallback({ code, expectedState, state }) {
  const stateFromCookie = state && expectedState && state === expectedState;
  const statePayload = consumeOAuthState(state);
  if (!stateFromCookie && !statePayload) {
    const error = new Error("Xero connection state did not match. Please try connecting again.");
    error.statusCode = 400;
    throw error;
  }
  if (!code) {
    const error = new Error("Xero did not return an authorization code.");
    error.statusCode = 400;
    throw error;
  }

  const tokenPayload = await postTokenForm({
    code,
    grant_type: "authorization_code",
    redirect_uri: config.xeroRedirectUri
  });
  const connections = await fetchXeroConnections(tokenPayload.access_token);
  const connection = chooseTenant(connections);

  await storeConnection(requireDatabase(), { connection, tokenPayload });

  return {
    actor: statePayload?.actor || null,
    connected: true,
    tenantId: connection.tenantId || "",
    tenantName: connection.tenantName || ""
  };
}

async function refreshConnectionToken(pool, row) {
  const refreshToken = decryptToken(row.refreshTokenEncrypted);
  if (!refreshToken) {
    const error = new Error("Xero is not connected. Connect Xero before sending live documents.");
    error.statusCode = 409;
    throw error;
  }

  const tokenPayload = await postTokenForm({
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });

  await storeConnection(pool, {
    connection: {
      tenantId: row.tenantId,
      tenantName: row.tenantName
    },
    tokenPayload
  });

  return tokenPayload.access_token;
}

async function accessTokenForLiveSend() {
  const pool = requireDatabase();
  const row = await latestConnection(pool);
  if (!row || row.status !== "connected" || !row.tenantId) {
    return null;
  }

  const expiresAt = row.expiresAt ? new Date(row.expiresAt).getTime() : 0;
  if (expiresAt > Date.now() + REFRESH_WINDOW_MS && row.tokenEncrypted) {
    return {
      accessToken: decryptToken(row.tokenEncrypted),
      tenantId: row.tenantId,
      tenantName: row.tenantName || ""
    };
  }

  return {
    accessToken: await refreshConnectionToken(pool, row),
    tenantId: row.tenantId,
    tenantName: row.tenantName || ""
  };
}

export function parseXeroDocumentResponse(payload, documentType = "draft_quote") {
  if (documentType === "draft_invoice") {
    const invoice = payload?.Invoices?.[0] || null;
    return {
      document: invoice,
      documentId: invoice?.InvoiceID || "",
      documentNumber: invoice?.InvoiceNumber || "",
      invoice,
      invoiceId: invoice?.InvoiceID || "",
      invoiceNumber: invoice?.InvoiceNumber || "",
      status: invoice?.Status || ""
    };
  }

  const quote = payload?.Quotes?.[0] || null;
  return {
    document: quote,
    documentId: quote?.QuoteID || "",
    documentNumber: quote?.QuoteNumber || "",
    quote,
    quoteId: quote?.QuoteID || "",
    quoteNumber: quote?.QuoteNumber || "",
    status: quote?.Status || ""
  };
}

export function parseXeroQuoteResponse(payload) {
  const parsed = parseXeroDocumentResponse(payload, "draft_quote");
  return {
    quote: parsed.quote,
    quoteId: parsed.quoteId,
    quoteNumber: parsed.quoteNumber,
    status: parsed.status
  };
}

export function xeroValidationMessages(payload) {
  const messages = new Set();

  function add(message) {
    const text = String(message || "").trim();
    if (text) messages.add(text);
  }

  function visit(value) {
    if (!value || typeof value !== "object") return;

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (Array.isArray(value.ValidationErrors)) {
      value.ValidationErrors.forEach((error) => add(error?.Message || error?.message));
    }

    visit(value.Elements);
    visit(value.Items);
    visit(value.LineItems);
  }

  visit(payload);
  return [...messages];
}

function xeroErrorMessage(payload) {
  const base = payload.Detail || payload.Message || payload.message || "Xero document create request failed.";
  const validationMessages = xeroValidationMessages(payload);
  return validationMessages.length ? `${base}: ${validationMessages.join("; ")}` : base;
}

function xeroDocumentEndpoint(documentType, documentId) {
  const safeId = encodeURIComponent(documentId || "");
  return documentType === "draft_invoice" ? `/Invoices/${safeId}` : `/Quotes/${safeId}`;
}

function endpointWithQuery(endpoint, params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const queryString = query.toString();
  return queryString ? `${endpoint}?${queryString}` : endpoint;
}

async function xeroAccountingRequest({ body, endpoint, headers = {}, method = "GET" }) {
  const connection = await accessTokenForLiveSend();
  if (!connection) {
    return {
      connected: false,
      mode: "prepared",
      status: "prepared"
    };
  }

  const requestOptions = {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${connection.accessToken}`,
      "Content-Type": "application/json",
      "Xero-Tenant-Id": connection.tenantId,
      ...headers
    },
    method
  };

  if (body !== undefined) requestOptions.body = JSON.stringify(body);

  const response = await fetch(`${config.xeroApiBaseUrl}${endpoint}`, requestOptions);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(xeroErrorMessage(payload));
    error.statusCode = response.status;
    error.response = payload;
    throw error;
  }

  return {
    connected: true,
    mode: "live",
    payload,
    status: "ok",
    tenantId: connection.tenantId,
    tenantName: connection.tenantName
  };
}

async function fetchXeroCollection({ collectionKey, endpoint, params = {}, paged = false }) {
  if (!paged) {
    const transport = await xeroAccountingRequest({
      endpoint: endpointWithQuery(endpoint, params),
      method: "GET"
    });
    if (transport.mode !== "live") return transport;

    return {
      ...transport,
      items: Array.isArray(transport.payload?.[collectionKey]) ? transport.payload[collectionKey] : []
    };
  }

  const items = [];
  let page = 1;
  let lastTransport = null;

  while (page <= 200) {
    const transport = await xeroAccountingRequest({
      endpoint: endpointWithQuery(endpoint, { ...params, page }),
      method: "GET"
    });
    if (transport.mode !== "live") return transport;

    lastTransport = transport;
    const pageItems = Array.isArray(transport.payload?.[collectionKey]) ? transport.payload[collectionKey] : [];
    items.push(...pageItems);
    if (pageItems.length < 100) break;
    page += 1;
  }

  return {
    ...lastTransport,
    items
  };
}

export async function fetchXeroReferenceData() {
  const contacts = await fetchXeroCollection({
    collectionKey: "Contacts",
    endpoint: "/Contacts",
    params: { summaryOnly: true },
    paged: true
  });
  if (contacts.mode !== "live") return contacts;

  const [taxRates, accounts] = await Promise.all([
    fetchXeroCollection({
      collectionKey: "TaxRates",
      endpoint: "/TaxRates"
    }),
    fetchXeroCollection({
      collectionKey: "Accounts",
      endpoint: "/Accounts"
    })
  ]);

  return {
    connected: true,
    contacts: contacts.items,
    mode: "live",
    accounts: accounts.mode === "live" ? accounts.items : [],
    payload: {
      Accounts: accounts.mode === "live" ? accounts.items : [],
      Contacts: contacts.items,
      TaxRates: taxRates.mode === "live" ? taxRates.items : []
    },
    status: "fetched",
    taxRates: taxRates.mode === "live" ? taxRates.items : [],
    tenantId: contacts.tenantId,
    tenantName: contacts.tenantName
  };
}

export async function sendQuoteRequestToXero(request) {
  const transport = await xeroAccountingRequest({
    body: request.body,
    endpoint: request.endpoint,
    headers: {
      "Idempotency-Key": request.headers?.["Idempotency-Key"] || crypto.randomUUID()
    },
    method: request.method || "PUT"
  });
  if (transport.mode !== "live") return transport;

  const parsed = parseXeroDocumentResponse(transport.payload, request.documentType || "draft_quote");

  return {
    ...parsed,
    connected: true,
    mode: "live",
    payload: transport.payload,
    status: "sent",
    tenantId: transport.tenantId,
    tenantName: transport.tenantName,
    xeroStatus: parsed.status || "sent"
  };
}

export async function fetchXeroDocumentStatus({ documentId, documentType }) {
  if (!documentId) {
    const error = new Error("A Xero document ID is required to fetch document status.");
    error.statusCode = 400;
    throw error;
  }

  const transport = await xeroAccountingRequest({
    endpoint: xeroDocumentEndpoint(documentType, documentId),
    method: "GET"
  });
  if (transport.mode !== "live") return transport;

  const parsed = parseXeroDocumentResponse(transport.payload, documentType || "draft_quote");
  return {
    ...parsed,
    connected: true,
    mode: "live",
    payload: transport.payload,
    status: "fetched",
    tenantId: transport.tenantId,
    tenantName: transport.tenantName,
    xeroStatus: parsed.status || ""
  };
}

export async function disconnectXero() {
  const pool = requireDatabase();
  await pool.query(
    `
      update xero_connections
      set status = 'disconnected',
          token_encrypted = null,
          refresh_token_encrypted = null,
          expires_at = null,
          updated_at = now()
      where status = 'connected'
    `
  );
  return getXeroConnectionStatus();
}
