import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachReportingClassifications,
  buildReportingClassifications,
  reportingClassificationTestHooks
} from "./reportingClassification.js";

const users = [{ id: "u1", name: "Ada", userRate: 100 }];
const projects = [
  { id: "p1", name: "Client project" },
  { id: "p2", name: "Internal project" }
];
const billingClients = [
  { id: "c1", status: "active", teamworkProjectId: "p1", xeroContactId: "x1" },
  { id: "c2", status: "active", teamworkProjectId: "p2", xeroContactId: "" }
];

test("classifies dual money and time metrics at every reporting grain", () => {
  const result = buildReportingClassifications({
    allowedProjectIds: ["p1", "p2"],
    billingClients,
    endDate: "2026-07-31",
    projects,
    startDate: "2026-07-01",
    timeEntries: [
      { date: "2026-07-02", hours: 10, id: "e1", isBillable: true, projectId: "p1", userId: "u1" },
      { date: "2026-07-03", hours: 2, id: "e2", isBillable: false, projectId: "p1", userId: "u1" },
      { date: "2026-07-04", hours: 3, id: "e3", isBillable: false, projectId: "p2", userId: "u1" }
    ],
    users,
    writeOffs: [{ amount: 200, entryId: "e1", hours: 2, projectId: "p1", userId: "u1" }]
  });

  assert.deepEqual(result.byUser.u1, {
    totalTeamwork: { amount: 1500, hours: 15 },
    totalBillable: { amount: 1000, hours: 10 },
    prepaid: { amount: 0, hours: 0 },
    estimatedPrepaid: { amount: 0, hours: 0 },
    confirmedPrepaid: { amount: 0, hours: 0 },
    confirmedXero: { amount: 0, hours: 0 },
    estimatedBillable: { amount: 0, hours: 0 },
    effectiveBillable: { amount: 200, hours: 2 },
    fixedFees: { amount: 0, hours: 0 },
    netBillable: { amount: 1000, hours: 10 },
    writeOffs: { amount: 200, hours: 2 },
    nonBillable: { amount: 500, hours: 5 },
    internalNonBillable: { amount: 300, hours: 3 }
  });
  assert.equal(result.byProject.p1.internalNonBillable.hours, 0);
  assert.equal(result.byUserProject["u1:p2"].internalNonBillable.hours, 3);
});

test("estimates prepaid allocations chronologically from Teamwork", () => {
  const services = [{
    aliases: ["vat", "value added tax"],
    annualInvoiceEligible: true,
    id: "vat",
    label: "VAT / Value added tax",
    serviceKey: "value_added_tax",
    sortOrder: 10
  }];
  const result = buildReportingClassifications({
    allowedProjectIds: ["p1"],
    annualUsage: [{
      annualHours: 4,
      billingClientId: "c1",
      serviceId: "vat",
      usageId: "usage-1",
      usedHours: 0,
      year: 2026
    }],
    billingClients,
    endDate: "2026-07-31",
    projects,
    services,
    startDate: "2026-07-01",
    timeEntries: [
      { date: "2026-01-10", hours: 3, id: "before", isBillable: true, projectId: "p1", taskId: "t1", taskName: "VAT 2026", userId: "u1" },
      { date: "2026-07-10", hours: 2, id: "inside", isBillable: true, projectId: "p1", taskId: "t2", taskName: "VAT 2026", userId: "u1" }
    ],
    users
  });

  assert.deepEqual(result.byUser.u1.prepaid, { amount: 100, hours: 1 });
  assert.deepEqual(result.byUser.u1.estimatedPrepaid, { amount: 100, hours: 1 });
  assert.deepEqual(result.byUser.u1.confirmedPrepaid, { amount: 0, hours: 0 });
  assert.deepEqual(result.byUser.u1.netBillable, { amount: 100, hours: 1 });
  assert.deepEqual(result.byUser.u1.estimatedBillable, { amount: 100, hours: 1 });
  assert.deepEqual(result.byUser.u1.effectiveBillable, { amount: 100, hours: 1 });
});

