import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveRateForEntry,
  mariaRateForEntry,
  normalizeMariaRole
} from "./mariaRoleRates.js";

test("resolves Maria's director and standard rates", () => {
  assert.equal(mariaRateForEntry({
    defaultRate: 500,
    mariaRole: "director",
    mariaTeamworkUserId: "maria",
    userId: "maria"
  }), 300);
  assert.equal(mariaRateForEntry({
    defaultRate: 500,
    mariaRole: "standard",
    mariaTeamworkUserId: "maria",
    userId: "maria"
  }), 750);
});

test("preserves normal rates for other users and missing Maria configuration", () => {
  assert.equal(mariaRateForEntry({
    defaultRate: 275,
    mariaRole: "director",
    mariaTeamworkUserId: "maria",
    userId: "other"
  }), 275);
  assert.equal(mariaRateForEntry({
    defaultRate: 275,
    mariaRole: "director",
    mariaTeamworkUserId: "",
    userId: "maria"
  }), 275);
});

test("uses the project role and safely normalizes unsupported roles", () => {
  assert.equal(effectiveRateForEntry({
    defaultRate: 750,
    mariaRolesByProject: new Map([["p1", "director"]]),
    mariaTeamworkUserId: "maria",
    projectId: "p1",
    userId: "maria"
  }), 300);
  assert.equal(normalizeMariaRole("unexpected"), "standard");
});
