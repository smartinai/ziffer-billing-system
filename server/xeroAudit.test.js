import assert from "node:assert/strict";
import { test } from "node:test";
import { xeroSendAuditMetadata } from "./xeroAudit.js";

test("builds Xero send audit metadata from the authoritative send result", () => {
  assert.deepEqual(
    xeroSendAuditMetadata({
      preview: { id: "preview-1", status: "sent" },
      xero: {
        amount: 17565.04,
        clientName: "TDINVEST S.A., SPF",
        documentLabel: "draft invoice",
        documentType: "draft_invoice",
        lineCount: 62,
        mode: "live",
        quoteNumber: "TDI-2026-QA-0803-01",
        status: "DRAFT"
      }
    }),
    {
      clientName: "TDINVEST S.A., SPF",
      documentNumber: "TDI-2026-QA-0803-01",
      documentType: "draft_invoice",
      lineCount: 62,
      mode: "live",
      status: "DRAFT",
      sentAmount: 17565.04,
      summary: "Sent draft invoice TDI-2026-QA-0803-01 to Xero for TDINVEST S.A., SPF (17565.04 EUR)"
    }
  );
});

test("keeps compatibility with older payloads", () => {
  const metadata = xeroSendAuditMetadata({
    preview: {
      amount: 75,
      billingClient: { displayName: "Legacy Client" },
      quoteNumber: "LEG-01"
    },
    xero: { documentLabel: "invoice" }
  });

  assert.equal(metadata.sentAmount, 75);
  assert.equal(metadata.summary, "Sent invoice LEG-01 to Xero for Legacy Client (75 EUR)");
});
