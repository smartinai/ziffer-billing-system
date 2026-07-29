import assert from "node:assert/strict";
import { test } from "node:test";
import { nextClientInvoiceNumber } from "./invoiceNumbers.js";

test("starts each client and year invoice sequence at 01", () => {
  assert.equal(
    nextClientInvoiceNumber({ abbreviation: "tdi", invoiceNumbers: [], year: 2026 }),
    "TDI-202601"
  );
});

test("increments matching Xero invoice numbers with a minimum of two digits", () => {
  assert.equal(
    nextClientInvoiceNumber({
      abbreviation: "TDI",
      invoiceNumbers: ["TDI-2026-01", "TDI-2026-09", "TDI-2026-10"],
      year: 2026
    }),
    "TDI-2026-11"
  );
  assert.equal(
    nextClientInvoiceNumber({ abbreviation: "TDI", invoiceNumbers: ["TDI-2026-99"], year: 2026 }),
    "TDI-2026-100"
  );
});

test("preserves compact client numbering and normalizes legacy spacing", () => {
  assert.equal(
    nextClientInvoiceNumber({
      abbreviation: "STS",
      invoiceNumbers: ["STS-202604", "STS-202605"],
      year: 2026
    }),
    "STS-202606"
  );
  assert.equal(
    nextClientInvoiceNumber({
      abbreviation: "VNXFL",
      invoiceNumbers: ["VNXFL - 202601"],
      year: 2026
    }),
    "VNXFL-202602"
  );
});

test("normalizes a legacy one-digit separated sequence to at least two digits", () => {
  assert.equal(
    nextClientInvoiceNumber({ abbreviation: "RC", invoiceNumbers: ["RC-2026-1"], year: 2026 }),
    "RC-2026-02"
  );
});

test("ignores other clients, years, annual fees, quotes, and non-sequence suffixes", () => {
  assert.equal(
    nextClientInvoiceNumber({
      abbreviation: "TDI",
      invoiceNumbers: [
        "STS-2026-99",
        "TDI-2025-99",
        "TDI-AF-2026-99",
        "TDI-2026-ACC",
        "TDI-AF2026",
        "DRAFT-TDI-2026-99",
        "TDI-2026-02"
      ],
      year: 2026
    }),
    "TDI-2026-03"
  );
});

test("returns no suggestion without a usable abbreviation or year", () => {
  assert.equal(nextClientInvoiceNumber({ abbreviation: "", invoiceNumbers: [], year: 2026 }), "");
  assert.equal(nextClientInvoiceNumber({ abbreviation: "TDI", invoiceNumbers: [], year: "26" }), "");
});
