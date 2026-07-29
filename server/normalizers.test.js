import assert from "node:assert/strict";
import { test } from "node:test";
import { enrichTimeEntriesWithTasks, normalizeTimeEntries } from "./normalizers.js";

test("normalizes invoice-ready Teamwork time-entry fields", () => {
  const [entry] = normalizeTimeEntries([
    {
      billable: "false",
      createdAt: "2026-06-01T10:00:00Z",
      date: "2026-06-02",
      description: "Prepared annual accounts",
      durationMinutes: 90,
      id: 123,
      projectBillingInvoiceId: 456,
      project: { id: "project-1" },
      tags: [{ name: "Annual" }, "Review"],
      task: { id: "task-1", name: "Financial statements" },
      updatedAt: "2026-06-03T11:00:00Z",
      user: { id: "user-1" }
    }
  ]);

  assert.equal(entry.id, "123");
  assert.equal(entry.isBillable, false);
  assert.equal(entry.taskId, "task-1");
  assert.equal(entry.taskName, "Financial statements");
  assert.equal(entry.teamworkInvoiceId, "456");
  assert.deepEqual(entry.tags, ["Annual", "Review"]);
  assert.equal(entry.sourceCreatedAt, "2026-06-01T10:00:00Z");
  assert.equal(entry.sourceUpdatedAt, "2026-06-03T11:00:00Z");
});

test("treats Teamwork billable type strings as booleans", () => {
  const entries = normalizeTimeEntries([
    { billableType: "billable", date: "2026-06-01", id: "1", minutes: 30 },
    { billableType: "non-billable", date: "2026-06-01", id: "2", minutes: 30 }
  ]);

  assert.equal(entries[0].isBillable, true);
  assert.equal(entries[1].isBillable, false);
});

test("enriches time entries with bulk-fetched Teamwork task titles", () => {
  const rows = enrichTimeEntriesWithTasks(
    [
      { id: 1, task: { id: 101, type: "tasks" } },
      { id: 2, taskId: 102, taskName: "Already named" },
      { id: 3, taskId: 999 }
    ],
    [
      { id: 101, name: "Maintain corporate records July 2026 - June 2027" },
      { id: 102, name: "Replacement title" }
    ]
  );

  assert.equal(rows[0].taskName, "Maintain corporate records July 2026 - June 2027");
  assert.equal(rows[1].taskName, "Already named");
  assert.equal(rows[2].taskName, undefined);
});
