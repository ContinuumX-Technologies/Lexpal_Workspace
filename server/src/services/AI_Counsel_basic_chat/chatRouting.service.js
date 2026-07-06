import  openaiClient  from "../../infra/openai.client.ts";

export async function decideQueryRoute(userQuery) {
  const prompt = `
You are a legal query router.

Classify the user's query into ONE of the following:
- EXACT_LAW_QUERY (mentions act, section, article, statute, IPC, CrPC, CPC, Constitution, etc.)
- CHAT_QUERY (everything else)

Rules:
- Reply with ONLY one word.
- No explanation.

User query:
"""${userQuery}"""
`;

  const resp = await openaiClient.chat.completions.create({
    model: "gpt-4.1-nano",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 5,
  });

  const result = resp.choices[0].message.content.trim();
  return result === "EXACT_LAW_QUERY" ? "EXACT_LAW_QUERY" : "CHAT_QUERY";
}