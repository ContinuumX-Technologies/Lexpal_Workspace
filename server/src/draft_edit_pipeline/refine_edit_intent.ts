import { openaiLLM } from "./llmCallFuncs";

// ---- Clarification phase types ----
export interface ClarificationResponse {
  type: "clarification";
  questions: string[];
}

export interface RefinedIntent {
  type: "refined";
  objective: string;
  editingObjective: string;
  draftingRequirements: string[];
  constraints: string[];
  intentConfidence: "high" | "medium" | "low";
}

export type IntentTurnResult = ClarificationResponse | RefinedIntent;

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

  add(findBalancedJson(raw, "{"));

  return candidates;
};

export const parseIntentTurnResult = (raw: string): IntentTurnResult => {
  const candidates = collectJsonCandidates(raw);
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        errors.push("Parsed value is not an object");
        continue;
      }

      const value = parsed as Record<string, unknown>;
      const type = value.type;

      if (type === "clarification") {
        const questions = Array.isArray(value.questions)
          ? value.questions.filter(q => typeof q === "string" && q.trim() !== "")
          : [];

        if (questions.length === 0) {
          errors.push("Clarification response had no usable questions");
          continue;
        }

        return {
          type: "clarification",
          questions: questions.slice(0, 4),
        };
      }

      if (type === "refined") {
        const objective = typeof value.objective === "string" ? value.objective.trim() : "";
        const editingObjective =
          typeof value.editingObjective === "string"
            ? value.editingObjective.trim()
            : objective;

        const draftingRequirements = Array.isArray(value.draftingRequirements)
          ? value.draftingRequirements.filter(x => typeof x === "string").map(x => x.trim()).filter(Boolean)
          : [];

        const constraints = Array.isArray(value.constraints)
          ? value.constraints.filter(x => typeof x === "string").map(x => x.trim()).filter(Boolean)
          : [];

        const confidence = value.intentConfidence;
        const intentConfidence: RefinedIntent["intentConfidence"] =
          confidence === "high" || confidence === "medium" || confidence === "low"
            ? confidence
            : "medium";

        if (!objective) {
          errors.push("Refined response missing objective");
          continue;
        }

        return {
          type: "refined",
          objective,
          editingObjective: editingObjective || objective,
          draftingRequirements,
          constraints,
          intentConfidence,
        };
      }

      errors.push("Unknown response type");
    } catch (err: any) {
      errors.push(err?.message ?? String(err));
    }
  }

  throw new Error(
    `[processIntentTurn] Failed to parse intent response. Errors: ${errors.join(" | ")}`
  );
};

/**
 * Process one turn of the clarification conversation.
 * Returns either more questions or the final refined intent.
 */
export const processIntentTurn = async (
  conversation: { role: "user" | "llm"; content: string }[]
): Promise<IntentTurnResult> => {
  const priorClarificationRounds = conversation.filter(
    m => m.role === "llm" && m.content.includes('"type":"clarification"')
  ).length;

  const remainingRounds = Math.max(0, 4 - priorClarificationRounds);

  const prompt = `
You are a legal draft-editing intent refiner.

You must output ONLY valid JSON.

If intent is clear, output:
{
  "type": "refined",
  "objective": "...",
  "editingObjective": "...",
  "draftingRequirements": ["..."],
  "constraints": ["..."],
  "intentConfidence": "high|medium|low"
}

If clarification is required and rounds are still available, output:
{
  "type": "clarification",
  "questions": ["..."]
}

Rules:
- Ask at most 2 concise clarification questions in one response.
- Never exceed total clarification rounds limit.
- If remaining rounds = 0, you MUST return type="refined".

Remaining clarification rounds: ${remainingRounds}

Conversation so far:
${conversation.map(m => `${m.role}: ${m.content}`).join("\n")}
`.trim();

  const response = await openaiLLM("gpt-5.1").complete(prompt);
  const parsed = parseIntentTurnResult(response.content);

  if (remainingRounds === 0 && parsed.type === "clarification") {
    return {
      type: "refined",
      objective: "Apply the requested legal drafting edits safely and deterministically.",
      editingObjective: "Apply the requested legal drafting edits safely and deterministically.",
      draftingRequirements: [],
      constraints: ["No additional clarification rounds available; proceed conservatively."],
      intentConfidence: "low",
    };
  }

  return parsed;
};
