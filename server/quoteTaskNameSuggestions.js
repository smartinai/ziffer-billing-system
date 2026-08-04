import { config } from "./config.js";
import { loadQuoteTaskNameSuggestionContext } from "./quotePreviewRepository.js";
import {
  generateTaskNameSuggestions,
  TASK_NAME_PROMPT_VERSION,
  taskNameAiConfigured
} from "./taskNameSuggestionService.js";

export function taskNameSuggestionCapability() {
  return {
    enabled: taskNameAiConfigured(),
    model: taskNameAiConfigured() ? config.openAiTaskNameModel : ""
  };
}

export async function suggestQuoteTaskNames(id, input = {}, actor = {}) {
  const context = await loadQuoteTaskNameSuggestionContext(id, input, actor);
  const generated = await generateTaskNameSuggestions(context.lines, { actorId: actor?.id || actor?.userId || "" });

  // The model call happens outside a transaction. Recheck the lock and version so
  // suggestions from a stale editor state can never be presented as current.
  await loadQuoteTaskNameSuggestionContext(id, input, actor);

  const sourceById = new Map(context.lines.map((line) => [line.lineId, line]));
  return {
    enabled: true,
    model: config.openAiTaskNameModel,
    promptVersion: TASK_NAME_PROMPT_VERSION,
    version: context.version,
    suggestions: generated.map((suggestion) => ({
      ...suggestion,
      currentTaskName: sourceById.get(suggestion.lineId)?.taskName || "",
      originalTaskName: sourceById.get(suggestion.lineId)?.originalTaskName || "",
      entryCount: sourceById.get(suggestion.lineId)?.entryCount || 0
    }))
  };
}
