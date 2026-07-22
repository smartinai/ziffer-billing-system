import assert from "node:assert/strict";
import test from "node:test";
import { operationsTestHooks } from "./operationsRepository.js";

test("operational messages redact common credential fields", () => {
  const value = operationsTestHooks.sanitizeText("token=abc secret:xyz password=hunter2");
  assert.equal(value, "token=[redacted] secret=[redacted] password=[redacted]");
});

test("operational metadata removes payloads and secrets", () => {
  assert.deepEqual(operationsTestHooks.safeMetadata({
    count: 3,
    password: "bad",
    responsePayload: { token: "bad" },
    summary: "authorization=hidden"
  }), {
    count: 3,
    summary: "authorization=[redacted]"
  });
});
