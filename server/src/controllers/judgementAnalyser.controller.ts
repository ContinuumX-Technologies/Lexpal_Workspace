import { Request, Response } from "express";
import openai from "../infra/openai.client";
import { encoding_for_model } from "tiktoken";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnalysisRequest {
  judgementText?: string;
  htmlContent?: string;
  query?: string;
  history?: ChatMessage[];
  task?: "facts" | "issues" | "petitioner_args" | "respondent_args" | "law_analysis" | "precedent_analysis" | "court_reasoning" | "conclusion";
}

// ─── Token Helpers ────────────────────────────────────────────────────────────

// Helper to chunk text using tiktoken
function splitTextIntoTokenChunks(
  text: string,
  maxTokens: number,
  model: string = "gpt-4o"
): string[] {
  const enc = encoding_for_model(model as any);
  const tokens = enc.encode(text);
  if (tokens.length <= maxTokens) {
    enc.free();
    return [text];
  }

  const chunks: string[] = [];
  for (let i = 0; i < tokens.length; i += maxTokens) {
    const chunkTokens = tokens.slice(i, i + maxTokens);
    const decoded = new TextDecoder().decode(
      new Uint8Array(enc.decode(chunkTokens))
    );
    chunks.push(decoded);
  }
  enc.free();
  return chunks;
}

// ─── Controller ───────────────────────────────────────────────────────────────

export const judgementAnalyserController = async (
  req: Request<{}, {}, AnalysisRequest>,
  res: Response
) => {
  try {
    const { judgementText, htmlContent, query, history = [], task } = req.body;

    const contentInput = htmlContent || judgementText;

    if (!contentInput) {
      return res.status(400).json({ error: "Either htmlContent or judgementText is required" });
    }

    const chunks = splitTextIntoTokenChunks(contentInput, 100000);

    const taskLabels: Record<string, string> = {
      facts: "Facts of the case",
      issues: "Legal issues identified",
      petitioner_args: "Arguments from the Petitioner/Appellant",
      respondent_args: "Arguments from the Respondent",
      law_analysis: "Analysis of applicable laws",
      precedent_analysis: "Analysis of precedents cited",
      court_reasoning: "The Court's reasoning",
      conclusion: "The final conclusion/judgement"
    };

    let systemPrompt = "";
    let getBaseUserPrompt = (content: string) => "";

    if (task) {
      // Task-based analysis (Facts, Issues, etc.)
      systemPrompt = `You are a legal expert analyzer. Your task is to extract and summarize specific parts of a legal judgement. 
Return your response in a clear, professional, and well-structured format. Use paragraphs and bullet points where appropriate.`;
      getBaseUserPrompt = (content: string) => `Based on the following judgement content, please provide a detailed summary of the ${taskLabels[task] || task}.

Judgement Content:
${content}`;
    } else if (query) {
      // Chat-based analysis
      systemPrompt = `You are LexAI, a legal assistant helping a lawyer analyze a specific judgement. 
Use the provided judgement content to answer the user's questions accurately. 
If the information is not in the text, state that clearly. 
When referring to specific paragraphs, use the ¶ symbol if available in the text.`;
      getBaseUserPrompt = (content: string) => `Judgement Content:
${content}

User Question:
${query}`;
    } else {
      return res.status(400).json({ error: "Either query or task is required" });
    }

    if (chunks.length === 1) {
      const response = await openai.chat.completions.create({
        model: "gpt-5-nano",
        messages: [
          { role: "system", content: systemPrompt },
          ...history.map(h => ({ role: h.role, content: h.content })),
          { role: "user", content: getBaseUserPrompt(chunks[0]) }
        ],
      });

      const result = response.choices[0].message.content;
      return res.json({ result });
    } else {
      const chunkResponses: string[] = [];

      if (task) {
        for (let i = 0; i < chunks.length; i++) {
          const userPrompt = getBaseUserPrompt(chunks[i]) + `\n\nIMPORTANT: If this section of the judgement does not contain any relevant information for the task, reply with "NOT_FOUND" exactly.`;

          const response = await openai.chat.completions.create({
            model: "gpt-5-nano",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ],
          });

          const chunkResult = response.choices[0]?.message?.content || "";
          if (chunkResult.trim() && chunkResult.trim() !== "NOT_FOUND") {
            chunkResponses.push(chunkResult);
          }
        }

        if (chunkResponses.length === 0) {
          return res.json({ result: "Information not found in the judgement." });
        }
        if (chunkResponses.length === 1) {
          return res.json({ result: chunkResponses[0] });
        }

        const synthesisPrompt = `You are a legal expert analyzer. Synthesize the following summary parts extracted from different sections of a judgment into a single coherent, comprehensive, and well-structured response for "${taskLabels[task] || task}".
Do not lose any key legal arguments, facts, or rulings.

Parts to synthesize:
${chunkResponses.map((r, idx) => `--- Part ${idx + 1} ---\n${r}`).join("\n\n")}`;

        const response = await openai.chat.completions.create({
          model: "gpt-5-nano",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: synthesisPrompt }
          ],
        });
        const result = response.choices[0]?.message?.content;
        return res.json({ result });

      } else if (query) {
        for (let i = 0; i < chunks.length; i++) {
          const userPrompt = getBaseUserPrompt(chunks[i]) + `\n\nIMPORTANT: If this section of the judgement does not contain any relevant information to answer the user question, reply with "NOT_FOUND" exactly.`;

          const response = await openai.chat.completions.create({
            model: "gpt-5-nano",
            messages: [
              { role: "system", content: systemPrompt },
              ...history.map(h => ({ role: h.role, content: h.content })),
              { role: "user", content: userPrompt }
            ],
          });

          const chunkResult = response.choices[0]?.message?.content || "";
          if (chunkResult.trim() && chunkResult.trim() !== "NOT_FOUND") {
            chunkResponses.push(chunkResult);
          }
        }

        if (chunkResponses.length === 0) {
          return res.json({ result: "I could not find information addressing your question in the judgement." });
        }
        if (chunkResponses.length === 1) {
          return res.json({ result: chunkResponses[0] });
        }

        const synthesisPrompt = `The user asked: "${query}"
We retrieved the following partial answers from different sections of the judgment:

${chunkResponses.map((r, idx) => `--- Answer Part ${idx + 1} ---\n${r}`).join("\n\n")}

Synthesize these parts into a single coherent, accurate, and comprehensive response. Keep the tone helpful and professional.`;

        const response = await openai.chat.completions.create({
          model: "gpt-5-nano",
          messages: [
            { role: "system", content: systemPrompt },
            ...history.map(h => ({ role: h.role, content: h.content })),
            { role: "user", content: synthesisPrompt }
          ],
        });
        const result = response.choices[0]?.message?.content;
        return res.json({ result });
      }
    }

  } catch (error) {
    console.error("❌ Judgement Analyser Error:", error);
    return res.status(500).json({ error: "Analysis failed" });
  }
};
