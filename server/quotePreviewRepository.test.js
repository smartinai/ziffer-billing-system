import assert from "node:assert/strict";
import { test } from "node:test";
import { buildXeroDocumentPayload, buildXeroQuotePayload, quoteDraftTestHooks } from "./quotePreviewRepository.js";

test("allows task-level edits while protecting source time entries", () => {
  assert.doesNotThrow(() => quoteDraftTestHooks.assertEditableQuoteLinePatch({
    discount: 10,
    id: "line-1",
    itemCode: "4-102",
    quantityHours: 1.25,
    taskName: "Updated task",
    unitAmount: 300
  }));
  assert.throws(
    () => quoteDraftTestHooks.assertEditableQuoteLinePatch({ id: "line-1", entries: [{ id: "entry-1", hours: 2 }] }),
    (error) => error.code === "IMMUTABLE_SOURCE_ENTRIES" && error.statusCode === 400
  );
  assert.throws(
    () => quoteDraftTestHooks.assertEditableQuoteLinePatch({ id: "line-1", taskName: "  " }),
    (error) => error.code === "TASK_NAME_REQUIRED" && error.statusCode === 400
  );
  assert.doesNotThrow(() => quoteDraftTestHooks.assertEditableQuoteLinePatch({
    id: "line-1",
    taskName: "Professional review of corporate records.",
    taskNameOrigin: "ai",
    taskNamePromptVersion: "task-name-v1"
  }));
  assert.doesNotThrow(() => quoteDraftTestHooks.assertEditableQuoteLinePatch({
    id: "line-1",
    taskName: "Manually entered invoice wording.",
    taskNameOrigin: "manual"
  }));
  assert.throws(
    () => quoteDraftTestHooks.assertEditableQuoteLinePatch({ id: "line-1", taskName: "Changed", taskNameOrigin: "teamwork" }),
    (error) => error.code === "TASK_NAME_ORIGIN_INVALID" && error.statusCode === 400
  );
  assert.throws(
    () => quoteDraftTestHooks.assertEditableQuoteLinePatch({ id: "line-1", taskName: "Changed", taskNamePromptVersion: "task-name-v1" }),
    (error) => error.code === "TASK_NAME_PROMPT_INVALID" && error.statusCode === 400
  );
});

test("requires a year only when an annual service assignment is submitted", () => {
  const annualService = { annualInvoiceEligible: true, id: "service-filing" };
  const standardService = { annualInvoiceEligible: false, id: "service-advisory" };

  assert.equal(quoteDraftTestHooks.assertAnnualServiceYear(annualService, 2027), 2027);
  assert.equal(quoteDraftTestHooks.assertAnnualServiceYear(standardService, null), null);
  assert.throws(
    () => quoteDraftTestHooks.assertAnnualServiceYear(annualService, null),
    (error) => error.code === "ANNUAL_YEAR_REQUIRED"
      && error.statusCode === 400
      && error.message === "Select an annual invoice year."
  );
});

test("applies Maria's role to new drafts and preserves snapshot rates afterward", () => {
  const entries = [
    { id: "maria-entry", userId: "maria", userRate: 100 },
    { id: "other-entry", userId: "other", userRate: 225 }
  ];
  const directorEntries = quoteDraftTestHooks.applyMariaRoleRates(entries, { mariaRole: "director" }, "maria");
  const standardEntries = quoteDraftTestHooks.applyMariaRoleRates(entries, { mariaRole: "standard" }, "maria");

  assert.equal(directorEntries[0].userRate, 300);
  assert.equal(standardEntries[0].userRate, 750);
  assert.equal(directorEntries[1].userRate, 225);

  const restored = quoteDraftTestHooks.applySnapshottedEntryRates(
    [{ id: "maria-entry", userId: "maria", userRate: 750 }],
    [{ sourceSnapshot: { entries: [{ id: "maria-entry", userRate: 300 }] } }]
  );
  assert.equal(restored[0].userRate, 300);
});

