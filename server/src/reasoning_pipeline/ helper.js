import openaiClient from "../infra/openai.client.ts";
import { lookupLaw, getLaw } from "./tools.js";
import fs from "fs";



//remove fence markdown
export function parseLLMJson(rawText) {
  if (rawText && typeof rawText === "object") {
    return rawText;
  }

  if (typeof rawText !== "string") {
    throw new Error("Expected LLM response to be a string");
  }

  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const cleanJson = fencedMatch ? fencedMatch[1].trim() : trimmed;

  const tryParse = (value) => {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const direct = tryParse(cleanJson);
  if (direct !== null) {
    return direct;
  }

  const firstObjectStart = cleanJson.indexOf("{");
  const lastObjectEnd = cleanJson.lastIndexOf("}");
  if (firstObjectStart !== -1 && lastObjectEnd > firstObjectStart) {
    const maybeObject = cleanJson.slice(firstObjectStart, lastObjectEnd + 1);
    const parsedObject = tryParse(maybeObject);
    if (parsedObject !== null) {
      return parsedObject;
    }
  }

  const firstArrayStart = cleanJson.indexOf("[");
  const lastArrayEnd = cleanJson.lastIndexOf("]");
  if (firstArrayStart !== -1 && lastArrayEnd > firstArrayStart) {
    const maybeArray = cleanJson.slice(firstArrayStart, lastArrayEnd + 1);
    const parsedArray = tryParse(maybeArray);
    if (parsedArray !== null) {
      return parsedArray;
    }
  }

  throw new Error("Failed to parse LLM JSON response");
}




export async function callLLM({ model, prompt, expectJson = true, systemPrompt }) {
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await openaiClient.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content:
              systemPrompt ||
              (expectJson
                ? "You are a legal reasoning engine. Return strict JSON only, without markdown fences."
                : "You are a legal reasoning engine. Return clear legal analysis in plain text.")
          },
          { role: "user", content: prompt }
        ]
      });

      return res.choices?.[0]?.message?.content || "";
    } catch (err) {
      const isRateLimit = err?.status === 429 || err?.code === "rate_limit_exceeded";
      if (!isRateLimit || attempt === maxRetries) {
        throw err;
      }

      const retryAfterMsHeader = Number(err?.headers?.["retry-after-ms"]);
      const retryAfterSecHeader = Number(err?.headers?.["retry-after"]);
      const waitMs = Number.isFinite(retryAfterMsHeader)
        ? retryAfterMsHeader
        : Number.isFinite(retryAfterSecHeader)
          ? retryAfterSecHeader * 1000
          : 800;

      await new Promise((resolve) => setTimeout(resolve, waitMs + attempt * 300));
    }
  }

  return "";
}



function normalizeScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(10, Math.round(num * 10) / 10));
}



function normalizeString(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value).trim();
}



function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => normalizeString(v)).filter(Boolean);
}



