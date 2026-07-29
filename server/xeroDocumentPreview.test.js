import assert from "node:assert/strict";
import { test } from "node:test";
import { buildXeroDocumentPayload } from "./quotePreviewRepository.js";
import { buildXeroDocumentPreview } from "./xeroDocumentPreview.js";

function fixture(documentType = "draft_invoice") {
  const payload = buildXeroDocumentPayload({
    billingClient: {
      accountCode: "70330001",
      currency: "EUR",
      id: "client-1",
      taxType: "OUTPUT17",
      xeroClientName: "Ziffer Test S.A.",
      xeroContactId: "contact-1"
    },
    documentType,
    lines: [
      {
        accountCode: "70330001",
        amount: 45,
        comments: "0.10h covered by annual package",
        discount: 0,
        id: "invoiceable-split",
        itemCode: "2-503",
        isBillable: true,
        quantityHours: 0.15,
        taskName: "VAT review",
        taxType: "OUTPUT17",
        unitAmount: 300
      },
      {
        amount: 30,
        annualCovered: true,
        id: "prepaid",
        isBillable: true,
        quantityHours: 0.1,
        taskName: "VAT review prepaid",
        taxType: "OUTPUT17",
        unitAmount: 300
      },
      {
        amount: 100,
        id: "unbillable",
        isBillable: false,
        quantityHours: 1,
        taskName: "Unbillable",
        taxType: "OUTPUT17",
        unitAmount: 100
      }
    ],
    previewRow: {
      expiryDate: "2026-07-28",
      id: "preview-1",
      quoteDate: "2026-07-14",
      quoteNumber: "ZIF-202607",
      reference: "July 2026"
    }
  });
  return buildXeroDocumentPreview({
    accounts: [{ code: "70330001", name: "Sales of services" }],
    contact: {
      name: "Ziffer Test S.A.",
      raw: { Addresses: [{ AddressType: "STREET", AddressLine1: "4 Rue Test", PostalCode: "L-1466", City: "Luxembourg", Country: "Luxembourg" }] }
    },
    payload,
    taxRates: [{ name: "Tax on Sales 17%", rate: 17, taxType: "OUTPUT17" }]
  });
}

test("projects the exact invoice payload into a presentation-safe preview", () => {
  const preview = fixture();
  assert.equal(preview.documentType, "draft_invoice");
  assert.equal(preview.number, "ZIF-202607");
  assert.equal(preview.issueDate, "2026-07-14");
  assert.equal(preview.dueDate, "2026-07-28");
  assert.deepEqual(preview.contact.address, ["4 Rue Test", "L-1466 Luxembourg", "Luxembourg"]);
  assert.equal(preview.lines.length, 1);
  assert.deepEqual(preview.lines[0], {
    accountCode: "70330001",
    accountName: "Sales of services",
    description: "VAT review 0.10h covered by annual package",
    discount: 0,
    itemCode: "2-503",
    lineAmount: 45,
    quantity: 0.15,
    taxAmount: 7.65,
    taxName: "Tax on Sales 17%",
    taxRate: 17,
    taxType: "OUTPUT17",
    unitAmount: 300
  });
  assert.deepEqual(preview.totals, { subtotal: 45, total: 52.65, totalTax: 7.65 });
});

test("uses quote expiry semantics and tolerates missing cached contact details", () => {
  const preview = fixture("draft_quote");
  assert.equal(preview.documentType, "draft_quote");
  assert.equal(preview.dueDate, "2026-07-28");
  assert.equal(preview.contact.name, "Ziffer Test S.A.");
});