test("draft rebuilds preserve task overrides when the same source task changes billability", () => {
  const existingLine = {
    accountCode: "799999",
    comments: "Keep this note",
    description: "Edited description",
    discount: 17,
    itemCode: "4-102",
    isBillable: true,
    originalTaskName: "Original Teamwork task",
    quantityHours: 3.5,
    serviceId: "service-vat",
    sourceSnapshot: {
      entries: [
        { hours: 1, id: "entry-1", isBillable: true, userRate: 300 },
        { hours: 1, id: "entry-2", isBillable: true, userRate: 300 }
      ],
      generatedValues: { discount: 0, quantityHours: 2, unitAmount: 300 }
    },
    sourceTimeEntryIds: ["entry-1", "entry-2"],
    sourceType: "teamwork",
    taskName: "Client-facing task name",
    taskNameOrigin: "manual",
    taxType: "OUTPUT2",
    unitAmount: 425
  };
  const rebuilt = quoteDraftTestHooks.applyExistingLineSettings({
    lines: [{
      accountCode: "70330001",
      amount: 0,
      annualCovered: false,
      comments: "Marked unbillable",
      description: "Original description",
      discount: 0,
      entries: existingLine.sourceSnapshot.entries.map((entry) => ({ ...entry, isBillable: false })),
      includeInXero: false,
      isBillable: false,
      quantityHours: 2,
      serviceId: "service-vat",
      sourceTimeEntryIds: ["entry-1", "entry-2"],
      sourceType: "teamwork",
      taskName: "Original Teamwork task",
      taxType: "OUTPUT",
      unitAmount: 0
    }],
    totals: { amount: 0 }
  }, [existingLine], [{ id: "service-vat", label: "VAT", serviceKey: "vat" }]);

  assert.equal(rebuilt.lines[0].taskName, "Client-facing task name");
  assert.equal(rebuilt.lines[0].description, "Edited description");
  assert.equal(rebuilt.lines[0].quantityHours, 3.5);
  assert.equal(rebuilt.lines[0].unitAmount, 425);
  assert.equal(rebuilt.lines[0].discount, 17);
  assert.equal(rebuilt.lines[0].comments, "Keep this note");
  assert.equal(rebuilt.lines[0].itemCode, "4-102");
  assert.equal(rebuilt.lines[0].accountCode, "799999");
  assert.equal(rebuilt.lines[0].taxType, "OUTPUT2");
  assert.deepEqual(rebuilt.lines[0].generatedValues, { discount: 0, quantityHours: 2, unitAmount: 300 });
  assert.equal(rebuilt.lines[0].amount, 0);
  assert.equal(rebuilt.totals.totalHours, 3.5);
  assert.equal(rebuilt.totals.notBilledHours, 3.5);
});

test("draft rebuilds use the weighted source-entry rate after an entry rate changes", () => {
  const rebuilt = quoteDraftTestHooks.applyExistingLineSettings({
    lines: [{
      annualCovered: false,
      discount: 0,
      entries: [
        { hours: 1, id: "entry-1", originalUserRate: 300, userRate: 300 },
        { hours: 4, id: "entry-2", originalUserRate: 300, userRate: 275 }
      ],
      generatedValues: { discount: 0, quantityHours: 5, unitAmount: 280 },
      includeInXero: true,
      isBillable: true,
      quantityHours: 5,
      sourceTimeEntryIds: ["entry-1", "entry-2"],
      sourceType: "teamwork",
      taskId: "task-1",
      taskName: "Original task",
      unitAmount: 280
    }],
    totals: {}
  }, [{
    discount: 10,
    quantityHours: 5,
    sourceSnapshot: {
      entries: [
        { hours: 1, id: "entry-1", originalUserRate: 300, userRate: 275 },
        { hours: 4, id: "entry-2", originalUserRate: 300, userRate: 275 }
      ],
      generatedValues: { discount: 0, quantityHours: 5, unitAmount: 300 },
      rateSource: "entries",
      taskId: "task-1"
    },
    sourceTimeEntryIds: ["entry-1", "entry-2"],
    sourceType: "teamwork",
    taskName: "Saved invoice wording",
    unitAmount: 275
  }], [], { rateChangedEntryIds: new Set(["entry-1"]) });

  assert.equal(rebuilt.lines[0].unitAmount, 280);
  assert.equal(rebuilt.lines[0].rateSource, "entries");
  assert.equal(rebuilt.lines[0].discount, 10);
  assert.equal(rebuilt.lines[0].taskName, "Saved invoice wording");
  assert.deepEqual(rebuilt.lines[0].generatedValues, { discount: 0, quantityHours: 5, unitAmount: 300 });
});

