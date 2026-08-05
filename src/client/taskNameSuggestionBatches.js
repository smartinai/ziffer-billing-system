export const TASK_NAME_SUGGESTION_BATCH_SIZE = 15;

export function uniqueTaskNameLineIds(lineIds = []) {
  return [...new Set(lineIds.filter(Boolean))];
}

export function matchesTaskNameReview(currentLineIds = [], nextLineIds = []) {
  const current = uniqueTaskNameLineIds(currentLineIds);
  const next = uniqueTaskNameLineIds(nextLineIds);
  return current.length > 0
    && current.length === next.length
    && current.every((lineId, index) => lineId === next[index]);
}

export function taskNameSuggestionBatches(lineIds = [], size = TASK_NAME_SUGGESTION_BATCH_SIZE) {
  const uniqueLineIds = uniqueTaskNameLineIds(lineIds);
  const batchSize = Math.max(1, Number(size) || TASK_NAME_SUGGESTION_BATCH_SIZE);
  const batches = [];
  for (let offset = 0; offset < uniqueLineIds.length; offset += batchSize) {
    batches.push(uniqueLineIds.slice(offset, offset + batchSize));
  }
  return batches;
}

export function mergeTaskNameSuggestions(current = [], incoming = []) {
  const replacements = new Map(incoming.map((item) => [item.lineId, item]));
  const merged = current.map((item) => replacements.get(item.lineId) || item);
  const existingIds = new Set(current.map((item) => item.lineId));
  return [...merged, ...incoming.filter((item) => !existingIds.has(item.lineId))];
}

export function remainingTaskNameLineIds(lineIds = [], suggestions = []) {
  const completedIds = new Set(suggestions.map((item) => item.lineId));
  return uniqueTaskNameLineIds(lineIds).filter((lineId) => !completedIds.has(lineId));
}
