import crypto from "node:crypto";
import { config } from "./config.js";

const COOKIE_NAME = "ziffer_session";
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

function sign(value) {
  return crypto.createHmac("sha256", config.sessionSecret).update(value).digest("hex");
}

function createToken() {
  const payload = JSON.stringify({
    exp: Date.now() + SESSION_MAX_AGE_MS,
    sub: config.adminUsername
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
    return payload;
  } catch {
    return null;
  }
}

export function loginHandler(req, res) {
  const { username, password } = req.body || {};
  if (username !== config.adminUsername || password !== config.adminPassword) {
    return res.status(401).json({ message: "Invalid username or password." });
  }

  res.cookie(COOKIE_NAME, createToken(), {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_MS,
    sameSite: "lax",
    secure: false
  });

  return res.json({ authenticated: true, user: { name: config.adminUsername } });
}

export function logoutHandler(_req, res) {
  res.clearCookie(COOKIE_NAME);
  res.json({ authenticated: false });
}

export function sessionHandler(req, res) {
  const payload = readToken(req.cookies?.[COOKIE_NAME]);
  res.json({
    authenticated: Boolean(payload),
    user: payload ? { name: payload.sub } : null
  });
}

export function requireAuth(req, res, next) {
  const payload = readToken(req.cookies?.[COOKIE_NAME]);
  if (!payload) return res.status(401).json({ message: "Authentication required." });
  req.user = payload;
  next();
}
