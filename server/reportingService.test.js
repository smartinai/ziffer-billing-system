import assert from "node:assert/strict";
import test from "node:test";
import { config } from "./config.js";
import { reportingServiceTestHooks } from "./reportingService.js";

test("incremental sync starts inclusively from the latest successful coverage date", () => {
  assert.deepEqual(reportingServiceTestHooks.syncRange({
    checkpoint: { coverageEnd: "2026-07-15", coverageStart: "2026-01-01" },
    endDate: "2026-07-16",
    mode: "incremental"
  }), {
    coverageStart: "2026-01-01",
    fetchEnd: "2026-07-16",
    fetchStart: "2026-07-15"
  });
});

test("incremental sync falls back to the configured start date without a checkpoint", () => {
  assert.deepEqual(reportingServiceTestHooks.syncRange({
    checkpoint: null,
    endDate: "2026-07-16",
    mode: "incremental"
  }), {
    coverageStart: config.defaultStartDate,
    fetchEnd: "2026-07-16",
    fetchStart: config.defaultStartDate
  });
});

test("incremental cache merging preserves historical rows and replaces matching IDs", () => {
  const merged = reportingServiceTestHooks.mergeIncrementalStore({
    projects: [{ id: "p1", name: "Old" }],
    timeEntries: [{ id: "e1", hours: 1 }, { id: "e2", hours: 2 }],
    users: [{ id: "u1", name: "Old" }]
  }, {
    coverageEnd: "2026-07-16",
    projects: [{ id: "p1", name: "Updated" }, { id: "p2", name: "New" }],
    timeEntries: [{ id: "e2", hours: 3 }, { id: "e3", hours: 4 }],
    users: [{ id: "u1", name: "Updated" }]
  });

  assert.deepEqual(merged.projects, [{ id: "p1", name: "Updated" }, { id: "p2", name: "New" }]);
  assert.deepEqual(merged.timeEntries, [
    { id: "e1", hours: 1 },
    { id: "e2", hours: 3 },
    { id: "e3", hours: 4 }
  ]);
  assert.equal(merged.coverageEnd, "2026-07-16");
});

test("scheduled dates use Europe Amsterdam across a UTC date boundary", () => {
  assert.equal(
    reportingServiceTestHooks.dateInTimezone(new Date("2026-07-15T22:30:00Z"), "Europe/Amsterdam"),
    "2026-07-16"
  );
});
