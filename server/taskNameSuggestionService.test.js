import assert from "node:assert/strict";
import test from "node:test";
import {
  generateTaskNameSuggestions,
  MAX_TASK_NAME_SUGGESTIONS,
  prepareTaskNameSuggestionInput,
  taskNameSuggestionTestHooks
} from "./taskNameSuggestionService.js";

test("task-name AI requests are capped at the client batch size", () => {
  assert.equal(MAX_TASK_NAME_SUGGESTIONS, 15);
  assert.throws(
    () => prepareTaskNameSuggestionInput(Array.from({ length: 16 }, (_, index) => ({
      lineId: `line-${index + 1}`,
      originalTaskName: `Task ${index + 1}`
    }))),
    (error) => error.code === "AI_TASK_NAMES_LIMIT" && error.statusCode === 400
  );
});

test("task-name AI input includes only task names and deduplicated descriptions", () => {
  const result = prepareTaskNameSuggestionInput([{
    lineId: "line-1",
    originalTaskName: "Risk Questionnaire & Investment Profile_HYPO",
    descriptions: ["Review questionnaire", " Review questionnaire ", "", "No description", "Prepare investment profile"]
  }]);

  assert.deepEqual(result, [{
    lineId: "line-1",
    originalTaskName: "Risk Questionnaire & Investment Profile_HYPO",
    descriptions: ["Review questionnaire", "Prepare investment profile"]
  }]);
  assert.equal(JSON.stringify(result).includes("userName"), false);
  assert.equal(JSON.stringify(result).includes("rate"), false);
  assert.equal(JSON.stringify(result).includes("hours"), false);
});

test("structured suggestions preserve request order and safely fall back", () => {
  const input = prepareTaskNameSuggestionInput([
    { lineId: "line-1", originalTaskName: "Directors resolutions", descriptions: ["Prepare resolutions dated 12 June 2026"] },
    { lineId: "line-2", originalTaskName: "Internal follow-up", descriptions: [] }
  ]);
  const result = taskNameSuggestionTestHooks.normalizeSuggestions(input, {
    suggestions: [{
      lineId: "line-1",
      status: "suggested",
      suggestedTaskName: "Preparation of directors' resolutions dated 12 June 2026.",
      warning: ""
    }]
  });

  assert.equal(result[0].status, "suggested");
  assert.equal(result[0].suggestedTaskName, "Preparation of directors' resolutions dated 12 June 2026.");
  assert.equal(result[1].status, "unchanged");
  assert.equal(result[1].suggestedTaskName, "Internal follow-up");
});

test("output text is extracted from a Responses API message", () => {
  assert.equal(taskNameSuggestionTestHooks.outputText({
    output: [{ content: [{ type: "output_text", text: '{"suggestions":[]}' }] }]
  }), '{"suggestions":[]}');
});

test("OpenAI requests use structured output, disable storage, and omit financial fields", async () => {
  let request;
  const suggestions = await generateTaskNameSuggestions([{
    lineId: "line-1",
    originalTaskName: "Directors/shareholders provision resolutions",
    descriptions: ["Prepared corporate resolutions dated 12 June 2026"]
  }], {
    actorId: "user-1",
    apiKey: "test-key",
    enabled: true,
    model: "test-model",
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return {
            output: [{ content: [{
              type: "output_text",
              text: JSON.stringify({ suggestions: [{
                lineId: "line-1",
                status: "suggested",
                suggestedTaskName: "Preparation of corporate resolutions dated 12 June 2026.",
                warning: ""
              }] })
            }] }]
          };
        }
      };
    }
  });

  assert.equal(request.store, false);
  assert.equal(request.model, "test-model");
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.equal(JSON.stringify(request).includes("unitAmount"), false);
  assert.equal(JSON.stringify(request).includes("userRate"), false);
  assert.equal(suggestions[0].suggestedTaskName, "Preparation of corporate resolutions dated 12 June 2026.");
});
