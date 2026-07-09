import assert from "node:assert/strict";
import { test } from "node:test";

const originalDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = "";

const [{ app }, { authTestHooks }] = await Promise.all([
  import(`./index.js?csrf-flow-test=${Date.now()}`),
  import("./auth.js")
]);

if (originalDatabaseUrl) {
  process.env.DATABASE_URL = originalDatabaseUrl;
}

const SESSION_COOKIE_NAME = "ziffer_session";

function listen() {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => resolve(server));
    server.on("error", reject);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function baseUrl(server) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function testSessionCookie() {
  const sessionToken = authTestHooks.createSessionToken({
    displayName: "Test Admin",
    email: "security-test@example.com",
    id: "security-test-user",
    roles: ["admin"]
  });
  return `${SESSION_COOKIE_NAME}=${sessionToken}`;
}

test("authenticated write flow rejects missing CSRF and accepts a valid CSRF token", async () => {
  const server = await listen();
  const cookie = testSessionCookie();

  try {
    const csrfResponse = await fetch(`${baseUrl(server)}/api/auth/csrf`, {
      headers: { Cookie: cookie }
    });
    assert.equal(csrfResponse.status, 200);

    const { csrfToken } = await csrfResponse.json();
    assert.ok(csrfToken);

    const rejectedWrite = await fetch(`${baseUrl(server)}/api/auth/logout`, {
      headers: { Cookie: cookie },
      method: "POST"
    });
    assert.equal(rejectedWrite.status, 403);

    const acceptedWrite = await fetch(`${baseUrl(server)}/api/auth/logout`, {
      headers: {
        Cookie: cookie,
        "x-csrf-token": csrfToken
      },
      method: "POST"
    });
    assert.equal(acceptedWrite.status, 200);

    const payload = await acceptedWrite.json();
    assert.equal(payload.authenticated, false);
  } finally {
    await close(server);
  }
});
