import assert from "node:assert/strict";
import test from "node:test";

async function importConfigWithEnv(env) {
  const originalEnv = { ...process.env };
  process.env = { ...originalEnv, ...env };
  for (const key of [
    "COOKIE_SECURE",
    "DATABASE_URL",
    "SESSION_SECRET",
    "TEAMWORK_API_KEY",
    "XERO_CLIENT_ID",
    "XERO_CLIENT_SECRET",
    "XERO_REDIRECT_URI",
    "XERO_RETURN_URL",
    "XERO_TOKEN_ENCRYPTION_KEY"
  ]) {
    if (env[key] === undefined) delete process.env[key];
  }

  try {
    return await import(`./config.js?test=${Date.now()}-${Math.random()}`);
  } finally {
    process.env = originalEnv;
  }
}

test("production config rejects missing deployment secrets", async () => {
  await assert.rejects(
    () => importConfigWithEnv({ NODE_ENV: "production" }),
    /SESSION_SECRET must be set/
  );
});

test("production config rejects placeholder deployment secrets", async () => {
  await assert.rejects(
    () => importConfigWithEnv({
      DATABASE_URL: "postgres://ziffer:secret@postgres:5432/ziffer_billing",
      NODE_ENV: "production",
      SESSION_SECRET: "replace-with-a-long-random-secret-before-vps",
      TEAMWORK_API_KEY: "teamwork-api-key",
      XERO_CLIENT_ID: "xero-client-id",
      XERO_CLIENT_SECRET: "xero-client-secret",
      XERO_REDIRECT_URI: "https://app.ziffer.lu/api/xero/callback",
      XERO_RETURN_URL: "https://app.ziffer.lu/#billing-create-quote",
      XERO_TOKEN_ENCRYPTION_KEY: "replace-with-a-long-random-secret-before-vps"
    }),
    /SESSION_SECRET must be set/
  );
});

test("production config uses secure cookies when deployment secrets are present", async () => {
  const { config } = await importConfigWithEnv({
    DATABASE_URL: "postgres://ziffer:secret@postgres:5432/ziffer_billing",
    NODE_ENV: "production",
    SESSION_SECRET: "session-secret-with-more-than-thirty-two-characters",
    TEAMWORK_API_KEY: "teamwork-api-key",
    XERO_CLIENT_ID: "xero-client-id",
    XERO_CLIENT_SECRET: "xero-client-secret",
    XERO_REDIRECT_URI: "https://app.ziffer.lu/api/xero/callback",
    XERO_RETURN_URL: "https://app.ziffer.lu/#billing-create-quote",
    XERO_TOKEN_ENCRYPTION_KEY: "xero-token-key-with-more-than-thirty-two-characters"
  });

  assert.equal(config.cookieSecure, true);
  assert.equal(config.xeroRedirectUri, "https://app.ziffer.lu/api/xero/callback");
});

test("production config rejects localhost Xero callback URLs", async () => {
  await assert.rejects(
    () => importConfigWithEnv({
      DATABASE_URL: "postgres://ziffer:secret@postgres:5432/ziffer_billing",
      NODE_ENV: "production",
      SESSION_SECRET: "session-secret-with-more-than-thirty-two-characters",
      TEAMWORK_API_KEY: "teamwork-api-key",
      XERO_CLIENT_ID: "xero-client-id",
      XERO_CLIENT_SECRET: "xero-client-secret",
      XERO_REDIRECT_URI: "http://localhost:3000/api/xero/callback",
      XERO_RETURN_URL: "https://app.ziffer.lu/#billing-create-quote",
      XERO_TOKEN_ENCRYPTION_KEY: "xero-token-key-with-more-than-thirty-two-characters"
    }),
    /XERO_REDIRECT_URI must be a public HTTPS URL/
  );
});
