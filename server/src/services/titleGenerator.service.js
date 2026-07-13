import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


function sanitizeTitle(text) {
  return text
    .replace(/["'.:,!?]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(" ");
}

export default async function generateConversationTitle(
  userPrompt
) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini", // cheap + fast
    temperature: 0.2,     // low creativity = stable titles
    max_tokens: 20,

    messages: [
      {
        role: "system",
        content:
          "You generate short, concise conversation titles.",
      },
      {
        role: "user",
        content: `
Generate a 3 to 4 word title for the following user prompt.
Do NOT include quotes.
Do NOT include punctuation.
Do NOT include emojis.

User prompt:
${userPrompt}
        `.trim(),
      },
    ],
  });

  const rawTitle =
    response.choices[0].message.content || "";

  const title = sanitizeTitle(rawTitle);

  return {
    title,
    description: userPrompt,
  };
}