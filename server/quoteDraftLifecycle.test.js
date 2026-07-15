import assert from "node:assert/strict";
import test from "node:test";
import { quoteDraftTestHooks } from "./quotePreviewRepository.js";

const editorSessionId = "11111111-1111-4111-8111-111111111111";
const otherEditorSessionId = "22222222-2222-4222-8222-222222222222";
const editorUserId = "33333333-3333-4333-8333-333333333333";
const otherEditorUserId = "44444444-4444-4444-8444-444444444444";

function activeDraft(overrides = {}) {
  return {
    archivedAt: null,
    editingBy: editorUserId,
    editingByName: "Marius",
    editingExpiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    editingSessionId: editorSessionId,
    version: 7,
    ...overrides
  };
}

test("the current editor session may mutate the expected draft version", () => {
  const result = quoteDraftTestHooks.assertDraftMutation(
    activeDraft(),
    { editorSessionId, version: 7 },
    { userId: editorUserId }
  );

  assert.deepEqual(result, { editorSessionId, expectedVersion: 7, userId: editorUserId });
});

test("a stale draft version is rejected before it can overwrite newer data", () => {
  assert.throws(
    () => quoteDraftTestHooks.assertDraftMutation(
      activeDraft(),
      { editorSessionId, version: 6 },
      { userId: editorUserId }
    ),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "DRAFT_VERSION_CONFLICT");
      assert.equal(error.details.currentVersion, 7);
      return true;
    }
  );
});

test("another editor receives the lock owner and expiry", () => {
  const draft = activeDraft();
  assert.throws(
    () => quoteDraftTestHooks.assertDraftMutation(
      draft,
      { editorSessionId: otherEditorSessionId, version: 7 },
      { userId: otherEditorUserId }
    ),
    (error) => {
      assert.equal(error.statusCode, 423);
      assert.equal(error.code, "DRAFT_LOCKED");
      assert.equal(error.details.editorName, "Marius");
      assert.equal(error.details.expiresAt, draft.editingExpiresAt);
      return true;
    }
  );
});

test("expired locks do not authorize further edits", () => {
  const draft = activeDraft({ editingExpiresAt: new Date(Date.now() - 1_000).toISOString() });
  assert.equal(quoteDraftTestHooks.activeLock(draft), false);
  assert.throws(
    () => quoteDraftTestHooks.assertDraftMutation(
      draft,
      { editorSessionId, version: 7 },
      { userId: editorUserId }
    ),
    (error) => error.statusCode === 423 && error.code === "DRAFT_LOCKED"
  );
});

test("source snapshots preserve the generated entry and annual breakdown", () => {
  const source = {
    annualBilling: [{ annualYear: 2026, coveredHours: 1.5 }],
    annualCoverage: [{ serviceLabel: "Annual compliance", usedHours: 0.25 }],
    entries: [{ description: "Review", hours: 0.25, id: "time-entry-1" }],
    serviceKey: "annual-compliance",
    serviceLabel: "Annual compliance"
  };
  const snapshot = quoteDraftTestHooks.quoteLineSourceSnapshot(source);
  const saved = quoteDraftTestHooks.savedQuoteLine({ id: "line-1", sourceSnapshot: snapshot });

  assert.deepEqual(saved.annualBilling, source.annualBilling);
  assert.deepEqual(saved.annualCoverage, source.annualCoverage);
  assert.deepEqual(saved.entries, source.entries);
  assert.equal(saved.serviceKey, source.serviceKey);
  assert.equal(saved.serviceLabel, source.serviceLabel);
});

test("task-level billable updates normalize and de-duplicate source entry IDs", () => {
  assert.deepEqual(
    quoteDraftTestHooks.requestedTimeEntryIds({ entryIds: [" entry-1 ", "entry-2", "entry-1", ""] }),
    ["entry-1", "entry-2"]
  );
  assert.deepEqual(quoteDraftTestHooks.requestedTimeEntryIds({ entryId: "entry-3" }), ["entry-3"]);
});

test("draft advisory lock keys are scoped to the draft", () => {
  assert.equal(
    quoteDraftTestHooks.draftLockKey("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    "quote-draft:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
  );
});

test("duplicate document numbers return a stable conflict response", () => {
  const conflict = quoteDraftTestHooks.mapDocumentNumberConflict({
    code: "23505",
    constraint: "idx_quote_previews_document_number_unique"
  });

  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.code, "DRAFT_DOCUMENT_NUMBER_CONFLICT");
});

test("unrelated unique violations are not rewritten as document conflicts", () => {
  const error = { code: "23505", constraint: "xero_quotes_idempotency_key_key" };
  assert.equal(quoteDraftTestHooks.mapDocumentNumberConflict(error), error);
});
