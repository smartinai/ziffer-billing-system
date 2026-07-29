import assert from "node:assert/strict";
import { test } from "node:test";
import { auditActorName, auditSummary, normalizeAuditSummary, sanitizeAuditMetadata } from "./auditRepository.js";

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

test("prefers a user's display name over their login email", () => {
  assert.equal(
    auditActorName({
      displayName: "Smartin Studios",
      email: "smartinstudios@protonmail.com",
      sub: "smartinstudios@protonmail.com"
    }),
    "Smartin Studios"
  );
  assert.equal(
    auditActorName({
      name: "Smartin Studios",
      sub: "smartinstudios@protonmail.com"
    }),
    "Smartin Studios"
  );
});

test("replaces historical login emails in audit summaries", () => {
  assert.equal(
    normalizeAuditSummary(
      "smartinstudios@protonmail.com logged in",
      "Smartin Studios",
      ["Smartin Studios", "smartinstudios@protonmail.com"]
    ),
    "Smartin Studios logged in"
  );
});
