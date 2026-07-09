import assert from "node:assert/strict";
import test from "node:test";
import { buildContentSecurityPolicy, securityHeaders } from "./securityHeaders.js";

test("security headers include clickjacking, sniffing, referrer, and CSP protections", () => {
  const headers = {};
  const res = {
    setHeader(name, value) {
      headers[name] = value;
    }
  };
  let nextCalled = false;

  securityHeaders()(null, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.match(headers["Content-Security-Policy"], /default-src 'self'/);
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
});

test("production CSP upgrades insecure requests without affecting local development", () => {
  assert.equal(buildContentSecurityPolicy().includes("upgrade-insecure-requests"), false);
  assert.equal(buildContentSecurityPolicy({ isProduction: true }).includes("upgrade-insecure-requests"), true);
});
