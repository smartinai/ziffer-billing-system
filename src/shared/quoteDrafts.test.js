import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAggregatedQuotePreview, matchStandardService } from "./quoteDrafts.js";

const services = [
  {
    aliases: ["filing", "correspondence"],
    id: "service-filing",
    label: "Filing / Correspondence",
    serviceKey: "filing_correspondence",
    sortOrder: 10
  },
  {
    aliases: ["fs", "financial statement", "annual accounts"],
    id: "service-fs",
    label: "FS / Financial statement / Annual accounts",
    serviceKey: "financial_statements",
    sortOrder: 40
  },
  {
    aliases: ["agm", "publication"],
    id: "service-agm",
    label: "AGM / Publication",
    serviceKey: "agm_publication",
    sortOrder: 50
  },
  {
    aliases: ["vat", "value added tax"],
    id: "service-vat",
    label: "VAT / Value added tax",
    serviceKey: "value_added_tax",
    sortOrder: 60
  }
];

const billingClient = {
  accountCode: "70330001",
  currency: "EUR",
  discount: 10,
  displayName: "Client A",
  id: "client-a",
  taxRateName: "Tax on Sales 17%",
  taxType: "OUTPUT2",
  xeroClientName: "Client A S.A.",
  xeroContactId: "xero-a"
};

test("matches standardized services from task names and aliases", () => {
  assert.equal(matchStandardService("Prepare annual accounts", services).serviceKey, "financial_statements");
  assert.equal(matchStandardService("Client correspondence", services).serviceKey, "filing_correspondence");
  assert.equal(matchStandardService("Custom advisory task", services), null);
});

test("aggregates quote lines from Teamwork time and excludes already invoiced entries", () => {
  const preview = buildAggregatedQuotePreview({
    billingClient,
    entries: [
      {
        description: "Accounts work",
        hours: 2,
        id: "entry-1",
        isBillable: true,
        userName: "Ada",
        taskName: "Annual accounts",
        userRate: 200
      },
      {
        description: "Follow-up",
        hours: 1,
        id: "entry-2",
        isBillable: true,
        userName: "Ben",
        taskName: "Annual accounts",
        userRate: 200
      },
      {
        description: "Already invoiced",
        hours: 5,
        id: "entry-3",
        isBillable: true,
        taskName: "Annual accounts",
        teamworkInvoiceId: "tw-invoice-1",
        userRate: 200
      }
    ],
    periodEnd: "2026-06-30",
    periodStart: "2026-06-01",
    services
  });

  assert.equal(preview.lines.length, 1);
  assert.equal(preview.lines[0].serviceKey, "financial_statements");
  assert.equal(preview.lines[0].quantityHours, 3);
  assert.equal(preview.lines[0].amount, 540);
  assert.deepEqual(preview.lines[0].sourceTimeEntryIds, ["entry-1", "entry-2"]);
  assert.deepEqual(
    preview.lines[0].entries.map((entry) => `${entry.userName}:${entry.description}:${entry.hours}`),
    ["Ada:Accounts work:2", "Ben:Follow-up:1"]
  );
  assert.equal(preview.totals.excludedTeamworkInvoiceEntryCount, 1);
  assert.equal(preview.warnings.find((warning) => warning.type === "invoiced_in_teamwork").count, 1);
});

