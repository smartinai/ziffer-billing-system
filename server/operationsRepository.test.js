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

test("operation components collapse derived Teamwork, Xero, and database checks", () => {
  const components = operationsTestHooks.buildOperationComponents({
    database: { checkedAt: "2026-07-23T12:00:00Z", database: "ziffer", ok: true },
    failureByType: new Map(),
    latestRows: [
      { operation_type: "teamwork_sync", status: "complete" },
      { operation_type: "xero_status", status: "complete" },
      { operation_type: "database_health", status: "complete" },
      { operation_type: "backup", status: "complete", finished_at: "2026-07-23T02:15:00Z", metadata: {} }
    ],
    successByType: new Map([
      ["teamwork_sync", "2026-07-23T00:10:00Z"],
      ["xero_status", "2026-07-23T11:00:00Z"]
    ]),
    teamwork: { coverage_end: "2026-07-22", finished_at: "2026-07-23T00:10:00Z", status: "complete" },
    xero: { failures: 0, last_sync: "2026-07-23T11:00:00Z" }
  });

  assert.deepEqual(components.map((component) => component.component), ["backup", "database", "teamwork", "xero"]);
});
