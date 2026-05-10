import fs from "fs";
import path from "path";
import { Request, Response } from "express";
import openai from "../infra/openai.client";
import { TemplateSchema, Template, Block } from "../types/draftspace.types";

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "src",
  "temp_data",
  "parsed_drafts.json"
);

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

interface DraftspaceRequest {
  message: string;
  history?: ChatHistoryItem[];
  blockTree?: unknown;
  activeBlockId?: string | null;
  templateChoice?: string | null;
}

interface EditorBlock {
  id: string;
  type: "heading" | "paragraph" | "clause" | "placeholder" | "list" | "signature" | "divider";
  content: string;
  level?: number;
  placeholder?: string;
  children?: EditorBlock[];
  meta?: Record<string, unknown>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseLLMJSON(raw: string): unknown {
  try {
    let cleaned = raw.trim().replace(/```json/g, "").replace(/```/g, "");
    const firstBrace   = cleaned.indexOf("{");
    const firstBracket = cleaned.indexOf("[");
    const first =
      firstBrace === -1  ? firstBracket :
      firstBracket === -1 ? firstBrace :
      Math.min(firstBrace, firstBracket);
    const last =
      cleaned.lastIndexOf("}") > cleaned.lastIndexOf("]")
        ? cleaned.lastIndexOf("}")
        : cleaned.lastIndexOf("]");
    if (first !== -1 && last !== -1) cleaned = cleaned.slice(first, last + 1);
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("❌ JSON parse error\nRAW:\n", raw);
    throw err;
  }
}

function loadTemplates(): Template[] {
  const raw = JSON.parse(fs.readFileSync(TEMPLATE_PATH, "utf-8"));
  return raw.map((t: unknown) => TemplateSchema.parse(t));
}

function extractTextFromBlockTree(blockTree: unknown): string {
  if (!blockTree || typeof blockTree !== "object") return "";
  const lines: string[] = [];

  function walk(node: any) {
    if (node.title) lines.push(node.title);
    if (Array.isArray(node.content)) {
      lines.push(node.content.map((s: any) => s.text ?? "").join(""));
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  }

  walk(blockTree);
  return lines.filter(Boolean).join("\n");
}

// ─── Controller ───────────────────────────────────────────────────────────────

export const draftspaceAIController = async (
  req: Request<{}, {}, DraftspaceRequest>,
  res: Response
) => {
  try {
    const { message, history = [], templateChoice, blockTree } = req.body;

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    const templates   = loadTemplates();
    const draftNames  = templates.map(t => t.draft_name);
    const historyMsgs = history.map(h => ({ role: h.role, content: h.content }));

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 2 — User picked a template → generate document in EditorBlock format
    // ──────────────────────────────────────────────────────────────────────────
    if (templateChoice) {
      const chosenDraft = templates.find(t => t.draft_name === templateChoice);

      if (!chosenDraft) {
        return res.status(404).json({ error: `Template "${templateChoice}" not found.` });
      }

      const generationResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `
You are a legal drafting assistant that outputs structured document blocks for a block-based editor.

You receive a template name, its stored block structure, and the user's drafting request.

Your job:
- Use the template as a structural and legal guide
- Adapt the content to the user's specific context and request
- Output the full document as an array of EditorBlocks in the format below
- For any unknown values (names, dates, amounts) use type "placeholder" and wrap the content in {{double_braces}}

EDITOR BLOCK FORMAT:
[
  {
    "id": "block_1",           // sequential unique ID
    "type": "heading | paragraph | clause | placeholder | list | signature | divider",
    "content": "text here",
    "level": 1,                // heading only — 1=H1, 2=H2, 3=H3
    "placeholder": "key_name", // placeholder only — snake_case descriptor
    "children": [],            // list only — each child is an EditorBlock
    "meta": {}                 // optional extra metadata
  }
]

Type rules:
- heading     → document title (level 1) or section title (level 2/3)
- paragraph   → recitals, preamble, boilerplate prose
- clause      → numbered/named legal clause with enforceable content
- placeholder → unknown field the user must fill in; wrap content in {{braces}}
- list        → bulleted or numbered items; put each item as a child block
- signature   → signature line; content = party label e.g. "Authorized Signatory"
- divider     → horizontal separator; content = ""

Return ONLY the JSON array. No markdown, no explanation, no preamble.
`.trim()
          },
          ...historyMsgs,
          {
            role: "user",
            content: `
Template Name: ${chosenDraft.draft_name}

Template Blocks (structural reference):
${JSON.stringify(chosenDraft.blocks, null, 2)}

User Request:
${message}

Generate the complete drafted document as an EditorBlock[].
`.trim()
          }
        ]
      });

