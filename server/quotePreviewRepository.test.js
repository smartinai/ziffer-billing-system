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
