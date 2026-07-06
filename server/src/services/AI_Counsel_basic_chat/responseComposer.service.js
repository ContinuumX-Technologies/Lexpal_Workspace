import  openaiClient  from "../../infra/openai.client.ts";


/**
 * EXACT LAW → explain statute using retrieved chunks
 */
export async function generateExactLawResponse(metadata, chunks) {
  const texts = chunks.map(
    (c, i) => `--- SOURCE ${i + 1} ---\n${c.content}`
  ).join("\n\n");

  const prompt = `
You are a legal assistant.

Explain the following law clearly and accurately.

Law metadata:
${JSON.stringify(metadata, null, 2)}

Legal text:
${texts}

Provide:
1. Plain-language explanation
2. Applicability
3. Important notes or exceptions

Be precise. Do not hallucinate sections.
`;

  const resp = await openaiClient.chat.completions.create({
    model: "gpt-4.1-nano",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 700,
  });

  return resp.choices[0].message.content;
}

/**
 * CHAT + DATA → grounded legal analysis
 */
export async function generateDataDrivenChatResponse(userQuery, chunks) {
  const texts = chunks.map(
    (c, i) => `--- SOURCE ${i + 1} ---\n${c.content}\n ---meta-data---${JSON.stringify(c.metadata)}`
  ).join("\n\n");

  const prompt = `
You are a legal analyst.

User question:
"${userQuery}"

Use the following legal texts to answer accurately.
  cite the law, act_number, chapter_name, chapter_code, from the meta-datas

${texts}

Provide a clear, practical legal answer.
`;

  const resp = await openaiClient.chat.completions.create({
    model: "gpt-4.1-nano",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 800,
  });

  return resp.choices[0].message.content;
}

/**
 * CHAT NO DATA → pure legal assistant
 */
export async function generatePureChatResponse(userQuery) {
  const prompt = `
You are a knowledgeable legal assistant.

Answer the user's question.


User question:
"${userQuery}"
`;

  const resp = await openaiClient.chat.completions.create({
    model: "gpt-4.1-nano",
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 500,
  });

  return resp.choices[0].message.content;
}