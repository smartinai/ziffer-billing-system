import assert from "node:assert/strict";
import test from "node:test";
import { runScheduledTeamworkSync } from "./scheduledTeamworkSync.js";

test("scheduled sync stops retrying after the first success and records the final outcome", async () => {
  const records = [];
  const delays = [];
  let calls = 0;
  const result = await runScheduledTeamworkSync({
    attempts: 4,
    delay: async (ms) => delays.push(ms),
    record: async (event) => records.push(event),
    retryDelayMs: 600000,
    sync: async ({ attempt }) => {
      calls += 1;
      if (attempt < 3) throw new Error("temporary failure");
      return {
        coverageEnd: "2026-07-16",
        coverageStart: "2026-01-01",
        database: { syncRunId: "run-3" }
      };
    }
  });

  assert.equal(result.attempt, 3);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [600000, 600000]);
  assert.equal(records.length, 1);
  assert.equal(records[0].action, "teamwork_sync_scheduled_success");
});

test("scheduled sync records one final failure after all attempts", async () => {
  const records = [];
  let calls = 0;
  await assert.rejects(() => runScheduledTeamworkSync({
    attempts: 4,
    delay: async () => {},
    record: async (event) => records.push(event),
    retryDelayMs: 0,
    sync: async () => {
      calls += 1;
      throw new Error("secret upstream response");
    }
  }), /secret upstream response/);

  assert.equal(calls, 4);
  assert.equal(records.length, 1);
  assert.equal(records[0].action, "teamwork_sync_scheduled_failure");
  assert.doesNotMatch(records[0].metadata.message, /secret upstream response/);
});