test("groups all source time entries by Teamwork task identity", () => {
  const preview = buildAggregatedQuotePreview({
    billingClient,
    entries: [
      {
        description: "Draft documents",
        hours: 1,
        id: "entry-1",
        isBillable: true,
        taskId: "21382078",
        taskName: "KYC Cashea Holdings Limited",
        userName: "Ada",
        userRate: 200
      },
      {
        description: "Final comments",
        hours: 0.5,
        id: "entry-2",
        isBillable: true,
        taskId: "21382078",
        taskName: "KYC Cashea Holdings Limited ",
        userName: "Ben",
        userRate: 300
      },
      {
        description: "Different task",
        hours: 2,
        id: "entry-3",
        isBillable: true,
        taskId: "21355385",
        taskName: "CRS Reporting",
        userName: "Cara",
        userRate: 250
      }
    ],
    periodEnd: "2026-05-31",
    periodStart: "2026-05-01",
    services
  });

  const kycLine = preview.lines.find((line) => line.taskId === "21382078");
  assert.equal(preview.lines.length, 2);
  assert.equal(kycLine.taskName, "KYC Cashea Holdings Limited");
  assert.equal(kycLine.quantityHours, 1.5);
  assert.equal(kycLine.rateCount, 2);
  assert.equal(kycLine.unitAmount, 233.33);
  assert.deepEqual(
    kycLine.entries.map((entry) => `${entry.userName}:${entry.description}:${entry.hours}`),
    ["Ada:Draft documents:1", "Ben:Final comments:0.5"]
  );
});

test("splits the same Teamwork task into billable and unbillable quote lines", () => {
  const preview = buildAggregatedQuotePreview({
    billingClient,
    entries: [
      {
        description: "Billable task work",
        hours: 2,
        id: "entry-1",
        isBillable: true,
        taskId: "21382078",
        taskName: "KYC Cashea Holdings Limited",
        userName: "Ada",
        userRate: 200
      },
      {
        description: "Unbillable task work",
        hours: 1,
        id: "entry-2",
        isBillable: false,
        taskId: "21382078",
        taskName: "KYC Cashea Holdings Limited",
        userName: "Ben",
        userRate: 300
      }
    ],
    periodEnd: "2026-05-31",
    periodStart: "2026-05-01",
    services
  });

  assert.equal(preview.lines.length, 2);

  const billableLine = preview.lines.find((line) => line.isBillable);
  const unbillableLine = preview.lines.find((line) => !line.isBillable);

  assert.equal(billableLine.taskName, "KYC Cashea Holdings Limited");
  assert.equal(billableLine.quantityHours, 2);
  assert.equal(billableLine.amount, 360);
  assert.deepEqual(billableLine.sourceTimeEntryIds, ["entry-1"]);

  assert.equal(unbillableLine.taskName, "KYC Cashea Holdings Limited");
  assert.equal(unbillableLine.comments, "Marked unbillable");
  assert.equal(unbillableLine.entries[0].comment, "Marked unbillable");
  assert.equal(unbillableLine.quantityHours, 1);
  assert.equal(unbillableLine.unitAmount, 300);
  assert.equal(unbillableLine.amount, 0);
  assert.deepEqual(unbillableLine.sourceTimeEntryIds, ["entry-2"]);
});

test("surfaces missing mapping, not-billed time, and zero-rate warnings", () => {
  const preview = buildAggregatedQuotePreview({
    billingClient: {
      ...billingClient,
      taxRateName: "",
      taxType: "",
      xeroClientName: "",
      xeroContactId: ""
    },
    entries: [
      {
        description: "",
        hours: 1,
        id: "entry-1",
        isBillable: false,
        taskName: "Unknown task",
        userRate: 200
      },
      {
        description: "",
        hours: 2,
        id: "entry-2",
        isBillable: true,
        taskName: "Filing",
        userRate: 0
      }
    ],
    periodEnd: "2026-06-30",
    periodStart: "2026-06-01",
    services
  });

  const warningTypes = preview.warnings.map((warning) => warning.type);
  assert.ok(warningTypes.includes("missing_xero_client"));
  assert.ok(warningTypes.includes("missing_tax_rate"));
  assert.ok(warningTypes.includes("missing_service"));
  assert.ok(warningTypes.includes("unbillable_time"));
  assert.ok(warningTypes.includes("zero_rate"));
  assert.match(
    preview.warnings.find((warning) => warning.type === "zero_rate").message,
    /no person rate/
  );
  assert.equal(preview.totals.amount, 0);
  assert.equal(preview.totals.zeroRateHours, 2);
});

