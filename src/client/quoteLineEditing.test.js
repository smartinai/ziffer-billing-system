import assert from "node:assert/strict";
import test from "node:test";
import {
  hasQuoteLineHoursOverride,
  inlineQuoteLineDraftValue,
  normalizeInlineQuoteLineValue,
  sourceHoursForQuoteLine
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

test("creates stable drafts for inline cells", () => {
  assert.equal(inlineQuoteLineDraftValue({ taskName: "Task" }, "taskName"), "Task");
  assert.equal(inlineQuoteLineDraftValue({ quantityHours: 0.25 }, "quantityHours"), "0.25");
});
