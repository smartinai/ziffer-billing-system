import assert from "node:assert/strict";
import { test } from "node:test";
import { auditSummary, sanitizeAuditMetadata } from "./auditRepository.js";

test("redacts secret-looking audit metadata fields", () => {
  const metadata = sanitizeAuditMetadata({
    action: "send",
    nested: {
      oauthCode: "abc",
      refresh_token: "refresh",
      safe: "visible"
    },
    password: "hidden",
    xeroClientSecret: "hidden"
  });

  assert.deepEqual(metadata, {
    action: "send",
    nested: {
      oauthCode: "[redacted]",
      refresh_token: "[redacted]",
      safe: "visible"
    },
    password: "[redacted]",
    xeroClientSecret: "[redacted]"
  });
});

test("builds readable audit summaries from metadata", () => {
  assert.equal(
    auditSummary({
      action: "send_to_xero",
      entityType: "xero_document",
      metadata: { documentNumber: "DRAFT-202607-001" }
    }),
    "DRAFT-202607-001"
  );

  assert.equal(
    auditSummary({
      action: "billing_client_update",
      entityType: "billing_client",
      metadata: { summary: "Updated billing client KPS" }
    }),
    "Updated billing client KPS"
  );
});
