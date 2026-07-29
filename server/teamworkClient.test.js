import assert from "node:assert/strict";
import test from "node:test";
import { buildTimeEntryBillableUpdate } from "./teamworkClient.js";

test("builds the Teamwork v3 billable time-entry patch", () => {
  assert.deepEqual(buildTimeEntryBillableUpdate(false), {
    timelog: {
      isBillable: false
    }
  });
  assert.deepEqual(buildTimeEntryBillableUpdate(true), {
    timelog: {
      isBillable: true
    }
  });
});
