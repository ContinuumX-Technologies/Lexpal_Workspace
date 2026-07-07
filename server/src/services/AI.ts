// lib/ai.ts

import openaiClient from "../infra/openai.client";

// -------------------------------
// Types
// -------------------------------

export type EmbeddingVector = number[];

// -------------------------------
// 1. Get Embedding
// -------------------------------

// LRU Cache for Embeddings
const embeddingCache = new Map<string, EmbeddingVector>();
const MAX_CACHE_SIZE = 1000;

export async function getEmbedding(
  text: string
): Promise<EmbeddingVector> {
  if (!text || !text.trim()) {
    throw new Error("Empty text provided for embedding");
  }

  const cacheKey = text.trim();
  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey)!;
  }

  const response = await openaiClient.embeddings.create({
    model: "text-embedding-3-small", // fast + cheap
    input: text,
  });

  const vector = response.data[0].embedding;
  
  if (embeddingCache.size >= MAX_CACHE_SIZE) {
    // Delete oldest (first) entry to prevent memory leak
    embeddingCache.delete(embeddingCache.keys().next().value as string);
  }
  embeddingCache.set(cacheKey, vector);

  return vector;
}

// -------------------------------
// 2. Query Rewriting
// -------------------------------

export async function rewriteQuery(
  query: string
): Promise<string> {
  if (!query || !query.trim()) {
    throw new Error("Empty query provided");
  }

  const prompt = `
You are a legal search query optimizer.

Rewrite the user's query into a more precise, keyword-rich legal search query.

Rules:
- Keep it concise (1 sentence)
- Include legal terminology if relevant
- Expand abbreviations if needed
- Preserve original intent
- Do NOT add explanations

User Query:
"${query}"

Return ONLY the rewritten query.
`;

  const response = await openaiClient.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const rewritten =
    response.choices[0]?.message?.content?.trim();

  if (!rewritten) {
    throw new Error("Failed to rewrite query");
  }

  return rewritten;
}

// -------------------------------
// 3. Generate Short Titles
// -------------------------------

export async function generateShortTitles(
  titles: string[]
): Promise<string[]> {
  if (!titles.length) return [];

  const prompt = `
Convert the following legal case titles into SHORT titles.

Rules:
- Format: "Party1 vs Party2"
- Max 4–5 words total
- Each party ideally ≤ 2 words
- Use abbreviations where needed (Govt., State, etc.)
- Keep meaning intact and readable
- If already short, keep it as is

Examples:
"Government of Telangana vs Ram Reddy" → "Govt. Telangana vs Ram Reddy"

Titles:
${titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Return ONLY a valid JSON array of strings in the same order.
`;

  const response = await openaiClient.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const content =
    response.choices[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("Failed to generate short titles");
  }

  try {
    const cleaned = content.match(/```json?\n?([\s\S]*?)\n?```/)
      ? content.match(/```json?\n?([\s\S]*?)\n?```/)![1].trim()
      : content.trim();

    const parsed: unknown = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) {
      throw new Error("Invalid format from LLM");
    }

    // ensure all are strings
    return parsed.map((item) => String(item));
  } catch (err) {
    console.error("Short title parse error:", content);
    throw new Error("Failed to parse short titles");
  }
}

// -------------------------------
// 4. Query Intent & Filter Extraction
// -------------------------------

export interface SearchFilters {
  refinedQuery: string;
  year?: number;
  bench?: string[];
  act_name?: string[];
  section_no?: string[];
  jurisdiction?: string;
}

// LRU Cache for Search Filters
const filterCache = new Map<string, SearchFilters>();

export async function extractSearchFilters(
  query: string
): Promise<SearchFilters> {
  if (!query || !query.trim()) {
    throw new Error("Empty query provided");
  }

  const cacheKey = query.trim();
  if (filterCache.has(cacheKey)) {
    return filterCache.get(cacheKey)!;
  }

  const prompt = `
You are a legal search intent extractor. 
Parse the user's natural language query into structured filters and a refined semantic search query.

Rules:
1. Extract any mentioned years into 'year'.
2. Extract any mentioned judge names into 'bench' (e.g. "D.Y. Chandrachud").
3. Extract any mentioned statutes or acts into 'act_name' (e.g. "Indian Penal Code", "Constitution of India").
4. Extract any mentioned section numbers or articles into 'section_no' (e.g. "302", "14").
5. Extract the court/jurisdiction if specified into 'jurisdiction' (e.g. "Supreme court").
6. The 'refinedQuery' should be a concise, keyword-rich string describing the core legal issue without the extracted filters (e.g., if query is "murder cases in 2018", refinedQuery is "murder").

User Query:
"${query}"
`;

  const response = await openaiClient.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "extract_filters",
          description: "Extracts structured search filters from the query",
          parameters: {
            type: "object",
            properties: {
              refinedQuery: { type: "string" },
              year: { type: "number" },
              bench: { type: "array", items: { type: "string" } },
              act_name: { type: "array", items: { type: "string" } },
              section_no: { type: "array", items: { type: "string" } },
              jurisdiction: { type: "string" },
            },
            required: ["refinedQuery"],
            additionalProperties: false,
          },
        }
      }
    ],
    tool_choice: { type: "function", function: { name: "extract_filters" } }
  });

  const toolCall = response.choices[0]?.message?.tool_calls?.[0];
  if (!toolCall) {
    return { refinedQuery: query };
  }

  try {
    const args = JSON.parse(toolCall.function.arguments);
    const result = {
      refinedQuery: args.refinedQuery || query,
      year: args.year,
      bench: args.bench?.length ? args.bench : undefined,
      act_name: args.act_name?.length ? args.act_name : undefined,
      section_no: args.section_no?.length ? args.section_no : undefined,
      jurisdiction: args.jurisdiction,
    };
    
    if (filterCache.size >= MAX_CACHE_SIZE) {
      filterCache.delete(filterCache.keys().next().value as string);
    }
    filterCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error("Failed to parse tool call arguments", err);
    return { refinedQuery: query };
  }
}