test("draft rebuilds keep the newly selected annual service and year", () => {
  const rebuilt = quoteDraftTestHooks.applyExistingLineSettings({
    lines: [{
      annualCovered: false,
      annualYear: 2027,
      discount: 0,
      includeInXero: true,
      isBillable: true,
      quantityHours: 1.0333,
      serviceId: "service-filing",
      serviceKey: "filing_correspondence",
      serviceLabel: "Filing / Correspondence",
      sourceTimeEntryIds: ["entry-1"],
      sourceType: "teamwork",
      taskName: "Invoice for June 2026",
      unitAmount: 296
    }],
    totals: {}
  }, [{
    discount: 12,
    quantityHours: 1.0333,
    serviceId: null,
    sourceSnapshot: { entries: [{ id: "entry-1" }] },
    sourceTimeEntryIds: ["entry-1"],
    sourceType: "teamwork",
    taskName: "Invoice for June 2026",
    unitAmount: 300
  }], [
    { id: "service-filing", label: "Filing / Correspondence", serviceKey: "filing_correspondence" }
  ]);

  assert.equal(rebuilt.lines[0].annualYear, 2027);
  assert.equal(rebuilt.lines[0].serviceId, "service-filing");
  assert.equal(rebuilt.lines[0].serviceKey, "filing_correspondence");
  assert.equal(rebuilt.lines[0].serviceLabel, "Filing / Correspondence");
  assert.equal(rebuilt.lines[0].discount, 12);
  assert.equal(rebuilt.lines[0].unitAmount, 300);
});

test("partial task splits recalculate hours without losing the other saved settings", () => {
  const existingLine = {
    comments: "Saved comment",
    discount: 10,
    quantityHours: 4,
    sourceSnapshot: { entries: [{ id: "entry-1" }, { id: "entry-2" }] },
    sourceTimeEntryIds: ["entry-1", "entry-2"],
    sourceType: "teamwork",
    taskName: "Saved task name",
    taxType: "OUTPUT2",
    unitAmount: 500
  };
  const preview = quoteDraftTestHooks.applyExistingLineSettings({
    lines: [
      { annualCovered: false, discount: 0, isBillable: false, quantityHours: 1, sourceTimeEntryIds: ["entry-1"], sourceType: "teamwork", taskName: "Original", unitAmount: 0 },
      { annualCovered: false, discount: 0, isBillable: true, quantityHours: 2, sourceTimeEntryIds: ["entry-2"], sourceType: "teamwork", taskName: "Original", unitAmount: 300 }
    ],
    totals: {}
  }, [existingLine]);

  assert.deepEqual(preview.lines.map((line) => line.quantityHours), [1, 2]);
  assert.deepEqual(preview.lines.map((line) => line.unitAmount), [500, 500]);
  assert.deepEqual(preview.lines.map((line) => line.discount), [10, 10]);
  assert.deepEqual(preview.lines.map((line) => line.taskName), ["Saved task name", "Saved task name"]);
});

test("stored draft snapshots are the only source entries used by a rebuild", () => {
  const entries = quoteDraftTestHooks.storedDraftSourceEntries([
    {
      lineOrder: 1,
      originalTaskName: "Stored task",
      sourceTimeEntryIds: ["entry-1"],
      sourceType: "teamwork",
      entries: [{ date: "2026-01-01", hours: 0.1, id: "entry-1", isBillable: true, userRate: 300 }]
    },
    {
      lineOrder: 2,
      originalTaskName: "Stored task",
      sourceTimeEntryIds: ["entry-1"],
      sourceType: "teamwork",
      entries: [{ date: "2026-01-01", hours: 0.15, id: "entry-1", isBillable: true, userRate: 300 }]
    },
    {
      lineOrder: 3,
      originalTaskName: "Another stored task",
      sourceTimeEntryIds: ["entry-2"],
      sourceType: "teamwork",
      entries: [{ date: "2026-01-02", hours: 1, id: "entry-2", isBillable: true, userRate: 200 }]
    },
    {
      lineOrder: 4,
      originalTaskName: "Stored task",
      sourceTimeEntryIds: ["entry-3"],
      sourceType: "teamwork",
      entries: [{ date: "2026-01-03", hours: 0.5, id: "entry-3", isBillable: false, userRate: 300 }]
    }
  ]);

  assert.deepEqual(entries.map((entry) => entry.id), ["entry-1", "entry-2", "entry-3"]);
  assert.equal(entries[0].hours, 0.25);
  assert.equal(entries[0].taskName, "Stored task");
  assert.equal(entries[0].taskId, entries[2].taskId);
  assert.equal(entries.some((entry) => entry.id === "new-teamwork-entry"), false);
});

