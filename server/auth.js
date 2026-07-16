import crypto from "node:crypto";
import { recordAuditEvent } from "./auditRepository.js";
import { config } from "./config.js";
import { authenticateUser, toPublicUser, updateOwnAccount } from "./userRepository.js";

const COOKIE_NAME = "ziffer_session";
const CSRF_HEADER_NAME = "x-csrf-token";
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 8;
const loginFailures = new Map();

function sessionCookieOptions() {
  return {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_MS,
    sameSite: "lax",
    secure: config.cookieSecure
  };
}

function loginFailureKey(req) {
  const username = String(req.body?.username || "unknown").trim().toLowerCase();
  return `${req.ip || req.socket?.remoteAddress || "unknown"}:${username}`;
}

function loginFailureEntry(key, now = Date.now()) {
  const entry = loginFailures.get(key);
  if (!entry || entry.resetAt <= now) {
    return { count: 0, resetAt: now + LOGIN_FAILURE_WINDOW_MS };
  }
  return entry;
}

function recordLoginFailure(key, now = Date.now()) {
  const entry = loginFailureEntry(key, now);
  entry.count += 1;
  loginFailures.set(key, entry);
  return entry;
}

function clearLoginFailures(key) {
  loginFailures.delete(key);
}

function retryAfterSeconds(entry, now = Date.now()) {
  return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
}

function sign(value) {
  return crypto.createHmac("sha256", config.sessionSecret).update(value).digest("hex");
}

function createCsrfToken(sessionToken) {
  return sign(`csrf:${sessionToken}`);
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createToken(user) {
  const payload = JSON.stringify({
    exp: Date.now() + SESSION_MAX_AGE_MS,
    email: user.email,
    name: user.displayName || user.name || user.email,
    roles: user.roles || [],
    sub: user.email,
    userId: user.id
  });
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

function readToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [encoded, signature] = token.split(".");
  if (signature !== sign(encoded)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now()) return null;
    if (!payload.userId || !payload.email) return null;
    return payload;
  } catch {
    return null;
  }
}

export function loginRateLimit(req, res, next) {
  const now = Date.now();
  const key = loginFailureKey(req);
  const entry = loginFailureEntry(key, now);
  if (entry.count >= LOGIN_FAILURE_LIMIT) {
    const retryAfter = retryAfterSeconds(entry, now);
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({
      message: "Too many failed login attempts. Please wait a few minutes and try again."
    });
  }
  next();
}

export async function loginHandler(req, res) {
  const { username, password } = req.body || {};
  const failureKey = loginFailureKey(req);
  const user = await authenticateUser(username, password);
  if (!user) {
    const failure = recordLoginFailure(failureKey);
    await recordAuditEvent({
      action: "login_failed",
      actor: username || "unknown",
      entityType: "auth",
      metadata: {
        failedAttempts: failure.count,
        summary: `Failed login for ${username || "unknown"}`
      }
    });
    return res.status(401).json({ message: "Invalid username or password." });
  }
  clearLoginFailures(failureKey);

  res.cookie(COOKIE_NAME, createToken(user), sessionCookieOptions());

  await recordAuditEvent({
    action: "login",
    actor: user,
    entityType: "auth",
    metadata: { summary: `${user.email} logged in` }
  });

  return res.json({ authenticated: true, user });
}

export const authTestHooks = {
  clearLoginFailures,
  createCsrfToken,
  createSessionToken: createToken,
  loginFailures,
  recordLoginFailure
};

export async function logoutHandler(req, res) {
  const payload = readToken(req.cookies?.[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME);
  await recordAuditEvent({
    action: "logout",
    actor: payload || "unknown",
    entityType: "auth",
    metadata: { summary: `${payload?.sub || "unknown"} logged out` }
  });
  res.json({ authenticated: false });
}

export function sessionHandler(req, res) {
  const payload = readToken(req.cookies?.[COOKIE_NAME]);
  res.json({
    authenticated: Boolean(payload),
    user: payload ? toPublicUser({
      displayName: payload.name,
      email: payload.email || payload.sub,
      id: payload.userId,
      roles: payload.roles || []
    }) : null
  });
}

export function requireAuth(req, res, next) {
  const payload = readToken(req.cookies?.[COOKIE_NAME]);
  if (!payload) return res.status(401).json({ message: "Authentication required." });
  req.user = payload;
  next();
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Authentication required." });
    if (!Array.isArray(req.user.roles) || !req.user.roles.includes(role)) {
      return res.status(403).json({ code: "ROLE_REQUIRED", message: "Administrator access is required." });
    }
    next();
  };
}

export function csrfTokenHandler(req, res) {
  const sessionToken = req.cookies?.[COOKIE_NAME];
  if (!readToken(sessionToken)) return res.status(401).json({ message: "Authentication required." });
  res.json({ csrfToken: createCsrfToken(sessionToken) });
}

export function requireCsrf(req, res, next) {
  const sessionToken = req.cookies?.[COOKIE_NAME];
  const csrfToken = req.get(CSRF_HEADER_NAME);
  if (!sessionToken || !csrfToken || !timingSafeEqualString(csrfToken, createCsrfToken(sessionToken))) {
    return res.status(403).json({ message: "Security check failed. Please refresh the page and try again." });
  }
  next();
}

export async function updateAccountHandler(req, res, next) {
  try {
    const user = await updateOwnAccount(req.user.userId, req.body || {});
    res.cookie(COOKIE_NAME, createToken(user), sessionCookieOptions());

    await recordAuditEvent({
      action: "account_update",
      actor: user,
      entityId: user.id,
      entityType: "app_user",
      metadata: {
        displayName: user.displayName,
        email: user.email,
        passwordChanged: Boolean(req.body?.newPassword),
        summary: `${user.email} updated account settings`
      }
    });

    res.json({ authenticated: true, user });
  } catch (error) {
    next(error);
  }
}
