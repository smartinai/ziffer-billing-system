import assert from "node:assert/strict";
import test from "node:test";
import { authTestHooks, loginRateLimit, requireCsrf } from "./auth.js";

function mockRequest(username = "user@example.com", ip = "127.0.0.1") {
  return {
    body: { username },
    cookies: {},
    get() {
      return undefined;
    },
    ip
  };
}

function mockResponse() {
  return {
    body: null,
    headers: {},
    statusCode: null,
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    }
  };
}

test("login rate limiter blocks repeated failures for the same IP and username", () => {
  const username = "user@example.com";
  const ip = "127.0.0.1";
  const key = `${ip}:${username}`;
  authTestHooks.clearLoginFailures(key);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    authTestHooks.recordLoginFailure(key);
  }

  const req = mockRequest(username, ip);
  const res = mockResponse();
  let nextCalled = false;

  loginRateLimit(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.message, "Too many failed login attempts. Please wait a few minutes and try again.");
  assert.ok(Number(res.headers["Retry-After"]) > 0);
});

test("login rate limiter allows clean counters", () => {
  const req = mockRequest("other@example.com");
  const res = mockResponse();
  let nextCalled = false;

  loginRateLimit(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test("CSRF protection rejects authenticated writes without the CSRF header", () => {
  const req = {
    cookies: { ziffer_session: "session-token" },
    get() {
      return undefined;
    }
  };
  const res = mockResponse();
  let nextCalled = false;

  requireCsrf(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("CSRF protection accepts a token signed for the current session cookie", () => {
  const sessionToken = "session-token";
  const req = {
    cookies: { ziffer_session: sessionToken },
    get(headerName) {
      return headerName === "x-csrf-token" ? authTestHooks.createCsrfToken(sessionToken) : undefined;
    }
  };
  const res = mockResponse();
  let nextCalled = false;

  requireCsrf(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});