test("manual rows survive rebuild preparation without changing their snapshot values", () => {
  const [manual] = quoteDraftTestHooks.storedManualDraftLines([{
    accountCode: "705000",
    annualCovered: false,
    comments: "Manual note",
    description: "Manual description",
    discount: 25,
    entries: [],
    itemCode: "4-102",
    lineOrder: 1,
    quantityHours: 2,
    sourceSnapshot: { generatedValues: { discount: 25, quantityHours: 2, unitAmount: 120 } },
    sourceTimeEntryIds: [],
    sourceType: "manual",
    taskName: "Manual row",
    taxType: "OUTPUT2",
    unitAmount: 120
  }]);

  assert.equal(manual.taskName, "Manual row");
  assert.equal(manual.quantityHours, 2);
  assert.equal(manual.unitAmount, 120);
  assert.equal(manual.discount, 25);
  assert.equal(manual.amount, 180);
  assert.equal(manual.comments, "Manual note");
});

test("validates Xero item codes before saving them on a draft line", async () => {
  const database = {
    async query(_sql, [code]) {
      return { rowCount: code === "4-102" ? 1 : 0 };
    }
  };

  assert.equal(await quoteDraftTestHooks.validatedItemCode(database, ""), "");
  assert.equal(await quoteDraftTestHooks.validatedItemCode(database, " 4-102 "), "4-102");
  await assert.rejects(
    quoteDraftTestHooks.validatedItemCode(database, "not-an-item"),
    (error) => error.code === "XERO_ITEM_CODE_INVALID" && error.statusCode === 400
  );
});

test("builds the Xero quote create payload with accounting fields", () => {
  const payload = buildXeroQuotePayload({
    billingClient: {
      accountCode: "70330001",
      currency: "EUR",
      displayName: "Client A",
      id: "client-a",
      taxType: "OUTPUT2",
      xeroClientName: "Client A S.A.",
      xeroContactId: "contact-a"
    },
    lines: [
      {
        accountCode: "705000",
        amount: 900,
        comments: "Reviewed by billing",
        discount: 10,
        id: "line-1",
        itemCode: "4-102",
        isBillable: true,
        quantityHours: 3,
        sourceTimeEntryIds: ["entry-1", "entry-2"],
        taskName: "Task A",
        taxType: "OUTPUT2",
        unitAmount: 333.333
      },
      {
        amount: 0,
        comments: "Marked unbillable",
        id: "line-2",
        isBillable: false,
        quantityHours: 1,
        sourceTimeEntryIds: ["entry-3"],
        taskName: "Task B",
        unitAmount: 300
      },
      {
        amount: 1334.55,
        comments: "",
        id: "line-4",
        isBillable: true,
        quantityHours: 4.7832,
        sourceTimeEntryIds: ["entry-5"],
        taskName: "Rounded line",
        unitAmount: 279.01
      },
      {
        accountCode: "",
        amount: 300,
        annualCovered: true,
        comments: "pre-paid",
        id: "line-3",
        isBillable: true,
        quantityHours: 1.5,
        sourceTimeEntryIds: ["entry-4"],
        taskName: "Annual accounts",
        unitAmount: 200
      }
    ],
    previewRow: {
      expiryDate: "2026-07-15",
      id: "preview-1",
      quoteDate: "2026-07-01",
      quoteNumber: "DRAFT-202607-001",
      reference: "June 2026"
    }
  });

  assert.equal(payload.method, "PUT");
  assert.equal(payload.endpoint, "/Quotes");
  assert.deepEqual(Object.keys(payload.body), ["Quotes"]);

  const quote = payload.body.Quotes[0];
  assert.equal(quote.Contact.ContactID, "contact-a");
  assert.equal(quote.Contact.Name, "Client A S.A.");
  assert.equal(quote.QuoteNumber, "DRAFT-202607-001");
  assert.equal(quote.Reference, "June 2026");
  assert.equal(quote.Date, "2026-07-01");
  assert.equal(quote.ExpiryDate, "2026-07-15");
  assert.equal(quote.Status, "DRAFT");
  assert.equal(quote.CurrencyCode, "EUR");
  assert.equal(quote.LineAmountTypes, "Exclusive");
  assert.equal(quote.LineItems.length, 2);

  assert.deepEqual(quote.LineItems[0], {
    AccountCode: "705000",
    Description: "Task A Reviewed by billing",
    DiscountRate: 10,
    ItemCode: "4-102",
    LineAmount: 900,
    Quantity: 3,
    TaxType: "OUTPUT2",
    UnitAmount: 333.3333
  });

  assert.deepEqual(quote.LineItems[1], {
    AccountCode: "70330001",
    Description: "Rounded line",
    DiscountRate: 0,
    LineAmount: 1334.55,
    Quantity: 4.7832,
    TaxType: "OUTPUT2",
    UnitAmount: 279.0078
  });

  assert.deepEqual(
    payload.source.sourceLines.map((line) => ({
      annualCovered: line.annualCovered,
      includeInXero: line.includeInXero,
      lineAmount: line.lineAmount,
      quoteLineId: line.quoteLineId,
      sourceTimeEntryIds: line.sourceTimeEntryIds
    })),
    [
      {
        annualCovered: false,
        includeInXero: true,
        lineAmount: 900,
        quoteLineId: "line-1",
        sourceTimeEntryIds: ["entry-1", "entry-2"]
      },
      {
        annualCovered: false,
        includeInXero: true,
        lineAmount: 1334.55,
        quoteLineId: "line-4",
        sourceTimeEntryIds: ["entry-5"]
      },
      {
        annualCovered: true,
        includeInXero: false,
        lineAmount: 0,
        quoteLineId: "line-3",
        sourceTimeEntryIds: ["entry-4"]
      }
    ]
  );
});