test("uses confirmed Xero invoice allocations ahead of Teamwork prepaid estimates", () => {
  const services = [{
    aliases: ["vat"],
    annualInvoiceEligible: true,
    id: "vat",
    label: "VAT / Value added tax",
    serviceKey: "value_added_tax",
    sortOrder: 10
  }];
  const result = buildReportingClassifications({
    allowedProjectIds: ["p1"],
    annualUsage: [{
      annualHours: 4,
      billingClientId: "c1",
      serviceId: "vat",
      usageId: "usage-1",
      usedHours: 0,
      year: 2026
    }],
    billingClients,
    confirmedAllocations: [
      { amount: 25, entryId: "confirmed-prepaid", hours: 0.25, projectId: "p1", type: "prepaid", userId: "u1" },
      { amount: 75, entryId: "confirmed-billed", hours: 0.75, projectId: "p1", type: "xero_billed", userId: "u1" }
    ],
    endDate: "2026-07-31",
    projects,
    services,
    startDate: "2026-07-01",
    timeEntries: [
      { date: "2026-07-10", hours: 0.25, id: "confirmed-prepaid", isBillable: true, projectId: "p1", taskName: "VAT 2026", userId: "u1" },
      { date: "2026-07-11", hours: 0.75, id: "confirmed-billed", isBillable: true, projectId: "p1", taskName: "VAT 2026", userId: "u1" },
      { date: "2026-07-12", hours: 1, id: "estimate-only", isBillable: true, projectId: "p1", taskName: "VAT 2026", userId: "u1" }
    ],
    users
  });

  assert.deepEqual(result.byUser.u1.confirmedPrepaid, { amount: 25, hours: 0.25 });
  assert.deepEqual(result.byUser.u1.confirmedXero, { amount: 75, hours: 0.75 });
  assert.deepEqual(result.byUser.u1.estimatedPrepaid, { amount: 100, hours: 1 });
  assert.deepEqual(result.byUser.u1.prepaid, { amount: 125, hours: 1.25 });
  assert.deepEqual(result.byUser.u1.estimatedBillable, { amount: 0, hours: 0 });
  assert.deepEqual(result.byUser.u1.effectiveBillable, { amount: 75, hours: 0.75 });
});

test("caps subsets so reporting invariants cannot be exceeded", () => {
  const value = reportingClassificationTestHooks.finalizeClassification({
    ...reportingClassificationTestHooks.emptyClassification(),
    totalBillable: { amount: 100, hours: 1 },
    prepaid: { amount: 25, hours: 0.25 },
    writeOffs: { amount: 1000, hours: 10 },
    nonBillable: { amount: 20, hours: 0.2 },
    internalNonBillable: { amount: 100, hours: 1 }
  });
  assert.deepEqual(value.netBillable, { amount: 75, hours: 0.75 });
  assert.deepEqual(value.writeOffs, { amount: 75, hours: 0.75 });
  assert.deepEqual(value.internalNonBillable, { amount: 20, hours: 0.2 });
});

test("attaches classifications to top-level and drilldown rows", () => {
  const classification = reportingClassificationTestHooks.finalizeClassification(
    reportingClassificationTestHooks.emptyClassification()
  );
  const report = attachReportingClassifications({
    byProject: [{ id: "p1", peopleBreakdown: [{ id: "u1" }] }],
    byUser: [{ id: "u1", projectBreakdown: [{ id: "p1" }] }]
  }, {
    byProject: { p1: classification },
    byProjectUser: { "p1:u1": classification },
    byUser: { u1: classification },
    byUserProject: { "u1:p1": classification }
  });
  assert.deepEqual(report.byUser[0].hourClassification, classification);
  assert.deepEqual(report.byProject[0].peopleBreakdown[0].hourClassification, classification);
});