function truncateText(value, maxLen = 900) {
  const text = normalizeString(value);
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)} ...[truncated]`;
}



function lawCompositeKey(law) {
  const act = normalizeString(law.act_name).toLowerCase();
  const section = normalizeString(law.section_no).toLowerCase();
  const chapter = normalizeString(law.chapter_name).toLowerCase();
  const chapterCode = normalizeString(law.chapter_code).toLowerCase();
  const chunk = normalizeString(law.chunk_id).toLowerCase();

  // Prefer law-level dedupe (act+section/chapter), fallback to chunk when needed.
  if (section || chapter || chapterCode) {
    return [act, section, chapter, chapterCode].join("::");
  }

  return [act, chunk].join("::");
}



function normalizeLawObject(law) {
  const safeLaw = law && typeof law === "object" ? law : {};

  return {
    act_name: normalizeString(safeLaw.act_name),
    section_no: normalizeString(safeLaw.section_no),
    chapter_name: normalizeString(safeLaw.chapter_name),
    chapter_code: normalizeString(safeLaw.chapter_code),
    act_year: normalizeString(safeLaw.act_year),
    chunk_id: normalizeString(safeLaw.chunk_id),
    law_text: normalizeString(safeLaw.law_text),
    reasoning: normalizeString(safeLaw.reasoning),
    relevance_score: normalizeScore(safeLaw.relevance_score),
    materially_applicable:
      typeof safeLaw.materially_applicable === "boolean"
        ? safeLaw.materially_applicable
        : true,
    matched_fact_points: normalizeStringArray(safeLaw.matched_fact_points),
    matched_question_points: normalizeStringArray(safeLaw.matched_question_points)
  };
}



function isMateriallyRelevantLaw(law, config) {
  const minLawRelevanceScore = Number(config?.minLawRelevanceScore ?? 7);
  const hasCoreIdentifier = Boolean(law.act_name && (law.section_no || law.chapter_name || law.chunk_id));
  const hasUsableSubstance = Boolean(law.law_text && law.reasoning);
  const hasFactOrQuestionLink =
    (law.matched_fact_points?.length || 0) > 0 ||
    (law.matched_question_points?.length || 0) > 0;

  return (
    hasCoreIdentifier &&
    hasUsableSubstance &&
    law.materially_applicable !== false &&
    law.relevance_score >= minLawRelevanceScore &&
    hasFactOrQuestionLink
  );
}



export function dedupeAndRankDiscoveredLaws(laws, config) {
  const maxDiscoveredLaws = Number(config?.maxDiscoveredLaws ?? 10);
  const bestByKey = new Map();

  for (const candidate of Array.isArray(laws) ? laws : []) {
    const normalized = normalizeLawObject(candidate);
    if (!isMateriallyRelevantLaw(normalized, config)) continue;

    const key = lawCompositeKey(normalized);
    if (!key.replace(/:/g, "")) continue;

    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, normalized);
      continue;
    }

    if (
      normalized.relevance_score > existing.relevance_score ||
      (normalized.relevance_score === existing.relevance_score &&
        normalized.reasoning.length > existing.reasoning.length)
    ) {
      bestByKey.set(key, normalized);
    }
  }

  return Array.from(bestByKey.values())
    .sort((a, b) => {
      if (b.relevance_score !== a.relevance_score) return b.relevance_score - a.relevance_score;
      return b.reasoning.length - a.reasoning.length;
    })
    .slice(0, maxDiscoveredLaws);
}



function compactToolResultsForEvaluation(toolResults) {
  const maxItems = 10;

  return (Array.isArray(toolResults) ? toolResults : []).map((resultSet) => {
    if (!Array.isArray(resultSet)) {
      return resultSet;
    }

    return resultSet.slice(0, maxItems).map((item) => ({
      metadata: item?.metadata || {},
      text: truncateText(item?.text, 700)
    }));
  });
}



function compactBranchesForAggregation(branches) {
  return (Array.isArray(branches) ? branches : []).map((branch) => ({
    id: branch.id,
    domain: branch.domain,
    purpose: branch.purpose,
    satisfaction: branch.satisfaction,
    missing: branch.missing,
    thoughts: (Array.isArray(branch.thoughts) ? branch.thoughts : []).map((thought) => ({
      satisfied: thought.satisfied,
      score: thought.score,
      missing: thought.missing,
      discovered_laws: (Array.isArray(thought.discovered_laws) ? thought.discovered_laws : []).map((law) => ({
        act_name: law.act_name,
        section_no: law.section_no,
        chapter_name: law.chapter_name,
        chunk_id: law.chunk_id,
        relevance_score: law.relevance_score,
        reasoning: truncateText(law.reasoning, 280),
        law_text: truncateText(law.law_text, 480)
      }))
    }))
  }));
}



function compactDiscoveredLawsForAggregation(discoveredLaws) {
  return (Array.isArray(discoveredLaws) ? discoveredLaws : []).map((law) => ({
    act_name: law.act_name,
    section_no: law.section_no,
    chapter_name: law.chapter_name,
    chapter_code: law.chapter_code,
    act_year: law.act_year,
    chunk_id: law.chunk_id,
    relevance_score: law.relevance_score,
    matched_fact_points: law.matched_fact_points,
    matched_question_points: law.matched_question_points,
    reasoning: truncateText(law.reasoning, 320),
    law_text: truncateText(law.law_text, 600)
  }));
}



export async function extractCase(query, config) {
  const res = await callLLM({
    model: config.models.extractCase,
    prompt: `
Extract structured info:

Return JSON:
{
  "facts": [],
  "questions": []
}

Query:
${query}
`
  });

  const parsed = parseLLMJson(res);

  return {
    facts: normalizeStringArray(parsed.facts),
    questions: normalizeStringArray(parsed.questions)
  };
}






export async function generateBranches(facts, questions, config) {
  const res = await callLLM({
    model: config.models.generateBranches,
    prompt: `
Given facts and questions, generate up to ${config.branches} legal domains and also state each domain's purpose stating precisely what should be explored in this domain.

Rules:
- Return ONLY materially relevant domains for this case
- Do NOT include generic or speculative domains unrelated to stated facts/questions
- If fewer than ${config.branches} domains are truly relevant, return fewer

Return JSON:
[
  { "domain": "",
    "purpose": ""
  }
]

