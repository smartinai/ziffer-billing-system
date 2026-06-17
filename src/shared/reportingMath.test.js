import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport } from "./reportingMath.js";

const users = [
  { id: "u1", name: "Ada", email: "ada@ziffer.lu", userRate: 200, avatarUrl: "https://example.com/ada.png" },
  { id: "u2", name: "Ben", email: "ben@ziffer.lu", userRate: 150 },
  { id: "u3", name: "No Rate", email: "norate@ziffer.lu", userRate: 0 }
];

const projects = [
  { id: "p1", name: "Holding Structure", companyName: "Client A" },
  { id: "p2", name: "Residency", companyName: "Client B" }
];

test("calculates totals, billable hours, and money from user rates", () => {
  const report = buildReport({
    endDate: "2026-04-30",
    projects,
    startDate: "2026-04-01",
    timeEntries: [
      { date: "2026-04-02", id: "1", isBillable: true, minutes: 120, projectId: "p1", userId: "u1" },
      { date: "2026-04-03", id: "2", isBillable: false, minutes: 60, projectId: "p1", userId: "u1" },
      { date: "2026-04-04", id: "3", isBillable: true, minutes: 30, projectId: "p2", userId: "u2" }
    ],
    users
  });

  assert.equal(report.totals.hours, 3.5);
  assert.equal(report.totals.billableHours, 2.5);
  assert.equal(report.totals.money, 475);
  assert.equal(report.byUser[0].name, "Ada");
  assert.equal(report.byUser[0].avatarUrl, "https://example.com/ada.png");
  assert.equal(report.byProject.length, 2);
});

test("flags billable entries for users with missing rates", () => {
  const report = buildReport({
    endDate: "2026-04-30",
    projects,
    startDate: "2026-04-01",
    timeEntries: [{ date: "2026-04-02", id: "1", isBillable: true, minutes: 60, projectId: "p1", userId: "u3" }],
    users
  });

  assert.equal(report.totals.money, 0);
  assert.equal(report.metadata.missingRates[0].name, "No Rate");
});

test("filters by date range and excludes unknown projects/users from totals", () => {
  const report = buildReport({
    endDate: "2026-04-30",
    projects,
    startDate: "2026-04-01",
    timeEntries: [
      { date: "2026-03-31", id: "1", isBillable: true, minutes: 60, projectId: "p1", userId: "u1" },
      { date: "2026-04-02", id: "2", isBillable: true, minutes: 60, projectId: "missing", userId: "u1" },
      { date: "2026-04-02", id: "3", isBillable: true, minutes: 60, projectId: "p1", userId: "missing" }
    ],
    users
  });

  assert.equal(report.totals.hours, 0);
  assert.deepEqual(report.metadata.unknownProjects, ["missing"]);
  assert.deepEqual(report.metadata.unknownUsers, ["missing"]);
});
