import assert from "node:assert/strict";
import { test } from "node:test";
import { buildXeroDocumentPayload, buildXeroQuotePayload } from "./quotePreviewRepository.js";

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
