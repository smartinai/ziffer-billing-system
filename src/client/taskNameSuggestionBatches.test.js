import assert from "node:assert/strict";
import test from "node:test";
import {
  matchesTaskNameReview,
  mergeTaskNameSuggestions,
  remainingTaskNameLineIds,
  TASK_NAME_SUGGESTION_BATCH_SIZE,
  taskNameSuggestionBatches
} from "./taskNameSuggestionBatches.js";

test("task-name review resumes only for the same ordered task set", () => {
  assert.equal(matchesTaskNameReview(["line-1", "line-2"], ["line-1", "line-2"]), true);
  assert.equal(matchesTaskNameReview(["line-1", "line-1", "line-2"], ["line-1", "line-2"]), true);
  assert.equal(matchesTaskNameReview(["line-1", "line-2"], ["line-2", "line-1"]), false);
  assert.equal(matchesTaskNameReview(["line-1"], ["line-1", "line-2"]), false);
  assert.equal(matchesTaskNameReview([], []), false);
});

test("task-name suggestions are split into sequential batches of 15", () => {
  const lineIds = Array.from({ length: 32 }, (_, index) => `line-${index + 1}`);
  const batches = taskNameSuggestionBatches(lineIds);

  assert.equal(TASK_NAME_SUGGESTION_BATCH_SIZE, 15);
  assert.deepEqual(batches.map((batch) => batch.length), [15, 15, 2]);
  assert.equal(batches.flat()[31], "line-32");
});

test("completed suggestions are preserved and retry targets only remaining lines", () => {
  const firstBatch = [{ lineId: "line-1", suggestedTaskName: "First" }];
  const merged = mergeTaskNameSuggestions(firstBatch, [
    { lineId: "line-1", suggestedTaskName: "Updated first" },
    { lineId: "line-2", suggestedTaskName: "Second" }
  ]);

  assert.deepEqual(merged.map((item) => item.suggestedTaskName), ["Updated first", "Second"]);
  assert.deepEqual(remainingTaskNameLineIds(["line-1", "line-2", "line-3"], merged), ["line-3"]);
});
