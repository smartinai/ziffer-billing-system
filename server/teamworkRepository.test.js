import assert from "node:assert/strict";
import test from "node:test";
import { teamworkRepositoryTestHooks } from "./teamworkRepository.js";

test("reconstructs a reporting store from normalized PostgreSQL rows", () => {
  const store = teamworkRepositoryTestHooks.buildTeamworkStoreFromDatabaseRows({
    projects: [{
      company_id: "company-1",
      company_name: "Client One",
      id: "project-1",
      is_billable: true,
      name: "Client One",
      status: "active"
    }],
    run: {
      coverage_end: "2026-07-14",
      coverage_start: "2026-01-01",
      finished_at: new Date("2026-07-14T20:21:13.729Z"),
      id: "run-1",
      source: { api: { pagesFetched: 12, partial: false, warnings: [] } }
    },
    timeEntries: [{
      created_at_source: new Date("2026-07-10T10:00:00Z"),
      description: "Review",
      hours: "0.2500",
      id: "entry-1",
      is_billable: true,
      logged_on: "2026-07-10",
      minutes: 15,
      project_id: "project-1",
      tags: ["tax"],
      task_id: "task-1",
      task_name: "VAT",
      teamwork_invoice_id: "",
      updated_at_source: null,
      user_id: "user-1"
    }],
    users: [{
      avatar_url: "",
      company_id: "company-1",
      email: "person@ziffer.lu",
      id: "user-1",
      name: "Person One",
      user_cost: "100.00",
      user_rate: "300.00"
    }]
  });

  assert.equal(store.coverageStart, "2026-01-01");
  assert.equal(store.coverageEnd, "2026-07-14");
  assert.equal(store.database.restoredFromDatabase, true);
  assert.equal(store.users[0].userRate, 300);
  assert.equal(store.projects[0].companyName, "Client One");
  assert.equal(store.timeEntries[0].hours, 0.25);
  assert.equal(store.timeEntries[0].date, "2026-07-10");
  assert.deepEqual(store.timeEntries[0].tags, ["tax"]);
});

test("does not build a reporting store without a complete sync run", () => {
  assert.equal(teamworkRepositoryTestHooks.buildTeamworkStoreFromDatabaseRows({ projects: [], run: null, users: [] }), null);
});

test("normalizes persisted Teamwork sync status rows", () => {
  assert.deepEqual(teamworkRepositoryTestHooks.syncRunSummary({
    attempt: 2,
    coverage_end: "2026-07-16",
    coverage_start: "2026-01-01",
    error_message: "",
    fetch_end: "2026-07-16",
    fetch_start: "2026-07-15",
    finished_at: new Date("2026-07-16T00:02:00Z"),
    id: "run-2",
    partial: false,
    started_at: new Date("2026-07-16T00:00:00Z"),
    status: "complete",
    trigger: "scheduled"
  }), {
    attempt: 2,
    coverageEnd: "2026-07-16",
    coverageStart: "2026-01-01",
    errorMessage: "",
    fetchEnd: "2026-07-16",
    fetchStart: "2026-07-15",
    finishedAt: "2026-07-16T00:02:00.000Z",
    id: "run-2",
    partial: false,
    startedAt: "2026-07-16T00:00:00.000Z",
    status: "complete",
    trigger: "scheduled"
  });
});