test("marks matching annual invoice services as covered and removes them from the quote amount", () => {
  const preview = buildAggregatedQuotePreview({
    annualUsage: [
      {
        annualHours: 30,
        serviceId: "service-fs",
        usageId: "annual-usage-1",
        usedHours: 4,
        year: 2026
      }
    ],
    billingClient,
    entries: [
      {
        date: "2026-06-05",
        description: "Annual accounts",
        hours: 2,
        id: "entry-1",
        isBillable: true,
        taskId: "task-annual",
        taskName: "Prepare annual accounts",
        userName: "Ada",
        userRate: 200
      },
      {
        date: "2026-06-06",
        description: "Accounts follow-up",
        hours: 1,
        id: "entry-2",
        isBillable: true,
        taskId: "task-annual",
        taskName: "Prepare annual accounts",
        userName: "Ben",
        userRate: 0
      }
    ],
    periodEnd: "2026-06-30",
    periodStart: "2026-06-01",
    services
  });

  assert.equal(preview.lines.length, 1);
  assert.equal(preview.lines[0].annualCovered, true);
  assert.equal(preview.lines[0].amount, 0);
  assert.equal(preview.lines[0].includeInXero, false);
  assert.match(preview.lines[0].comments, /Covered by annual invoice \(2026\)/);
  assert.match(preview.lines[0].comments, /4h used before/);
  assert.match(preview.lines[0].comments, /3h in this doc/);
  assert.deepEqual(
    preview.lines[0].entries.map((entry) => entry.comment),
    ["Covered by annual invoice", "Covered by annual invoice"]
  );
  assert.equal(preview.totals.amount, 0);
  assert.equal(preview.totals.annualCoveredHours, 3);
  assert.equal(preview.totals.includedHours, 0);
  assert.equal(preview.totals.zeroRateHours, 0);
  assert.equal(preview.warnings.find((warning) => warning.type === "zero_rate"), undefined);
});

test("uses manual service overrides before calculating annual invoice coverage", () => {
  const preview = buildAggregatedQuotePreview({
    annualUsage: [
      {
        annualHours: 10,
        serviceId: "service-fs",
        usageId: "annual-fs-2025",
        usedHours: 2,
        year: 2025
      }
    ],
    billingClient,
    entries: [
      {
        date: "2026-06-05",
        description: "Review package",
        hours: 1.5,
        id: "entry-manual-service",
        isBillable: true,
        taskId: "task-custom-2025",
        taskName: "Custom review 2025",
        userName: "Ada",
        userRate: 200
      }
    ],
    periodEnd: "2026-06-30",
    periodStart: "2026-06-01",
    serviceOverrides: [{ entryId: "entry-manual-service", serviceId: "service-fs" }],
    services
  });

  assert.equal(preview.lines.length, 1);
  assert.equal(preview.lines[0].serviceKey, "financial_statements");
  assert.equal(preview.lines[0].annualCovered, true);
  assert.equal(preview.lines[0].amount, 0);
  assert.equal(preview.totals.annualCoveredHours, 1.5);
});

