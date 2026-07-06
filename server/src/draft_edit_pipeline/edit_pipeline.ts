import { RefinedIntent } from "./refine_edit_intent";
import { pmNodeToMarkup } from "./utils";

export type NodeId = string;

export interface MinimalNode {
  id: NodeId;
  parentId: NodeId | null;
  type: string;
  index: number;
  memo?: string;
  heading_text?: string;
  children?: MinimalNode[];
}

export type DependencyGraph = Record<NodeId, NodeId[]>;
export type SeqNodeMap = Record<string, NodeId>;

export interface PMNode {
  type: string;
  attrs?: Record<string, any>;
  content?: PMNode[];
  text?: string;
  marks?: any[];
}

export type EditOperation =
  | { op: "replaceNode"; nodeId: NodeId; content?: string; attrs?: Record<string, any> }
  | { op: "createNode"; parentId: NodeId; index: number; content: string }
  | { op: "deleteNode"; nodeId: NodeId }
  | { op: "moveNode"; nodeId: NodeId; targetParentId: NodeId; targetIndex: number };

export interface EditPlanStep {
  stepId: string;
  operation: EditOperation;
  generationGroup: string;
  requiresGeneration: boolean;
  draftingInstruction: string;
  contextForDrafting: Record<string, any>;
  generatedContent?: string;
}

export interface EditPlan {
  steps: EditPlanStep[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
}

export interface LLMService {
  complete(prompt: string): Promise<LLMResponse>;
  completeWithToolResults(messages: any[], tools?: ToolDefinition[]): Promise<LLMResponse>;
}

const findBalancedJson = (text: string, startChar: "[" | "{"): string | null => {
  const endChar = startChar === "[" ? "]" : "}";

  for (let start = 0; start < text.length; start++) {
    if (text[start] !== startChar) continue;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === startChar) {
        depth += 1;
        continue;
      }

      if (ch === endChar) {
        depth -= 1;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
        if (depth < 0) {
          break;
        }
      }
    }
  }

  return null;
};

const collectJsonCandidates = (raw: string): string[] => {
  const candidates: string[] = [];
  const add = (value?: string | null) => {
    if (!value) return;
    const normalized = value.replace(/^\uFEFF/, "").trim();
    if (!normalized) return;
    if (!candidates.includes(normalized)) candidates.push(normalized);
  };

  add(raw);

  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of raw.matchAll(fenceRegex)) {
    add(match[1]);
  }

  add(findBalancedJson(raw, "["));
  add(findBalancedJson(raw, "{"));

  return candidates;
};

const parseStrictJson = <T>(
  raw: string,
  expectedRoot: "array" | "object",
  sourceLabel: string
): T => {
  const candidates = collectJsonCandidates(raw);
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (expectedRoot === "array" && !Array.isArray(parsed)) {
        errors.push("Candidate parsed but root was not array");
        continue;
      }
      if (
        expectedRoot === "object" &&
        (parsed === null || Array.isArray(parsed) || typeof parsed !== "object")
      ) {
        errors.push("Candidate parsed but root was not object");
        continue;
      }
      return parsed as T;
    } catch (err: any) {
      errors.push(err?.message ?? String(err));
    }
  }

  const preview = raw.slice(0, 800).replace(/\s+/g, " ").trim();
  throw new Error(
    `[${sourceLabel}] Failed to parse strict JSON (${expectedRoot}). Tried ${candidates.length} candidate(s). Errors: ${errors.join(
      " | "
    )}. Raw preview: ${preview}`
  );
};

const normalizeSeqId = (value: string): string => {
  const trimmed = value.trim();
  const match = /^n(\d+)$/i.exec(trimmed);
  if (!match) return trimmed;
  return `n${match[1]}`;
};

