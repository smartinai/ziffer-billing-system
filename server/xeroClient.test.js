import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decryptToken,
  encryptToken,
  parseXeroDocumentResponse,
  parseXeroQuoteResponse,
  xeroValidationMessages
} from "./xeroClient.js";

test("encrypts and decrypts stored Xero tokens", () => {
  const token = "xero-access-token";
  const encrypted = encryptToken(token);

  assert.notEqual(encrypted, token);
  assert.match(encrypted, /^v1:/);
  assert.equal(decryptToken(encrypted), token);
});

test("extracts quote identifiers from a Xero quote response", () => {
  const parsed = parseXeroQuoteResponse({
    Quotes: [
      {
        QuoteID: "quote-id-1",
        QuoteNumber: "DRAFT-202607-001",
        Status: "DRAFT"
      }
    ]
  });

  assert.deepEqual(parsed, {
    quote: {
      QuoteID: "quote-id-1",
      QuoteNumber: "DRAFT-202607-001",
      Status: "DRAFT"
    },
    quoteId: "quote-id-1",
    quoteNumber: "DRAFT-202607-001",
    status: "DRAFT"
  });
});

test("extracts invoice identifiers from a Xero invoice response", () => {
  const parsed = parseXeroDocumentResponse(
    {
      Invoices: [
        {
          InvoiceID: "invoice-id-1",
          InvoiceNumber: "DRAFT-202607-001",
          Status: "DRAFT"
        }
      ]
    },
    "draft_invoice"
  );

  assert.deepEqual(parsed, {
    document: {
      InvoiceID: "invoice-id-1",
      InvoiceNumber: "DRAFT-202607-001",
      Status: "DRAFT"
    },
    documentId: "invoice-id-1",
    documentNumber: "DRAFT-202607-001",
    invoice: {
      InvoiceID: "invoice-id-1",
      InvoiceNumber: "DRAFT-202607-001",
      Status: "DRAFT"
    },
    invoiceId: "invoice-id-1",
    invoiceNumber: "DRAFT-202607-001",
    status: "DRAFT"
  });
});

test("extracts nested Xero validation messages", () => {
  const messages = xeroValidationMessages({
    Elements: [
      {
        ValidationErrors: [
          { Message: "Line amount cannot be zero." },
          { Message: "Account code is invalid." }
        ]
      }
    ],
    Message: "A validation exception occurred"
  });

  assert.deepEqual(messages, ["Line amount cannot be zero.", "Account code is invalid."]);
});
