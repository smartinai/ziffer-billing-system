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
  assert.equal(report.totals.allMoney, 675);
  assert.equal(report.totals.billableHours, 2.5);
  assert.equal(report.totals.money, 475);
  assert.equal(report.byUser[0].name, "Ada");
  assert.equal(report.byUser[0].avatarUrl, "https://example.com/ada.png");
  assert.equal(report.byProject.length, 2);
});

test("adds people breakdowns for each project", () => {
  const report = buildReport({
    endDate: "2026-04-30",
    projects,
    startDate: "2026-04-01",
    timeEntries: [
      { date: "2026-04-02", id: "1", isBillable: true, minutes: 120, projectId: "p1", userId: "u1" },
      { date: "2026-04-03", id: "2", isBillable: false, minutes: 60, projectId: "p1", userId: "u1" },
      { date: "2026-04-04", id: "3", isBillable: true, minutes: 30, projectId: "p1", userId: "u2" }
    ],
    users
  });

  const project = report.byProject[0];
  assert.equal(project.peopleBreakdown.length, 2);
  assert.equal(project.peopleBreakdown[0].name, "Ada");
  assert.equal(project.peopleBreakdown[0].entryCount, 2);
  assert.equal(project.peopleBreakdown[0].totals.hours, 3);
  assert.equal(project.peopleBreakdown[0].totals.allMoney, 600);
  assert.equal(project.peopleBreakdown[0].totals.money, 400);
  assert.equal(project.peopleBreakdown[1].name, "Ben");
  assert.equal(project.peopleBreakdown[1].totals.hours, 0.5);
  assert.equal(project.peopleBreakdown[1].totals.money, 75);
});

test("adds project breakdowns for each person", () => {
  const report = buildReport({
    endDate: "2026-04-30",
    projects,
    startDate: "2026-04-01",
    timeEntries: [
      { date: "2026-04-02", id: "1", isBillable: true, minutes: 120, projectId: "p1", userId: "u1" },
      { date: "2026-04-03", id: "2", isBillable: false, minutes: 60, projectId: "p1", userId: "u1" },
      { date: "2026-04-04", id: "3", isBillable: true, minutes: 30, projectId: "p2", userId: "u1" }
    ],
    users
  });

  const person = report.byUser[0];
  assert.equal(person.name, "Ada");
  assert.equal(person.projectCount, 2);
  assert.equal(person.projectBreakdown.length, 2);
  assert.equal(person.projectBreakdown[0].name, "Holding Structure");
  assert.equal(person.projectBreakdown[0].entryCount, 2);
  assert.equal(person.projectBreakdown[0].totals.hours, 3);
  assert.equal(person.projectBreakdown[0].totals.allMoney, 600);
  assert.equal(person.projectBreakdown[0].totals.money, 400);
  assert.equal(person.projectBreakdown[1].name, "Residency");
  assert.equal(person.projectBreakdown[1].entryCount, 1);
  assert.equal(person.projectBreakdown[1].totals.hours, 0.5);
  assert.equal(person.projectBreakdown[1].totals.money, 100);
});

test("keeps total entry counts separate from recent entry previews", () => {
  const timeEntries = Array.from({ length: 9 }, (_, index) => ({
    date: `2026-04-${String(index + 1).padStart(2, "0")}`,
    id: `entry-${index + 1}`,
    isBillable: true,
    minutes: 30,
    projectId: "p1",
    userId: "u1"
  }));

  const report = buildReport({
    endDate: "2026-04-30",
    projects,
    startDate: "2026-04-01",
    timeEntries,
    users
  });

  assert.equal(report.byProject[0].entryCount, 9);
  assert.equal(report.byProject[0].recentEntries.length, 8);
  assert.equal(report.byUser[0].entryCount, 9);
  assert.equal(report.byUser[0].recentEntries.length, 8);
});

test("filters Teamwork projects whose names match people", () => {
  const report = buildReport({
    endDate: "2026-04-30",
    projects: [
      ...projects,
      { id: "p3", name: "Jelena Balakleiska", companyName: "" }
    ],
    startDate: "2026-04-01",
    timeEntries: [
      { date: "2026-04-02", id: "1", isBillable: true, minutes: 60, projectId: "p1", userId: "u1" },
      { date: "2026-04-03", id: "2", isBillable: true, minutes: 120, projectId: "p3", userId: "u1" }
    ],
    users: [
      ...users,
      { id: "u4", name: "Jelena Balakleiska", email: "jelena@ziffer.lu", userRate: 275 }
    ]
  });

  assert.equal(report.totals.hours, 1);
  assert.equal(report.totals.billableHours, 1);
  assert.equal(report.totals.money, 200);
  assert.deepEqual(report.byProject.map((project) => project.name), ["Holding Structure"]);
  assert.deepEqual(report.byUser[0].projects, ["Holding Structure"]);
  assert.deepEqual(report.metadata.filteredPersonProjects, [{ id: "p3", name: "Jelena Balakleiska" }]);
  assert.equal(report.yearTrend[3].hours, 1);
});

test("excludes billing clients marked as excluded from all reporting totals", () => {
  const report = buildReport({
    endDate: "2026-04-30",
    excludedProjectIds: ["p2"],
    projects,
    startDate: "2026-04-01",
    timeEntries: [
      { date: "2026-01-15", id: "before-period", isBillable: true, minutes: 60, projectId: "p2", userId: "u1" },
      { date: "2026-04-02", id: "kept", isBillable: true, minutes: 60, projectId: "p1", userId: "u1" },
      { date: "2026-04-03", id: "excluded", isBillable: true, minutes: 120, projectId: "p2", userId: "u1" }
    ],
    users
  });

  assert.equal(report.totals.hours, 1);
  assert.equal(report.totals.billableHours, 1);
  assert.equal(report.totals.money, 200);
  assert.deepEqual(report.byProject.map((project) => project.id), ["p1"]);
  assert.deepEqual(report.byUser[0].projects, ["Holding Structure"]);
  assert.deepEqual(report.metadata.excludedProjects, [{ id: "p2", name: "Residency" }]);
  assert.equal(report.yearTrend[0].hours, 0);
});

test("builds a January to December billed amount trend for the selected year", () => {
  const report = buildReport({
    endDate: "2026-06-30",
    projects,
    startDate: "2026-04-01",
    timeEntries: [
      { date: "2025-12-31", id: "previous-year", isBillable: true, minutes: 60, projectId: "p1", userId: "u1" },
      { date: "2026-01-15", id: "jan", isBillable: true, minutes: 60, projectId: "p1", userId: "u1" },
      { date: "2026-04-02", id: "apr", isBillable: true, minutes: 120, projectId: "p1", userId: "u1" },
      { date: "2026-05-02", id: "may", isBillable: false, minutes: 90, projectId: "p1", userId: "u1" }
    ],
    users
  });

  assert.equal(report.yearTrend.length, 12);
  assert.deepEqual(report.yearTrend.map((row) => row.label).slice(0, 4), ["Jan", "Feb", "Mar", "Apr"]);
  assert.equal(report.yearTrend[0].period, "2026-01");
  assert.equal(report.yearTrend[0].money, 200);
  assert.equal(report.yearTrend[3].money, 400);
  assert.equal(report.yearTrend[4].money, 0);
  assert.equal(report.totals.money, 400);
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