const validateEditPlan = (plan: EditPlan): void => {
  if (!Array.isArray(plan.steps)) {
    throw new Error("[validateEditPlan] plan.steps must be an array");
  }

  const seenStepIds = new Set<string>();

  for (const [index, step] of plan.steps.entries()) {
    if (!step || typeof step !== "object") {
      throw new Error(`[validateEditPlan] Step ${index} is not an object`);
    }

    if (typeof step.stepId !== "string" || step.stepId.trim() === "") {
      throw new Error(`[validateEditPlan] Step ${index} missing stepId`);
    }

    if (seenStepIds.has(step.stepId)) {
      throw new Error(`[validateEditPlan] Duplicate stepId: ${step.stepId}`);
    }
    seenStepIds.add(step.stepId);

    if (!step.operation || typeof step.operation !== "object") {
      throw new Error(`[validateEditPlan] Step ${step.stepId} missing operation`);
    }

    const op = step.operation as EditOperation;

    switch (op.op) {
      case "replaceNode":
        if (typeof op.nodeId !== "string" || op.nodeId.trim() === "") {
          throw new Error(`[validateEditPlan] replaceNode missing nodeId at ${step.stepId}`);
        }
        if (op.content !== undefined && typeof op.content !== "string") {
          throw new Error(`[validateEditPlan] replaceNode.content must be string at ${step.stepId}`);
        }
        break;

      case "createNode":
        if (typeof op.parentId !== "string" || op.parentId.trim() === "") {
          throw new Error(`[validateEditPlan] createNode missing parentId at ${step.stepId}`);
        }
        if (typeof op.index !== "number" || Number.isNaN(op.index)) {
          throw new Error(`[validateEditPlan] createNode.index invalid at ${step.stepId}`);
        }
        if (typeof op.content !== "string") {
          throw new Error(`[validateEditPlan] createNode.content must be string at ${step.stepId}`);
        }
        break;

      case "deleteNode":
        if (typeof op.nodeId !== "string" || op.nodeId.trim() === "") {
          throw new Error(`[validateEditPlan] deleteNode missing nodeId at ${step.stepId}`);
        }
        break;

      case "moveNode":
        if (typeof op.nodeId !== "string" || op.nodeId.trim() === "") {
          throw new Error(`[validateEditPlan] moveNode missing nodeId at ${step.stepId}`);
        }
        if (typeof op.targetParentId !== "string" || op.targetParentId.trim() === "") {
          throw new Error(`[validateEditPlan] moveNode missing targetParentId at ${step.stepId}`);
        }
        if (typeof op.targetIndex !== "number" || Number.isNaN(op.targetIndex)) {
          throw new Error(`[validateEditPlan] moveNode.targetIndex invalid at ${step.stepId}`);
        }
        break;

      default:
        throw new Error(`[validateEditPlan] Unsupported operation at ${step.stepId}`);
    }

    if (typeof step.requiresGeneration !== "boolean") {
      throw new Error(`[validateEditPlan] requiresGeneration must be boolean at ${step.stepId}`);
    }

    if (step.requiresGeneration) {
      if (typeof step.generationGroup !== "string" || step.generationGroup.trim() === "") {
        throw new Error(`[validateEditPlan] generationGroup required at ${step.stepId}`);
      }
      if (
        typeof step.draftingInstruction !== "string" ||
        step.draftingInstruction.trim() === ""
      ) {
        throw new Error(`[validateEditPlan] draftingInstruction required at ${step.stepId}`);
      }
    }
  }
};

