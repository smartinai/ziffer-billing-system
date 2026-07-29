import assert from "node:assert/strict";
import { test } from "node:test";
import { bumpVersion } from "./semver.js";

test("bumps semantic versions according to release impact", () => {
  assert.equal(bumpVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(bumpVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(bumpVersion("1.2.3", "major"), "2.0.0");
});

test("rejects invalid versions and release types", () => {
  assert.throws(() => bumpVersion("v1.2.3", "patch"), /Invalid semantic version/);
  assert.throws(() => bumpVersion("1.2.3", "feature"), /Invalid release type/);
});