      const editorBlocks = parseLLMJSON(
        generationResponse.choices[0].message.content ?? "[]"
      ) as EditorBlock[];
      console.log(editorBlocks);
      return res.json({
        intent: "create_document",
        template_name: chosenDraft.draft_name,
        blocks: editorBlocks
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // PHASE 0 — No templateChoice → classify intent: question vs template request
    // ──────────────────────────────────────────────────────────────────────────
    const intentResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `You are a classifier. Determine if the user message is:
1. A QUESTION about the current document, a general legal question, or conversational (intent: "question")
2. A REQUEST to create/draft a new legal document or pick a template (intent: "template")

Return ONLY valid JSON: { "intent": "question" | "template" }`.trim()
        },
        { role: "user", content: message }
      ]
    });

    const intentParsed = parseLLMJSON(
      intentResponse.choices[0].message.content ?? "{}"
    ) as { intent?: string };

    // ── Route: document Q&A ──
    if (intentParsed.intent === "question") {
      const docText = extractTextFromBlockTree(blockTree);
      const systemPrompt = docText
        ? `You are a helpful legal document assistant. The user is working on the following document:\n\n---\n${docText}\n---\n\nAnswer the user's questions about this document clearly and concisely. If the question is not related to the document, still answer it as a knowledgeable legal assistant.`
        : `You are a helpful legal document assistant. Answer the user's question clearly and concisely. You can help with legal questions, document structure, clauses, and drafting best practices.`;

      const chatResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0.4,
        messages: [
          { role: "system", content: systemPrompt },
          ...historyMsgs,
          { role: "user", content: message }
        ]
      });

      return res.json({
        intent: "chat_response",
        text: chatResponse.choices[0].message.content ?? "I'm not sure how to answer that."
      });
    }

    // ── Route: template selection ──
    const selectionResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `
You are a legal drafting assistant.

Given the user's request and a list of available template names, return the TOP 3 most relevant template names.

Rules:
- Only use names that EXACTLY match strings from the provided list — no paraphrasing
- Rank by relevance to the user's request
- Return ONLY valid JSON: { "top3": ["name1", "name2", "name3"] }
- Return fewer than 3 only if fewer are genuinely relevant
`.trim()
        },
        ...historyMsgs,
        {
          role: "user",
          content: `User request:\n${message}\n\nAvailable templates:\n${JSON.stringify(draftNames, null, 2)}`
        }
      ]
    });

    const parsed = parseLLMJSON(
      selectionResponse.choices[0].message.content ?? "{}"
    ) as { top3?: string[] };

    // Guard: only keep names that actually exist in the list
    const top3 = (parsed.top3 ?? []).filter(name => draftNames.includes(name));

    if (!top3.length) {
      return res.json({
        intent: "clarify",
        text: "I couldn't find a matching template. Could you describe the document type more specifically?",
        draft_choices: []
      });
    }

    return res.json({
      intent: "clarify",
      text: "I found these templates — which fits your need?",
      draft_choices: top3
    });

  } catch (error) {
    console.error("❌ Draftspace AI Error:", error);
    return res.status(500).json({ error: "AI processing failed" });
  }
};