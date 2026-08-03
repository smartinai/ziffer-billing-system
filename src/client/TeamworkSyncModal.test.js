import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSyncElapsed } from "./teamworkSyncPresentation.js";

test("formats Teamwork sync elapsed time compactly", () => {
  assert.equal(formatSyncElapsed(0), "0s");
  assert.equal(formatSyncElapsed(9), "9s");
  assert.equal(formatSyncElapsed(65), "1m 05s");
  assert.equal(formatSyncElapsed(-5), "0s");
});
