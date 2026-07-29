import assert from "node:assert/strict";
import test from "node:test";
import { syncBillableStateToTeamwork } from "./teamworkBillableSync.js";

test("mirrors successful Teamwork billable updates into stored source data", async () => {
  const storedCalls = [];
  const result = await syncBillableStateToTeamwork(
    { entryIds: ["10", "10", "11"], isBillable: false, quotePreviewId: "draft-1" },
    {
      updateRemote: async () => ({ failures: [], updatedEntryIds: ["10", "11"] }),
      updateStored: async (...args) => storedCalls.push(args)
    }
  );

  assert.deepEqual(result, { failedEntryIds: [], ok: true, updatedCount: 2 });
  assert.deepEqual(storedCalls, [[["10", "11"], false]]);
});

test("logs Teamwork failures without rejecting the saved draft operation", async () => {
  const auditCalls = [];
  const errorCalls = [];
  const storedCalls = [];
  const result = await syncBillableStateToTeamwork(
    { actor: { sub: "Editor" }, entryIds: ["10", "11"], isBillable: true, quotePreviewId: "draft-2" },
    {
      logError: (message) => errorCalls.push(message),
      recordAudit: async (event) => auditCalls.push(event),
      updateRemote: async () => ({
        failures: [{ entryId: "11", message: "Teamwork request failed (403)" }],
        updatedEntryIds: ["10"]
      }),
      updateStored: async (...args) => storedCalls.push(args)
    }
  );

  assert.deepEqual(result, { failedEntryIds: ["11"], ok: false, updatedCount: 1 });
  assert.deepEqual(storedCalls, [[["10"], true]]);
  assert.equal(errorCalls.length, 1);
  assert.equal(auditCalls[0].action, "teamwork_billable_sync_error");
  assert.deepEqual(auditCalls[0].metadata.failedEntryIds, ["11"]);
});