export const createEditPlan = async (
  llm: LLMService,
  docNodeMap: Record<NodeId, PMNode>,
  intent: RefinedIntent,
  indexTree: MinimalNode,
  dependencyGraph: DependencyGraph,
  sequentialToLexpalMap: SeqNodeMap
): Promise<EditPlan> => {
  const allNodeIds = Object.keys(docNodeMap);

  const resolveRequestedNodeId = (
    requestedRaw: unknown
  ):
    | { ok: true; requestedId: string; resolvedId: NodeId }
    | {
        ok: false;
        requestedId: string;
        reason: "missing_node_id" | "not_found" | "ambiguous_match";
        candidates?: NodeId[];
      } => {
    const requestedId = typeof requestedRaw === "string" ? requestedRaw.trim() : "";

    if (!requestedId) {
      return { ok: false, requestedId: "", reason: "missing_node_id" };
    }

    if (docNodeMap[requestedId]) {
      return { ok: true, requestedId, resolvedId: requestedId };
    }

    const normalizedAlias = normalizeSeqId(requestedId);
    const aliasMatch = sequentialToLexpalMap[normalizedAlias];
    if (aliasMatch && docNodeMap[aliasMatch]) {
      return { ok: true, requestedId, resolvedId: aliasMatch };
    }

    const normalizedRequested = requestedId.replace(/-/g, "").toLowerCase();
    const candidates = allNodeIds.filter((id) => {
      const normalized = id.replace(/-/g, "").toLowerCase();
      return (
        normalized === normalizedRequested ||
        normalized.startsWith(normalizedRequested) ||
        normalized.endsWith(normalizedRequested)
      );
    });

    if (candidates.length === 1) {
      return { ok: true, requestedId, resolvedId: candidates[0] };
    }

    if (candidates.length > 1) {
      return {
        ok: false,
        requestedId,
        reason: "ambiguous_match",
        candidates: candidates.slice(0, 8),
      };
    }

    return { ok: false, requestedId, reason: "not_found" };
  };

  const tools: ToolDefinition[] = [
    {
      name: "fetchNodeContent",
      description:
        "Get the exact current markup content of a node by sequential LLM id (n1, n2, ... ) or stable lexpalId.",
      parameters: {
        type: "object",
        properties: {
          sequentialLlmId: {
            type: "string",
            description: "Sequential id like n12. You may also pass stable lexpalId.",
          },
          nodeId: {
            type: "string",
            description: "Backward compatibility alias for sequentialLlmId.",
          },
        },
        required: [],
      },
    },
  ];

  const systemMsg = `
You are a legal editing planner. Your job is to translate a refined editing objective into a
precise, deterministic sequence of low-level document operations that a downstream executor
will apply verbatim to a ProseMirror document.
 
═══════════════════════════════════════════════════════════
INPUTS YOU RECEIVE
═══════════════════════════════════════════════════════════
1. refinedIntent   – The verified editing goal (what must change and why).
2. indexTree       – The complete minimal document tree. Every node entry contains:
     { id, type, index, memo, parentId }
   where:
     • id         – stable node ID (e.g. "p17", "h3")
     • type       – ProseMirror node type (paragraph, heading, listItem, …)
     • index      – 0-based position inside the parent's content array
     • memo       – human-readable description of what the node contains
     • parentId   – id of the parent container node (null for root)
3. dependencyGraph – Undirected adjacency list between fundamental block nodes
   (paragraphs / list items that share terms, or where one clause is derivative
   of another). When you edit a node you MUST inspect its dependents and decide
   whether cascading edits are needed.
 
═══════════════════════════════════════════════════════════
TOOL AVAILABLE
═══════════════════════════════════════════════════════════
fetchNodeContent(nodeId) → returns the node's exact current markup string.
 


fetchNodeContent is expensive.

You should first analyze available metadata, memos, dependency graph, and minimal tree.

Call this tool before writing a draftingInstruction for ANY node you intend to
modify, delete, or whose sibling/dependent context you need. Never guess at
wording; always fetch first.





Most requests should require no more than 6 fetchNodeContent calls.

if the task is simple dont keep on fetching nodes and end up in an endless tool call cycle since, theres a deterministic hard cap of 20 tool calls, in this function call.

strictly dont exceed more than 19 tool calls to be on the safe side, even if the data is insufficient force output an edit plan with whatever data is collected with a hard cap of 19 tool calls
 
═══════════════════════════════════════════════════════════
OPERATION REFERENCE
═══════════════════════════════════════════════════════════
All content strings use a custom ProseMirror markup language that will be parsed
into ProseMirror nodes by the executor. Write markup exactly as you would see it
returned by fetchNodeContent.
 
──────────────────────────────────────────────
op: "replaceNode"
──────────────────────────────────────────────
Swaps one existing node for a new node of the same or different type.
The old node is removed; the new node is inserted at exactly the same position.
 
Parameters:
  nodeId  : string          – ID of the node to replace.
  content?: string          – New markup content for the replacement node.
                              Omit only when you are changing attrs but keeping content identical.
  attrs?  : Record<string, any> – New attrs (e.g. heading level). Merged with
                              existing attrs unless you explicitly override keys.
 
When to use: rewording a clause, changing a heading level, or altering a list item.
One replaceNode = one node. Do not use to insert additional nodes; use createNode for that.
 
──────────────────────────────────────────────
op: "createNode"
──────────────────────────────────────────────
Inserts one or more new nodes into a parent's content array.
 
Parameters:
  parentId: string   – ID of the container node whose content array receives the new node(s).
  index   : number   – 0-based insertion position inside that content array.
                       Existing children at index and beyond are shifted right.
  content : string   – Markup for the new node(s) to be parsed and inserted.
 
When to use: adding a new paragraph, list item, heading, or clause that does not
yet exist in the document.
 
──────────────────────────────────────────────
op: "deleteNode"
──────────────────────────────────────────────
Permanently removes a node and all its descendants.
 
Parameters:
  nodeId: string – ID of the node to remove.
 
When to use: removing an obsolete clause, redundant paragraph, or superseded list item.
 
──────────────────────────────────────────────
op: "moveNode"
──────────────────────────────────────────────
Relocates an existing node to a different position (possibly a different parent).
 
Parameters:
  nodeId       : string – ID of the node to move.
  targetParentId: string – ID of the destination parent container.
  targetIndex  : number – 0-based insertion index in the destination parent
                          (evaluated after the node has been removed from its current position).
 
When to use: reordering clauses, promoting/demoting list items, or restructuring sections.
 
═══════════════════════════════════════════════════════════
CONTEXT RULES FOR EACH STEP  (contextForDrafting)
═══════════════════════════════════════════════════════════
Every step must carry enough context for the content-generation agent that runs later.
Populate contextForDrafting with ALL of the following that are relevant:
 
  targetNodeId       – id of the node being acted upon
  targetNodeContent  – current markup of that node (fetch it)
  precedingHeading   – id + content of the nearest ancestor/preceding heading
  precedingSibling   – id + content of the immediately preceding sibling node
  followingSibling   – id + content of the immediately following sibling node
  parentNode         – id + type + memo of the parent container
  dependentNodes     – array of { id, content } for nodes connected in the dependency
                       graph that may need to stay consistent with this edit
  relatedNodes       – any other nodes whose memo suggests they are semantically
                       coupled to this edit (cross-references, defined terms, etc.)
 
Fetch any of these you do not already have before writing the step.
 
═══════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════
Return a JSON array of steps. Output ONLY the raw JSON array — no markdown fences,
no prose, no explanation.
 
Each step schema:
{
  "stepId"             : "<unique string, e.g. step_1>",
  "operation"          : {
    "op"               : "replaceNode" | "createNode" | "deleteNode" | "moveNode",
    ... operation-specific parameters as described above
  },
  "generationGroup"    : "<string — same value for logically coupled steps that must be drafted together>",
  "requiresGeneration" : true | false,
  "draftingInstruction": "<Clear, self-contained legal drafting instruction for the content-generation agent. Include: what to write, the legal register/style, what must be preserved, what must change, and any cross-references to maintain.>",
  "contextForDrafting" : { ... fields as described above ... }
}
 
Steps that require no new text (pure structural moves or deletions) should set
requiresGeneration: false and may omit draftingInstruction.
 
Order steps so that later steps do not depend on indices that earlier steps have
already shifted. When step order matters, note it in draftingInstruction.
`.trim();

  let messages: any[] = [
    { role: "system", content: systemMsg },
    {
      role: "user",
      content: JSON.stringify({
        refinedIntent: intent,
        indexTree,
        dependencyGraph,
        sequentialToLexpalMap,
      }),
    },
  ];

  let response: LLMResponse = { content: "" };
  let toolRound = 0;
  const MAX_TOOL_ROUNDS = 20;

  while (true) {
    toolRound += 1;
    if (toolRound > MAX_TOOL_ROUNDS) {
      throw new Error(`[createEditPlan] Exceeded max tool rounds (${MAX_TOOL_ROUNDS}).`);
    }

    response = await llm.completeWithToolResults(messages, tools);

    if (response.toolCalls && response.toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: null,
        tool_calls: response.toolCalls.map((call: ToolCall) => ({
          type: "function",
          id: call.id,
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments ?? {}),
          },
        })),
      });

      for (const call of response.toolCalls) {
        if (call.name !== "fetchNodeContent") continue;

        const requestedNodeId =
          call.arguments?.sequentialLlmId ?? call.arguments?.nodeId ?? "";
        const resolved = resolveRequestedNodeId(requestedNodeId);

        const content = (() => {
          if (!resolved.ok) {
            if (resolved.reason === "missing_node_id" || resolved.reason === "not_found") {
              return JSON.stringify({
                code: "NODE_NOT_FOUND",
                requestedNodeId: resolved.requestedId || null,
                message:
                  "Requested node id is missing or not found in this document version. Use ids from minimal tree or sequential map.",
              });
            }

            return JSON.stringify({
              code: "AMBIGUOUS_NODE_ID",
              requestedNodeId: resolved.requestedId,
              message: "Requested id matched multiple nodes.",
              candidates: resolved.candidates ?? [],
            });
          }

          const pmNode = docNodeMap[resolved.resolvedId];
          if (!pmNode) {
            return JSON.stringify({
              code: "NODE_NOT_FOUND",
              requestedNodeId: resolved.resolvedId,
              message: "Resolved id not present in current doc map.",
            });
          }

          return pmNodeToMarkup(pmNode);
        })();

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content,
        });
      }
    } else {
      break;
    }
  }

  const raw: string =
    typeof response.content === "string"
      ? response.content
      : ((response.content as any[] | undefined)
          ?.filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("") ?? "");

  const steps = parseStrictJson<EditPlanStep[]>(raw, "array", "createEditPlan");
  const plan = { steps };
  validateEditPlan(plan);
  return plan;
};