test("manual service overrides can use a positive annual allowance from another year when the document year is blank", () => {
  const preview = buildAggregatedQuotePreview({
    annualUsage: [
      {
        annualHours: 0.1,
        serviceId: "service-vat",
        usageId: "annual-vat-2025",
        usedHours: 0,
        year: 2025
      },
      {
        annualHours: "",
        serviceId: "service-vat",
        usageId: "annual-vat-2026",
        usedHours: 0,
        year: 2026
      }
    ],
    billingClient,
    entries: [
      {
        date: "2026-06-05",
        description: "VAT work",
        hours: 0.25,
        id: "entry-vat-manual",
        isBillable: true,
        taskId: "task-repo",
        taskName: "99040200: REPO Agreement",
        userName: "Ada",
        userRate: 300
      }
    ],
    periodEnd: "2026-06-30",
    periodStart: "2026-06-01",
    serviceOverrides: [{ entryId: "entry-vat-manual", serviceId: "service-vat" }],
    services
  });

  const prepaidLine = preview.lines.find((line) => line.annualCovered);
  const overflowLine = preview.lines.find((line) => !line.annualCovered && line.serviceKey === "value_added_tax");

  assert.equal(preview.lines.length, 2);
  assert.equal(prepaidLine.quantityHours, 0.1);
  assert.equal(prepaidLine.amount, 0);
  assert.equal(prepaidLine.annualCoverage[0].year, 2025);
  assert.equal(overflowLine.quantityHours, 0.15);
  assert.equal(overflowLine.amount, 40.5);
  assert.equal(overflowLine.annualBilling[0].year, 2025);
  assert.equal(overflowLine.entries[0].comment, "0.1h booked to the pre-paid part");
});

test("lets manual service overrides clear an automatically matched annual service", () => {
  const preview = buildAggregatedQuotePreview({
    annualUsage: [
      {
        annualHours: 6,
        serviceId: "service-agm",
        usageId: "annual-agm-2025",
        usedHours: 0,
        year: 2025
      }
    ],
    billingClient,
    entries: [
      {
        date: "2026-06-05",
        description: "AGM review",
        hours: 1,
        id: "entry-clear-service",
        isBillable: true,
        taskId: "task-agm-clear",
        taskName: "AGM 2025",
        userName: "Ada",
        userRate: 100
      }
    ],
    periodEnd: "2026-06-30",
    periodStart: "2026-06-01",
    serviceOverrides: [{ entryId: "entry-clear-service", serviceId: null }],
    services
  });

  assert.equal(preview.lines.length, 1);
  assert.equal(preview.lines[0].serviceId, null);
  assert.equal(preview.lines[0].annualCovered, false);
  assert.equal(preview.lines[0].amount, 90);
  assert.equal(preview.totals.annualCoveredHours, 0);
});

test("uses an explicit task year for annual invoice coverage before the logged date year", () => {
  const preview = buildAggregatedQuotePreview({
    annualUsage: [
      {
        annualHours: 6,
        serviceId: "service-agm",
        usageId: "annual-agm-2025",
        usedHours: 2.7,
        year: 2025
      },
      {
        annualHours: "",
        serviceId: "service-agm",
        usageId: "annual-agm-2026",
        usedHours: 0,
        year: 2026
      }
    ],
    billingClient,
    entries: [
      {
        date: "2026-06-05",
        description: "Edit AGM resolution",
        hours: 1.03,
        id: "entry-agm-1",
        isBillable: true,
        taskId: "task-agm-2025",
        taskName: "AGM 2025",
        userName: "Ada",
        userRate: 100
      },
      {
        date: "2026-06-06",
        description: "Final review",
        hours: 0.33,
        id: "entry-agm-2",
        isBillable: true,
        taskId: "task-agm-2025",
        taskName: "AGM 2025",
        userName: "Ben",
        userRate: 300
      }
    ],
    periodEnd: "2026-06-30",
    periodStart: "2026-06-01",
    services
  });

  assert.equal(preview.lines.length, 1);
  assert.equal(preview.lines[0].annualCovered, true);
  assert.equal(preview.lines[0].amount, 0);
  assert.match(preview.lines[0].comments, /Covered by annual invoice \(2025\)/);
  assert.equal(preview.totals.amount, 0);
  assert.equal(preview.totals.annualCoveredHours, 1.36);
  assert.equal(preview.totals.includedHours, 0);
});