Facts: ${facts.join("\n")}
Questions: ${questions.join("\n")}
`
  });

  const parsed = parseLLMJson(res);
  const branches = Array.isArray(parsed) ? parsed : [];

  return branches.map((b, i) => ({
    id: i,
    domain: normalizeString(b?.domain),
    purpose: normalizeString(b?.purpose),
    thoughts: [],
    clues: [],
    satisfaction: 0,
    discovered_laws: [],
    missing: "None"
  }));
}






export async function runBranch(branch, facts, questions, config, global_discovered_laws) {
  console.log(process.cwd());
  const acts = fs.readFileSync("./src/reasoning_pipeline/acts.txt", "utf8");

  for (let i = 0; i < config.maxThoughts; i++) {
    const thought = await runThought(branch, facts, questions, config, i, acts);

    branch.thoughts.push(thought);
    branch.missing = thought.missing || "na";
    branch.discovered_laws = dedupeAndRankDiscoveredLaws(
      [...branch.discovered_laws, ...(thought.discovered_laws || [])],
      { ...config, maxDiscoveredLaws: Math.max(Number(config.maxDiscoveredLaws || 10), 20) }
    );

    if (thought.clues) {
      branch.clues.push(...thought.clues);
    }

    if (thought.satisfied) {
      branch.satisfaction = thought.score;
      break;
    }
  }

  const mergedGlobal = dedupeAndRankDiscoveredLaws(
    [...global_discovered_laws, ...(branch.discovered_laws || [])],
    config
  );

  global_discovered_laws.splice(0, global_discovered_laws.length, ...mergedGlobal);

  return branch;
}









function buildSafeThoughtPlan(rawPlan, branch, level, config) {
  const fallbackPlan = {
    action: "get",
    act_name: normalizeString(rawPlan?.act_name || branch.domain || ""),
    section_no: "",
    chapter_name: normalizeString(rawPlan?.chapter_name || ""),
    reason: "Fallback to getLaw for robust retrieval when plan is invalid or incomplete."
  };

  const plan = {
    ...fallbackPlan,
    ...((rawPlan && typeof rawPlan === "object") ? rawPlan : {})
  };

  plan.action = normalizeString(plan.action).toLowerCase();
  plan.act_name = normalizeString(plan.act_name);
  plan.section_no = normalizeString(plan.section_no);
  plan.chapter_name = normalizeString(plan.chapter_name);
  plan.reason = normalizeString(plan.reason);

  const allowedActions = new Set(["lookup", "get"]);
  if (!allowedActions.has(plan.action)) {
    return fallbackPlan;
  }

  const isCrucialStep = level + 1 >= config.maxThoughts;
  if (isCrucialStep) {
    plan.action = "get";
  }

  if (plan.action === "lookup" && (!plan.act_name || !plan.section_no)) {
    return fallbackPlan;
  }

  if (plan.action === "get" && !plan.act_name) {
    return fallbackPlan;
  }

  return plan;
}



export async function runThought(branch, facts, questions, config, level, acts) {
  console.log(`running thought level:${level}/${config.maxThoughts} of branch_id: ${branch.id}`);

  const isCrucialStep = level + 1 >= config.maxThoughts;

  const res = await callLLM({
    model: config.models.runThoughtPlan,
    prompt: `
You are a legal reasoning agent working on ONE branch.

========================
BRANCH CONTEXT
========================

Domain:
${branch.domain}

Purpose:
${branch.purpose || "Find and apply relevant laws to solve this legal situation"}

Facts:
${facts.join("\n")}

User Question:
${questions.join("\n")}

Previously Discovered Laws:
${JSON.stringify(branch.discovered_laws)}

Missing Direction from previous step:
${branch.missing || "None"}

========================
AVAILABLE ACTS
========================

Format: ActName|1(has chapters) or 0(no chapters)

${acts}

========================
INSTRUCTIONS
========================

You are at Thought Step ${level + 1} (max ${config.maxThoughts})

Your job:
- Move closer to solving the branch purpose
- Use "missing" direction to guide your next step
- Avoid repeating same laws
- Prefer precise retrieval where possible
- For crucial/high-impact retrieval steps, prefer getLaw

Strategy:

1. Use "lookup" if exact section and exact act is known
2. Use "get" for chapter-level or act-level retrieval
3. If this is the final thought or previous attempts were insufficient, choose "get"

Crucial step for this thought: ${isCrucialStep ? "YES" : "NO"}

========================
RETURN JSON
========================

