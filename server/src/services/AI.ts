// lib/ai.ts

import openaiClient from "../infra/openai.client";

// -------------------------------
// Types
// -------------------------------

export type EmbeddingVector = number[];

// -------------------------------
// 1. Get Embedding
// -------------------------------

export async function getEmbedding(
  text: string
): Promise<EmbeddingVector> {
  if (!text || !text.trim()) {
    throw new Error("Empty text provided for embedding");
  }

  const response = await openaiClient.embeddings.create({
    model: "text-embedding-3-small", // fast + cheap
    input: text,
  });

  return response.data[0].embedding;
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