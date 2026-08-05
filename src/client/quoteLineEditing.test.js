import assert from "node:assert/strict";
import test from "node:test";
import {
  hasQuoteEntryRateOverride,
  hasQuoteLineHoursOverride,
  hasQuoteLineValueOverride,
  inlineQuoteLineDraftValue,
  normalizeInlineQuoteLineValue,
  sourceEntryIdsForQuoteTask,
  sourceHoursForQuoteLine,
  sourceRateForQuoteEntry,
  sourceValueForQuoteLine
} from "./quoteLineEditing.js";

test("normalizes inline task and numeric values", () => {
  assert.equal(normalizeInlineQuoteLineValue("taskName", "  Annual   accounts "), "Annual accounts");
  assert.equal(normalizeInlineQuoteLineValue("quantityHours", "1,25"), 1.25);
  assert.equal(normalizeInlineQuoteLineValue("unitAmount", "300,50"), 300.5);
  assert.equal(normalizeInlineQuoteLineValue("discount", "12,5%"), 12.5);
});

test("rejects invalid inline values", () => {
  assert.throws(() => normalizeInlineQuoteLineValue("taskName", "  "), /Task name is required/);
  assert.throws(() => normalizeInlineQuoteLineValue("quantityHours", "-1"), /Hours must be zero or more/);
  assert.throws(() => normalizeInlineQuoteLineValue("discount", "101"), /between 0 and 100/);
});

test("detects task quantity overrides without changing source entries", () => {
  const line = { entries: [{ hours: 0.25 }, { hours: 0.5 }], quantityHours: 0.6 };
  assert.equal(sourceHoursForQuoteLine(line), 0.75);
  assert.equal(hasQuoteLineHoursOverride(line), true);
  assert.deepEqual(line.entries, [{ hours: 0.25 }, { hours: 0.5 }]);
  assert.equal(hasQuoteLineHoursOverride({ ...line, quantityHours: 0.75 }), false);
  assert.equal(hasQuoteLineHoursOverride({ ...line, annualCovered: true }), false);
});

test("detects rate and discount overrides from generated draft values", () => {
  const line = {
    discount: 20,
    generatedValues: { discount: 10, quantityHours: 2, unitAmount: 300 },
    quantityHours: 3,
    unitAmount: 120
  };

  assert.equal(sourceHoursForQuoteLine(line), 2);
  assert.equal(hasQuoteLineHoursOverride(line), true);
  assert.equal(sourceValueForQuoteLine(line, "unitAmount"), 300);
  assert.equal(hasQuoteLineValueOverride(line, "unitAmount"), true);
  assert.equal(sourceValueForQuoteLine(line, "discount"), 10);
  assert.equal(hasQuoteLineValueOverride(line, "discount"), true);
  assert.equal(hasQuoteLineValueOverride({ ...line, unitAmount: 300 }, "unitAmount"), false);
  assert.equal(hasQuoteLineValueOverride({ ...line, discount: 10 }, "discount"), false);
});

test("creates stable drafts for inline cells", () => {
  assert.equal(inlineQuoteLineDraftValue({ taskName: "Task" }, "taskName"), "Task");
  assert.equal(inlineQuoteLineDraftValue({ quantityHours: 0.25 }, "quantityHours"), "0.25");
});

test("collects every source entry for a task without crossing into another task", () => {
  const target = {
    entries: [{ id: "entry-1" }],
    sourceTimeEntryIds: ["entry-1", "entry-2"],
    sourceType: "teamwork",
    taskId: "task-a"
  };
  const lines = [
    target,
    { entries: [{ id: "entry-2" }, { id: "entry-3" }], sourceType: "teamwork", taskId: "task-a" },
    { entries: [{ id: "entry-4" }], sourceType: "teamwork", taskId: "task-b" },
    { entries: [], sourceType: "manual", taskId: "task-a" }
  ];

  assert.deepEqual(sourceEntryIdsForQuoteTask(lines, target), ["entry-1", "entry-2", "entry-3"]);
  assert.deepEqual(sourceEntryIdsForQuoteTask(lines, lines[3]), []);
});

test("detects entry-rate overrides against the immutable source rate", () => {
  const entry = { originalUserRate: 300, userRate: 275 };
  assert.equal(sourceRateForQuoteEntry(entry), 300);
  assert.equal(hasQuoteEntryRateOverride(entry), true);
  assert.equal(hasQuoteEntryRateOverride({ ...entry, userRate: 300 }), false);
  assert.equal(sourceRateForQuoteEntry({ userRate: 250 }), 250);
});