test("splits the next annual-service entry when only part of it fits the prepaid balance", () => {
  const preview = buildAggregatedQuotePreview({
    annualUsage: [
      {
        annualHours: 6,
        serviceId: "service-agm",
        usageId: "annual-agm-2025",
        usedHours: 5,
        year: 2025
      }
    ],
    billingClient,
    entries: [
      {
        date: "2026-06-05",
        description: "AGM preparation",
        hours: 0.98,
        id: "entry-covered",
        isBillable: true,
        taskId: "task-agm-2025",
        taskName: "AGM 2025",
        userName: "Ada",
        userRate: 100
      },
      {
        date: "2026-06-06",
        description: "Follow up with Frances",
        hours: 0.2,
        id: "entry-split",
        isBillable: true,
        taskId: "task-agm-2025",
        taskName: "AGM 2025",
        userName: "Helmuts Kleins",
        userRate: 300
      }
    ],
    periodEnd: "2026-06-30",
    periodStart: "2026-06-01",
    services
  });

  const annualLine = preview.lines.find((line) => line.annualCovered);
  const invoicedLine = preview.lines.find((line) => !line.annualCovered && line.serviceKey === "agm_publication");

  assert.equal(preview.lines.length, 2);
  assert.equal(annualLine.quantityHours, 1);
  assert.equal(annualLine.amount, 0);
  assert.equal(annualLine.annualCoverage[0].coveredHours, 1);
  assert.equal(annualLine.annualCoverage[0].remainingAfter, 0);
  assert.deepEqual(annualLine.sourceTimeEntryIds, ["entry-covered", "entry-split"]);

  assert.equal(invoicedLine.quantityHours, 0.18);
  assert.equal(invoicedLine.amount, 48.6);
  assert.equal(invoicedLine.entries[0].hours, 0.18);
  assert.match(invoicedLine.entries[0].comment, /0.02h booked to the pre-paid part/);
  assert.equal(invoicedLine.annualBilling[0].billedHours, 0.18);
  assert.equal(invoicedLine.annualBilling[0].prepaidAppliedHours, 0.02);
  assert.equal(invoicedLine.annualBilling[0].annualHours, 6);

  assert.equal(preview.totals.amount, 48.6);
  assert.equal(preview.totals.annualCoveredHours, 1);
  assert.equal(preview.totals.includedHours, 0.18);
});

test("does not annual-cover services when annual hours are blank", () => {
  const preview = buildAggregatedQuotePreview({
    annualUsage: [
      {
        annualHours: "",
        serviceId: "service-fs",
        usageId: "annual-usage-blank",
        usedHours: 0,
        year: 2026
      }
    ],
    billingClient,
    entries: [
      {
        date: "2026-06-05",
        description: "Annual accounts",
        hours: 1,
        id: "entry-blank-annual",
        isBillable: true,
        taskName: "Prepare annual accounts",
        userName: "Ada",
        userRate: 200
      }
    ],
    periodEnd: "2026-06-30",
    periodStart: "2026-06-01",
    services
  });

  assert.equal(preview.lines.length, 1);
  assert.equal(preview.lines[0].annualCovered, false);
  assert.equal(preview.lines[0].amount, 180);
  assert.equal(preview.totals.annualCoveredHours, 0);
  assert.equal(preview.totals.includedHours, 1);
});

test("does not annual-cover short service acronyms when they look like task codes", () => {
  const preview = buildAggregatedQuotePreview({
    annualUsage: [
      {
        annualHours: 30,
        serviceId: "service-fs",
        usageId: "annual-usage-1",
        usedHours: 0,
        year: 2026
      }
    ],
    billingClient,
    entries: [
      {
        date: "2026-06-05",
        description: "Payment support",
        hours: 1,
        id: "entry-1",
        isBillable: true,
        taskName: "Payment reference FS-12",
        userName: "Ada",
        userRate: 200
      }
    ],
    periodEnd: "2026-06-30",
    periodStart: "2026-06-01",
    services
  });

  assert.equal(preview.lines.length, 1);
  assert.equal(preview.lines[0].annualCovered, false);
  assert.equal(preview.lines[0].amount, 180);
  assert.equal(preview.totals.annualCoveredHours, 0);
});