{
  "action": "lookup" | "get",
  "act_name": "",
  "section_no": "",
  "chapter_name": "",
  "reason": "why this step is useful"
}
`
  });

  let parsedPlan = {};
  try {
    parsedPlan = parseLLMJson(res);
  } catch {
    parsedPlan = {};
  }

  const plan = buildSafeThoughtPlan(parsedPlan, branch, level, config);

  console.log("toolcall: " + plan.action);
  console.log("reasoning: " + plan.reason);

  const toolResults = [];

  if (plan.action === "lookup") {
    const r = await lookupLaw({
      act_name: plan.act_name,
      section_no: plan.section_no
    });
    toolResults.push(r);
  }

  if (plan.action === "get") {
    const r = await getLaw({
      act_name: plan.act_name,
      chapter_name: plan.chapter_name
    });
    toolResults.push(r);
  }

  const compactToolResults = compactToolResultsForEvaluation(toolResults);

  const evalRes = await callLLM({
    model: config.models.runThoughtEval,
    prompt: `
You are a legal reasoning agent working on ONE branch and evaluating retrieved legal data.

========================
BRANCH CONTEXT
========================

Domain:
${branch.domain}

Purpose:
${branch.purpose || "Find and apply relevant laws to solve this legal situation"}

Facts from user's query:
${facts.join("\n")}

Questions asked by user in query:
${questions.join("\n")}

Thought level: ${level}

Direction from previous step:
${branch.missing || "None"}

========================
LAW DATA
========================

${JSON.stringify(compactToolResults)}

========================
TASK
========================

1. Extract only materially relevant laws that directly map to at least one fact or user question
2. Include actual law text
3. Explain why each selected law is applicable to this branch
4. Exclude tangential or weakly related laws
5. Decide if data is sufficient for this branch
6. If not sufficient, state exactly what is missing

========================
RETURN JSON
========================

{
  "discovered_laws": [
    {
      "act_name": "",
      "section_no": "",
      "chapter_name": "",
      "chapter_code": "",
      "act_year": "",
      "chunk_id": "",
      "law_text": "",
      "reasoning": "why useful",
      "relevance_score": 0-10,
      "materially_applicable": true/false,
      "matched_fact_points": ["fact snippets"],
      "matched_question_points": ["question snippets"]
    }
  ],
  "satisfied": true/false,
  "score": 0-10,
  "missing": "what is still needed" if nothing else is needed then write string "na"
}
`
  });

  let parsedEval = {};
  try {
    parsedEval = parseLLMJson(evalRes);
  } catch {
    parsedEval = {
      discovered_laws: [],
      satisfied: false,
      score: 0,
      missing: "Evaluation parser failed to decode model output; need cleaner structured retrieval."
    };
  }
  const relevantDiscoveredLaws = dedupeAndRankDiscoveredLaws(parsedEval?.discovered_laws || [], config);

  const parsedEvalRes = {
    discovered_laws: relevantDiscoveredLaws,
    satisfied: Boolean(parsedEval?.satisfied),
    score: normalizeScore(parsedEval?.score),
    missing: normalizeString(parsedEval?.missing || "na") || "na"
  };

  if (parsedEvalRes.discovered_laws.length === 0 && parsedEvalRes.satisfied) {
    parsedEvalRes.satisfied = false;
    if (parsedEvalRes.missing.toLowerCase() === "na") {
      parsedEvalRes.missing = "Need more directly applicable law text mapped to specific facts/questions.";
    }
  }

  console.log("satisfied: " + parsedEvalRes.satisfied);
  console.log("satisfaction score: " + parsedEvalRes.score);
  console.log("missing:" + parsedEvalRes.missing);

  return parsedEvalRes;
}










export async function aggregateResults(branches, facts, questions, discoveredLaws, config) {
  const compactBranches = compactBranchesForAggregation(branches);
  const compactLaws = compactDiscoveredLawsForAggregation(discoveredLaws);

  const res = await callLLM({
    model: config.models.aggregateResults,
    expectJson: false,
    systemPrompt:
      "You are a senior legal research and reasoning counsel. Provide accurate legal analysis in plain text only.",
    prompt: `
You are preparing the final legal reasoning report.

Case facts:
${facts.join("\n")}

User questions:
${questions.join("\n")}

Branch reasoning traces:
${JSON.stringify(compactBranches)}

Filtered materially applicable discovered laws:
${JSON.stringify(compactLaws)}

Output rules:
- Return plain explanatory text, not JSON
- Explain the research path: how the case was investigated and refined
- Explain which laws apply to which facts/questions
- Explain legal application, effect, and limits for each cited law
- State assumptions and missing facts where uncertainty remains
- End with a concise practical conclusion that answers the user
`
  });

  return typeof res === "string" ? res.trim() : String(res || "").trim();
}
