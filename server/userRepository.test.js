import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "./userRepository.js";

test("hashes and verifies user passwords without storing the plain text", async () => {
  const password = "Ziffer-Test-1A!b23cD";
  const hash = await hashPassword(password);

  assert.match(hash, /^scrypt:/);
  assert.equal(hash.includes(password), false);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("rejects short passwords", async () => {
  await assert.rejects(() => hashPassword("short"), /at least 10 characters/);
});
