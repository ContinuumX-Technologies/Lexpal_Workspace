import  openaiClient  from "../../infra/openai.client.ts";

export async function extractLawMetadata(userQuery) {
  const prompt = `
Extract legal metadata from the user's query.

Return JSON with ONLY these keys (null if not found):
- law_type
- act_no
- chapter_name
- section

Return parsable JSON only. No commentary.

User query:
"""${userQuery}"""
`;

  const resp = await openaiClient.chat.completions.create({
    model: "gpt-4.1-nano",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 200,
  });

  try {
    return JSON.parse(resp.choices[0].message.content);
  } catch {
    return {
      law_type: null,
      act_no: null,
      chapter_name: null,
      section: null,
    };
  }
}