const ensureGeneratedContentCompleteness = (plan: EditPlan): void => {
  const missing = plan.steps
    .filter(s => s.requiresGeneration && (!s.generatedContent || s.generatedContent.trim() === ""))
    .map(s => s.stepId);

  if (missing.length > 0) {
    throw new Error(
      `[generateContent] Missing generatedContent for step(s): ${missing.join(", ")}`
    );
  }
};





export const generateContent = async (
  draftingLLM: LLMService,
  plan: EditPlan
): Promise<EditPlan> => {
  const groupMap = new Map<string, EditPlanStep[]>();
  for (const step of plan.steps) {
    if (!step.requiresGeneration) continue;
    const group = step.generationGroup || "default";
    if (!groupMap.has(group)) groupMap.set(group, []);
    groupMap.get(group)!.push(step);
  }

  for (const [groupId, steps] of groupMap) {
    const prompt = buildDraftingPrompt(steps);
    const response = await draftingLLM.complete(prompt);
    const generated = parseStrictJson<
      {
        stepId: string;
        generatedContent: string;
      }[]
    >(response.content, "array", `generateContent:${groupId}`);

    const byStepId = new Map(generated.map(item => [item.stepId, item.generatedContent]));

    for (const step of steps) {
      const generatedContent = byStepId.get(step.stepId);
      if (typeof generatedContent === "string") {
        step.generatedContent = generatedContent;
      }
    }
  }

  ensureGeneratedContentCompleteness(plan);
  return plan;
};

