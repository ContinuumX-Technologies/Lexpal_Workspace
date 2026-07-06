import test from "node:test";
import assert from "node:assert/strict";

import { createSequentialNodeMap, createLexpalToSequentialMap, indexDocument } from "../utils";
import { runEditingPipeline } from "../edit_pipeline";
import type { LLMService, MinimalNode, PMNode, DependencyGraph } from "../edit_pipeline";
import { parseIntentTurnResult } from "../refine_edit_intent";

const sampleDoc: PMNode = {
  type: "doc",
  attrs: {
    lexpalId: "11111111-1111-4111-8111-111111111111",
    precedingHeadingId: null,
  },
  content: [
    {
      type: "heading",
      attrs: {
        lexpalId: "22222222-2222-4222-8222-222222222222",
        precedingHeadingId: null,
        level: 1,
      },
      content: [{ type: "text", text: "Title" }],
    },
    {
      type: "paragraph",
      attrs: {
        lexpalId: "33333333-3333-4333-8333-333333333333",
        precedingHeadingId: "22222222-2222-4222-8222-222222222222",
        memo: "Scope clause",
      },
      content: [{ type: "text", text: "Clause text" }],
    },
  ],
};

const sampleIndexTree: MinimalNode = {
  id: "11111111-1111-4111-8111-111111111111",
  parentId: null,
  type: "doc",
  index: 0,
  children: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      parentId: "11111111-1111-4111-8111-111111111111",
      type: "heading",
      index: 0,
      heading_text: "Title",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      parentId: "11111111-1111-4111-8111-111111111111",
      type: "paragraph",
      index: 1,
      memo: "Scope clause",
    },
  ],
};

const sampleDependencyGraph: DependencyGraph = {
  "33333333-3333-4333-8333-333333333333": [],
};

test("sequential mappings are bijective and deterministic", () => {
  const seqMap = createSequentialNodeMap(sampleDoc);
  assert.equal(seqMap.n1, "11111111-1111-4111-8111-111111111111");
  assert.equal(seqMap.n2, "22222222-2222-4222-8222-222222222222");
  assert.equal(seqMap.n3, "33333333-3333-4333-8333-333333333333");

  const reverse = createLexpalToSequentialMap(seqMap);
  assert.equal(reverse["11111111-1111-4111-8111-111111111111"], "n1");
  assert.equal(reverse["22222222-2222-4222-8222-222222222222"], "n2");
  assert.equal(reverse["33333333-3333-4333-8333-333333333333"], "n3");
});

test("indexDocument throws on duplicate lexpalId", () => {
  const duplicateDoc: PMNode = {
    type: "doc",
    attrs: {
      lexpalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      precedingHeadingId: null,
    },
    content: [
      {
        type: "paragraph",
        attrs: {
          lexpalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          precedingHeadingId: null,
        },
      },
      {
        type: "paragraph",
        attrs: {
          lexpalId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          precedingHeadingId: null,
        },
      },
    ],
  };

  assert.throws(() => indexDocument(duplicateDoc), /Duplicate attrs\.lexpalId/);
});

test("parseIntentTurnResult parses fenced JSON refinement output", () => {
  const result = parseIntentTurnResult(
    "```json\n{\"type\":\"refined\",\"objective\":\"Update clause\",\"editingObjective\":\"Replace wording\",\"draftingRequirements\":[\"formal tone\"],\"constraints\":[\"preserve liability cap\"],\"intentConfidence\":\"high\"}\n```"
  );

  assert.equal(result.type, "refined");
  if (result.type === "refined") {
    assert.equal(result.objective, "Update clause");
    assert.equal(result.editingObjective, "Replace wording");
    assert.deepEqual(result.draftingRequirements, ["formal tone"]);
  }
});

test("runEditingPipeline groups generation and validates step completion", async () => {
  const seqMap = createSequentialNodeMap(sampleDoc);
  const docMap = indexDocument(sampleDoc);

  const planningLLM: LLMService = {
    async complete() {
      return { content: "" };
    },
    async completeWithToolResults(messages: any[]) {
      const hasToolResponse = messages.some((m) => m.role === "tool");
      if (!hasToolResponse) {
        return {
          content: "",
          toolCalls: [
            {
              id: "call_1",
              name: "fetchNodeContent",
              arguments: { sequentialLlmId: "n3" },
            },
          ],
        };
      }

      return {
        content: JSON.stringify([
          {
            stepId: "step_1",
            operation: {
              op: "replaceNode",
              nodeId: "33333333-3333-4333-8333-333333333333",
              content: "!paragraph: Updated clause",
            },
            generationGroup: "g1",
            requiresGeneration: true,
            draftingInstruction: "Rewrite clause with same legal effect.",
            contextForDrafting: {},
          },
        ]),
      };
    },
  };

  const draftingLLM: LLMService = {
    async complete() {
      return {
        content: JSON.stringify([
          {
            stepId: "step_1",
            generatedContent: "!paragraph: Updated clause",
          },
        ]),
      };
    },
    async completeWithToolResults() {
      return { content: "" };
    },
  };

  const plan = await runEditingPipeline(
    planningLLM,
    draftingLLM,
    {
      type: "refined",
      objective: "Edit clause",
      editingObjective: "Replace clause text",
      draftingRequirements: [],
      constraints: [],
      intentConfidence: "high",
    },
    sampleIndexTree,
    sampleDependencyGraph,
    seqMap,
    docMap
  );

  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].generatedContent, "!paragraph: Updated clause");
});
