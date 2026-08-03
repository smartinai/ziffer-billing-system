import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileAnnualUsage } from "./annualReconciliation.js";

const clients = [{ id: "c1", displayName: "TDINVEST S.A. SPF", teamworkProjectId: "p1", xeroClientName: "TDINVEST S.A., SPF" }];
const services = [
  { id: "agm", aliases: ["AGM"], annualInvoiceEligible: true, label: "AGM / Publication", serviceKey: "agm_publication", sortOrder: 1 },
  { id: "records", aliases: ["Maintaining corporate records"], annualInvoiceEligible: true, label: "Maintain corporate records", serviceKey: "maintain_corporate_records", sortOrder: 2 }
];
const matrixRows = [
  ["Year", 2025, 2026],
  ["Standard max. hours", 6, 6],
  ["Client / Service", "AGM, Publication", "AGM, Publication"],
  ["TDINVEST S.A. SPF", 6, 8]
];

test("reconciles spreadsheet prepaid hours with Teamwork used hours and excludes July 2026", () => {
  const result = reconcileAnnualUsage({
    clients,
    matrixRows,
    services,
    entries: [
      { date: "2025-06-01", hours: 1.5, isBillable: true, projectId: "p1", taskName: "AGM 2025" },
      { date: "2026-06-30", hours: 2, isBillable: true, projectId: "p1", taskName: "AGM 2026" },
      { date: "2026-07-01", hours: 9, isBillable: true, projectId: "p1", taskName: "AGM 2026" }
    ]
  });

  assert.deepEqual(
    result.cells.filter((cell) => cell.serviceKey === "agm_publication").map(({ forYear, maxHours, usedHours }) => ({ forYear, maxHours, usedHours })),
    [{ forYear: 2025, maxHours: 6, usedHours: 1.5 }, { forYear: 2026, maxHours: 8, usedHours: 2 }]
  );
});

test("creates exact 12 hour corporate-record period rows", () => {
  const result = reconcileAnnualUsage({
    clients,
    matrixRows,
    services,
    entries: [{ date: "2026-05-01", hours: 3.25, isBillable: true, projectId: "p1", taskName: "Maintaining corporate records 29.01.2026-28.01.2027" }]
  });
  const cell = result.cells.find((row) => row.serviceKey === "maintain_corporate_records");
  assert.equal(cell.maxHours, 12);
  assert.equal(cell.usedHours, 3.25);
  assert.equal(cell.coverageStart, "2026-01-29");
  assert.equal(cell.coverageEnd, "2027-01-28");
});

test("prefers an exact display name when another client shares the same Xero name", () => {
  const result = reconcileAnnualUsage({
    clients: [
      { id: "microfin", displayName: "Microfininvest S.A.", teamworkProjectId: "p1", xeroClientName: "Microfininvest S.A." },
      { id: "rose", displayName: "Rose Consulting S.à r.l.", teamworkProjectId: "p2", xeroClientName: "Microfininvest S.A." }
    ],
    entries: [],
    matrixRows: [
      ["", 2025],
      [],
      ["", "AGM / Publication"],
      ["Microfininvest S.A.", 6]
    ],
    services: [{ annualInvoiceEligible: true, id: "agm", label: "AGM / Publication", serviceKey: "agm_publication" }]
  });

  assert.deepEqual(result.unmatchedClients, []);
  assert.equal(result.cells[0].billingClientId, "microfin");
});