test("builds the Xero draft invoice payload by default", () => {
  const payload = buildXeroDocumentPayload({
    billingClient: {
      accountCode: "70330001",
      currency: "EUR",
      displayName: "Client A",
      id: "client-a",
      taxType: "OUTPUT2",
      xeroClientName: "Client A S.A.",
      xeroContactId: "contact-a"
    },
    lines: [
      {
        accountCode: "705000",
        amount: 900,
        comments: "Invoice comment",
        discount: 10,
        id: "line-1",
        isBillable: true,
        quantityHours: 3,
        sourceTimeEntryIds: ["entry-1", "entry-2"],
        taskName: "Task A",
        taxType: "OUTPUT2",
        unitAmount: 333.333
      },
      {
        amount: 0,
        comments: "Marked unbillable",
        id: "line-2",
        isBillable: false,
        quantityHours: 1,
        sourceTimeEntryIds: ["entry-3"],
        taskName: "Task B",
        unitAmount: 300
      },
      {
        accountCode: "",
        amount: 300,
        annualCovered: true,
        comments: "pre-paid",
        id: "line-3",
        isBillable: true,
        quantityHours: 1.5,
        sourceTimeEntryIds: ["entry-4"],
        taskName: "Annual accounts",
        unitAmount: 200
      }
    ],
    previewRow: {
      expiryDate: "2026-07-15",
      id: "preview-1",
      quoteDate: "2026-07-01",
      quoteNumber: "DRAFT-202607-001",
      reference: "June 2026"
    }
  });

  assert.equal(payload.documentType, "draft_invoice");
  assert.equal(payload.method, "PUT");
  assert.equal(payload.endpoint, "/Invoices");
  assert.deepEqual(Object.keys(payload.body), ["Invoices"]);

  const invoice = payload.body.Invoices[0];
  assert.equal(invoice.Type, "ACCREC");
  assert.equal(invoice.Status, "DRAFT");
  assert.equal(invoice.InvoiceNumber, "DRAFT-202607-001");
  assert.equal(invoice.Reference, "June 2026");
  assert.equal(invoice.Date, "2026-07-01");
  assert.equal(invoice.DueDate, "2026-07-15");
  assert.equal(invoice.Contact.ContactID, "contact-a");
  assert.equal(invoice.Contact.Name, "Client A S.A.");
  assert.equal(invoice.LineAmountTypes, "Exclusive");
  assert.equal(invoice.LineItems.length, 1);
  assert.equal(invoice.LineItems[0].LineAmount, 900);
  assert.equal(invoice.LineItems[0].UnitAmount, 333.3333);
  assert.equal(payload.source.documentType, "draft_invoice");
});

test("AI-assisted task names become the authoritative Xero line wording", () => {
  const payload = buildXeroDocumentPayload({
    billingClient: {
      accountCode: "70330001",
      currency: "EUR",
      displayName: "Client A",
      taxType: "OUTPUT2",
      xeroContactId: "contact-a"
    },
    lines: [{
      accountCode: "70330001",
      amount: 300,
      description: "Legacy generated description",
      discount: 0,
      id: "line-1",
      includeInXero: true,
      isBillable: true,
      originalTaskName: "Internal Teamwork task",
      quantityHours: 1,
      taskName: "Client-facing professional services.",
      taskNameOrigin: "ai",
      taxType: "OUTPUT2",
      unitAmount: 300
    }],
    previewRow: {
      expiryDate: "2026-08-15",
      id: "preview-1",
      quoteDate: "2026-08-01",
      quoteNumber: "CLI-2026-01",
      reference: "July 2026"
    }
  });

  assert.equal(payload.body.Invoices[0].LineItems[0].Description, "Client-facing professional services.");
});
