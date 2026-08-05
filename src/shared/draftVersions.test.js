import assert from "node:assert/strict";
import test from "node:test";
import { draftResponseIsCurrent } from "./draftVersions.js";

test("accepts the current and newer draft response versions", () => {
  assert.equal(draftResponseIsCurrent(7, 7), true);
  assert.equal(draftResponseIsCurrent(7, 8), true);
});

test("rejects a response older than the locally accepted draft version", () => {
  assert.equal(draftResponseIsCurrent(8, 7), false);
});

test("keeps compatibility with responses that do not contain a version", () => {
  assert.equal(draftResponseIsCurrent(8, undefined), true);
});
