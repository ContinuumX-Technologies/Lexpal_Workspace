import { Request, Response } from "express";
import openai from "../infra/openai.client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnalysisRequest {
  judgementText: string;
  query?: string;
  history?: ChatMessage[];
  task?: "facts" | "issues" | "petitioner_args" | "respondent_args" | "law_analysis" | "precedent_analysis" | "court_reasoning" | "conclusion";
}

// ─── Controller ───────────────────────────────────────────────────────────────

export const judgementAnalyserController = async (
  req: Request<{}, {}, AnalysisRequest>,
  res: Response
) => {
  try {
    const { judgementText, query, history = [], task } = req.body;

    if (!judgementText) {
      return res.status(400).json({ error: "judgementText is required" });
    }

    let systemPrompt = "";
    let userPrompt = "";

    if (task) {
      // Task-based analysis (Facts, Issues, etc.)
      systemPrompt = `You are a legal expert analyzer. Your task is to extract and summarize specific parts of a legal judgement. 
Return your response in a clear, professional, and well-structured format. Use paragraphs and bullet points where appropriate.`;
      
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

      userPrompt = `Based on the following judgement text, please provide a detailed summary of the ${taskLabels[task] || task}.

Judgement Text:
${judgementText}`;
    } else if (query) {
      // Chat-based analysis
      systemPrompt = `You are LexAI, a legal assistant helping a lawyer analyze a specific judgement. 
Use the provided judgement text to answer the user's questions accurately. 
If the information is not in the text, state that clearly. 
When referring to specific paragraphs, use the ¶ symbol if available in the text.`;
      
      userPrompt = `Judgement Text:
${judgementText}

User Question:
${query}`;
    } else {
      return res.status(400).json({ error: "Either query or task is required" });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: "user", content: userPrompt }
      ],
      temperature: 0.2,
    });

    const result = response.choices[0].message.content;

    return res.json({ result });

  } catch (error) {
    console.error("❌ Judgement Analyser Error:", error);
    return res.status(500).json({ error: "Analysis failed" });
  }
};
