import { Request, Response } from "express";
import { z } from "zod";

import { processIntentTurn } from "../draft_edit_pipeline/refine_edit_intent";
import {
  runEditingPipeline,
  PMNode,
  MinimalNode,
  SeqNodeMap,
  DependencyGraph,
} from "../draft_edit_pipeline/edit_pipeline";
import { indexDocument } from "../draft_edit_pipeline/utils";
import { openaiLLM } from "../draft_edit_pipeline/llmCallFuncs";

const clarificationPairSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
});

const baseRequestSchema = z.object({
  draftId: z.string().min(1),
  userMessage: z.string().min(1),
  clarificationHistory: z.array(clarificationPairSchema).optional().default([]),
  pmDocument: z.record(z.any()),
  minimalIndexTree: z.record(z.any()),
  dependencyGraph: z.record(z.array(z.string())),
  sequentialToLexpalMap: z.record(z.string()).optional(),
  lexpalToSequentialMap: z.record(z.string()).optional(),
  nodeMetadata: z.record(z.any()).optional(),
  // Backward compatibility
  seqNodeMap: z.record(z.string()).optional(),
  draftMetadata: z
    .object({
      title: z.string(),
      margins: z.object({
        top: z.number(),
        bottom: z.number(),
        left: z.number(),
        right: z.number(),
      }),
      typography: z.object({
        fontFamily: z.string(),
        fontSize: z.number(),
        lineHeight: z.number(),
      }),
    })
    .optional(),
});

const ensureBidirectionalMap = (
  sequentialToLexpalMap: Record<string, string>,
  lexpalToSequentialMap?: Record<string, string>
): boolean => {
  const entries = Object.entries(sequentialToLexpalMap);
  if (entries.length === 0) return false;

  const values = entries.map(([, v]) => v);
  if (new Set(values).size !== values.length) {
    return false;
  }

  if (!lexpalToSequentialMap) return true;

  for (const [seq, lexpal] of entries) {
    if (lexpalToSequentialMap[lexpal] !== seq) {
      return false;
    }
  }

  return true;
};

const buildIntentConversation = (
  userMessage: string,
  clarificationHistory: { question: string; answer: string }[]
) => {
  const conversation: { role: "user" | "llm"; content: string }[] = [
    { role: "user", content: userMessage },
  ];

  for (const pair of clarificationHistory) {
    conversation.push({ role: "llm", content: pair.question });
    conversation.push({ role: "user", content: pair.answer });
  }

  return conversation;
};

// --- Route handler ---
export const editingController = async (req: Request, res: Response) => {
  const parsed = baseRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid edit request payload",
      details: parsed.error.issues,
    });
  }

  const {
    draftId,
    userMessage,
    clarificationHistory,
    pmDocument,
    minimalIndexTree,
    dependencyGraph,
    sequentialToLexpalMap,
    lexpalToSequentialMap,
    seqNodeMap,
  } = parsed.data;

  const resolvedSeqNodeMap =
    sequentialToLexpalMap ??
    seqNodeMap ??
    ({} as SeqNodeMap);

  if (!ensureBidirectionalMap(resolvedSeqNodeMap, lexpalToSequentialMap)) {
    return res.status(400).json({
      error: "Invalid sequential mapping artifacts",
    });
  }

  let docNodeMap: Record<string, PMNode>;
  try {
    docNodeMap = indexDocument(pmDocument as PMNode);
  } catch (error: any) {
    return res.status(400).json({
      error: "Invalid pmDocument for node indexing",
      details: error?.message ?? String(error),
    });
  }

  const conversation = buildIntentConversation(userMessage, clarificationHistory);

  let turnResult;
  try {
    turnResult = await processIntentTurn(conversation);
  } catch (error: any) {
    return res.status(500).json({
      error: "Intent refinement failed",
      details: error?.message ?? String(error),
    });
  }

  if (turnResult.type === "clarification") {
    return res.json({
      status: "questions",
      questions: turnResult.questions,
      message: "Please answer the clarification questions to continue.",
    });
  }

  try {
    const planningLLM = openaiLLM("o3");
    const draftingLLM = openaiLLM("gpt-5.1");

    const editPlan = await runEditingPipeline(
      planningLLM,
      draftingLLM,
      turnResult,
      minimalIndexTree as MinimalNode,
      dependencyGraph as DependencyGraph,
      resolvedSeqNodeMap,
      docNodeMap
    );

    return res.json({
      status: "completed",
      editPlan,
      message: `Edit plan generated for draft ${draftId}.`,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: "Pipeline execution failed",
      details: error?.message ?? String(error),
    });
  }
};