const buildDraftingPrompt = (steps: EditPlanStep[]): string => {
  const instructions = steps.map((s) => ({
    stepId: s.stepId,
    operation: s.operation,
    instruction: s.draftingInstruction,
    context: s.contextForDrafting,
  }));

  return `
You are a legal drafting expert.
Produce PM-Lite markup for the following step group.

Steps: ${JSON.stringify(instructions)}

═══════════════════════════════════════════════
PM-LITE MARKUP LANGUAGE — COMPLETE SPECIFICATION
═══════════════════════════════════════════════

PM-Lite is a line-based, indentation-driven format that maps directly to
ProseMirror document JSON. Every line is either blank (ignored) or a node
declaration beginning with "!".

────────────────────────────────────────────────
1. BASIC SYNTAX
────────────────────────────────────────────────

Every node line follows this pattern:

  !<type> [attr1=value1 attr2=value2 ...][: inline text]

  • Must start with "!".
  • <type> is the ProseMirror node type (one word, no spaces).
  • Attributes are key=value pairs after the type, separated by spaces.
  • A colon ":" separates the node declaration from optional inline text.
    - The colon and text form a shorthand: the node gets a single !text child
      automatically. Do NOT also indent child nodes under it.
  • Attribute values containing spaces or special characters must be
    double-quoted: marks="bold,italic"
  • A ":" inside double quotes is NOT treated as the text separator.

────────────────────────────────────────────────
2. INDENTATION (PARENT–CHILD RELATIONSHIPS)
────────────────────────────────────────────────

  • Indentation (leading spaces) determines nesting.
  • A child must be indented MORE than its parent.
  • Use consistent spacing (2 or 4 spaces per level recommended).
  • The document root is implicit — top-level nodes have no indentation.

  Example:
    !paragraph
      !text: First sentence.

────────────────────────────────────────────────
3. NODE TYPES
────────────────────────────────────────────────

BLOCK NODES (may contain children)
┌─────────────────┬──────────────────────────────────────────────────────┐
│ Node            │ Supported Attributes                                 │
├─────────────────┼──────────────────────────────────────────────────────┤
│ !heading        │ level=<1-6>                                          │
│ !paragraph      │ align=<left|center|right|justify>                    │
│ !bulletList     │ (none)                                               │
│ !orderedList    │ listType=<1|a|i|…>  (maps to ProseMirror "order")   │
│ !listItem       │ (none)                                               │
│ !<custom>       │ any key=value pairs (passed through as-is)           │
└─────────────────┴──────────────────────────────────────────────────────┘

INLINE NODE
┌─────────────────┬──────────────────────────────────────────────────────┐
│ !text           │ marks="<mark1>,<mark2>,…"                            │
│                 │ MUST always have inline text after ":"               │
│                 │ NEVER used as a top-level / root node                │
└─────────────────┴──────────────────────────────────────────────────────┘

────────────────────────────────────────────────
4. THE !text NODE — INLINE CONTENT
────────────────────────────────────────────────

  Syntax:  !text [marks="..."]: <content>
  • The ": content" part is REQUIRED for !text.
  • "marks" is a comma-separated list of mark names.
  • Marks with attributes use parentheses:
      marks="link(href=https://example.com),bold"
  • Multiple marks: marks="bold,italic"
  • !text nodes are LEAF nodes — they can never have children.

  Examples:
    !text: Plain text
    !text marks="bold": Important term
    !text marks="bold,italic": Bold and italic
    !text marks="link(href=https://example.com)": Click here

────────────────────────────────────────────────
5. SHORTHAND — INLINE TEXT ON BLOCK NODES
────────────────────────────────────────────────

  When a block node's entire content is a single, plain (unmarked) text
  string, you may write it inline using ":":

    !paragraph: This is the full paragraph text.
    !heading level=2: Section Title

  This is equivalent to:

    !paragraph
      !text: This is the full paragraph text.

  CONSTRAINT: Once you use the shorthand colon, you must NOT also add
  indented children under that line. Use one or the other.

────────────────────────────────────────────────
6. LIST STRUCTURE
────────────────────────────────────────────────

  Lists require three levels: list → listItem → paragraph → text.

  Unordered:
    !bulletList
      !listItem
        !paragraph: Item one.
      !listItem
        !paragraph: Item two.

  Ordered:
    !orderedList listType=1
      !listItem
        !paragraph: First item.
      !listItem
        !paragraph: Second item.

────────────────────────────────────────────────
7. MIXED INLINE CONTENT (multiple !text children)
────────────────────────────────────────────────

  When a paragraph contains text with different marks, do NOT use the
  shorthand colon. Instead, add multiple !text children:

    !paragraph
      !text: This clause is effective as of
      !text marks="bold": 1 January 2025
      !text: , unless otherwise stated.

────────────────────────────────────────────────
8. COMPLETE EXAMPLES
────────────────────────────────────────────────

  Heading with body paragraph:
    !heading level=1: Agreement Title
    !paragraph: This Agreement is entered into by the parties below.

  Section with mixed inline formatting:
    !heading level=2: Definitions
    !paragraph
      !text: "
      !text marks="bold": Effective Date
      !text: " means the date first written above.

  Bulleted clause list:
    !heading level=3: Obligations
    !bulletList
      !listItem
        !paragraph: Party A shall deliver the goods within 30 days.
      !listItem
        !paragraph: Party B shall make payment upon delivery.

════════════════════════════════════════════════
OUTPUT RULES
════════════════════════════════════════════════

- Output ONLY a raw JSON array. No markdown fences, no commentary.
- Each object: { "stepId": "...", "generatedContent": "<PML markup>" }
- For replaceNode: exactly one top-level block node.
- For createNode: one or more top-level block nodes.
- The root of generatedContent must ALWAYS be a block node
  (!heading, !paragraph, !bulletList, !orderedList, etc.).
- NEVER place a !text node at the root level.
- NEVER use the shorthand colon AND indented children on the same node.
- Attribute values with spaces must be double-quoted.
`.trim();
};

export const runEditingPipeline = async (
  planningLLM: LLMService,
  draftingLLM: LLMService,
  refinedIntent: RefinedIntent,
  indexTree: MinimalNode,
  dependencyGraph: DependencyGraph,
  sequentialToLexpalMap: SeqNodeMap,
  docNodeMap: Record<NodeId, PMNode>
): Promise<EditPlan> => {
  let editPlan = await createEditPlan(
    planningLLM,
    docNodeMap,
    refinedIntent,
    indexTree,
    dependencyGraph,
    sequentialToLexpalMap
  );

  editPlan = await generateContent(draftingLLM, editPlan);
  return editPlan;
};

