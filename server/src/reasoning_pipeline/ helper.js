import openaiClient from "../infra/openai.client.ts";
import { searchLaw, lookupLaw, getLaw } from "./tools.js";
import fs from "fs";




export function parseLLMJson(rawText) {
  if (typeof rawText !== "string") {
    throw new Error("Expected LLM response to be a string");
  }

  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const cleanJson = fencedMatch ? fencedMatch[1].trim() : trimmed;

  return JSON.parse(cleanJson);
}




export async function callLLM({ model, prompt }) {
  const res = await openaiClient.chat.completions.create({
    model,
    messages: [
      { role: "system", content: "You are a legal reasoning engine. Always return JSON." },
      { role: "user", content: prompt }
    ]
  });

  return res.choices[0].message.content;
}








export async function extractCase(query, model) {
  const res = await callLLM({
    model,
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
  
  return parseLLMJson(res);
}






export async function generateBranches(facts, questions, config) {
  const res = await callLLM({
    model: config.model,
    prompt: `
Given facts and questions, generate ${config.branches} legal domains and also state each domain's purpose stating precisely what should be explored in this domain

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

  return parseLLMJson(res).map((b, i) => ({
    id: i,
    domain: b.domain,
    purpose: b.purpose,
    thoughts: [],
    clues: [],
    satisfaction: 0
  }));
}






export async function runBranch(branch, facts, questions, config) {
  console.log(process.cwd());
  let acts= fs.readFileSync("./src/reasoning_pipeline/acts.txt", "utf8");
  
  for (let i = 0; i < config.maxThoughts; i++) {
    const thought = await runThought(branch, facts, questions, config, i, acts);

    branch.thoughts.push(thought);

    // accumulate clues
    if (thought.clues){
    branch.clues.push(...thought.clues);
    }

    // check satisfaction
    if (thought.satisfied) {
      branch.satisfaction = thought.score;
      break;
    }
  }

  return branch;
}









export async function runThought(branch, facts, questions, config, level, acts) {

  //dev test logs
  console.log(`running thought level:${level}/${config.maxThoughts} of branch_id: ${branch.id}`);


  const res = await callLLM({
    model: config.model,
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
- Prefer precise retrieval over broad

Strategy:

1. Use "search" for vector search exploration (2–4 queries)
2. Use act_name filter if you suspect relevant act
3. Use "lookup" if exact section and exact act is known
4. Use "get" ONLY if stuck or final step

========================
RETURN JSON
========================

{
  "action": "search" | "lookup" | "get",

  "queries": ["..."],

  "act_name": "",
  "section_no": "",
  "chapter_name": "",

  "reason": "why this step is useful"
}
`
  });

  const plan = parseLLMJson(res);

  //dev test logs
  
  console.log("toolcall: " + plan.action);
  console.log("reasoning: " + plan.reason);

  let toolResults = [];

  // ========================
  // TOOL EXECUTION
  // ========================

  if (plan.action === "search") {
    const r = await searchLaw({
      queries: plan.queries,
      act_name: plan.act_name || undefined
    });
    toolResults.push(r);
  }

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

  // ========================
  // EVALUATION
  // ========================

  const evalRes = await callLLM({
    model: config.model,
    prompt: `


You are a legal reasoning agent working on ONE branch and you are evaluating retrieved legal data.

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

Direction from previous step about what was missing because of which the previous thought coudn't satisfy the analysis of this branch:
${branch.missing || "None"}


========================
LAW DATA
========================

${JSON.stringify(toolResults)}

========================
TASK
========================

1. Extract relevant laws
2. Include actual law text
3. Explain why a law is useful or not useful and irrelevant, taking into account the branch context
4. Decide if sufficient to answer this branch
5. if the retrieved data is not sufficient give direction for what was missing, to increase the relevance score of the reasoning on this branch

========================
RETURN JSON
========================

{
  "discovered_laws": [
    {
      "act_name": "",
      "section_no": "",
      "chapter_name": "",
      "chunk_id": "",
      "law_text": "",
      "reasoning": "why useful",
      "relevance_score": 0-10
    }
  ],
  "satisfied": true/false,
  "score": 0-10,
  "missing": "what is still needed" if nothing else is needed then write string "na"
}
`
  });

  let parsedEvalRes= parseLLMJson(evalRes);


  
  //dev test logs
  console.log("satisfied: " + parsedEvalRes.satisfied);
  console.log("satisfaction score: " + parsedEvalRes.score);
  console.log("missing:" + parsedEvalRes.missing);


  return parsedEvalRes;
}










export async function aggregateResults(branches, model) {
  const res = await callLLM({
    model,
    prompt: `
Given these branch results:

${JSON.stringify(branches)}

Select best reasoning and provide final answer.
`
  });

  return res;
}
