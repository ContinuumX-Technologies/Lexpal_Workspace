import dotenv from "dotenv";
dotenv.config();
import { MongoClient, ObjectId } from "mongodb";
import openaiClient from "../infra/openai.client";

const url = process.env.MONGO_CONNECTION_URL;
if (!url) {
    console.error("Please set MONGO_CONNECTION_URL in .env");
    process.exit(1);
}

const dbName = "Lexpal_Workspace";
const collectionName = "supreme_court_judgements";

const SYSTEM_PROMPT = `You are a legal assistant tasked with extracting key information from a Supreme Court judgment.
The user will provide you with a list of text segments from the judgment. Each segment has a specific 'type' (like Fact, Issue, Precedent Analysis, Conclusion, etc.) and 'content'. 
You MUST carefully read and consider the 'type' and 'content' of EVERY single object in the texts array.
Analyze all these text segments collectively and generate an exhaustive, highly detailed report. DO NOT provide brief summaries; provide full, comprehensive details for each of the following 8 sections.
CRITICAL FORMATTING INSTRUCTION: For fields that naturally contain lists or multiple points (especially "issuesConsidered" and "keyHoldings"), you MUST separate each distinct point with a newline character (\n). Do NOT write them as a single continuous paragraph with inline numbering like (1), (2).
Please output the report STRICTLY as a JSON object where the keys are the 8 section names below, and the values are STRICTLY Markdown-formatted strings (do NOT use nested arrays or objects for the values):
- "caseOverview"
- "finalDecision"
- "judgmentOutcome"
- "issuesConsidered"
- "keyHoldings"
- "statutesDomains"
- "significance"
- "bench"`;

async function summarizeJudgments() {
    const client = new MongoClient(url as string);

    try {
        await client.connect();
        console.log("Connected successfully to server");
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        const targetId = process.argv[2];
        let query: any = {};
        
        if (targetId) {
            if (ObjectId.isValid(targetId)) {
                query = { _id: new ObjectId(targetId) };
                console.log(`Running for specific document ID: ${targetId}`);
            } else {
                console.error("Invalid ObjectId provided as argument.");
                process.exit(1);
            }
        } else {
            console.log("No specific ID provided, running for 1 document by default.");
        }

        const docs = await collection.find(query).limit(1).toArray();
        
        console.log(`Found ${docs.length} documents to process.`);

        for (const doc of docs) {
            console.log(`Processing document ID: ${doc._id}`);
            
            if (!doc.texts || !Array.isArray(doc.texts)) {
                console.log("No 'texts' array found in document, skipping.");
                continue;
            }

            console.log("--- Extracted 'texts' field for document ---");
            console.log(JSON.stringify(doc.texts, null, 2));
            console.log("--------------------------------------------");

            // Construct user prompt by passing texts one by one in the content
            const textContent = doc.texts.map((t: any, index: number) => 
                `Text ${index + 1} (${t.type}):\n${t.content}`
            ).join('\n\n');

            const response = await openaiClient.chat.completions.create({
                model: "gpt-4o-mini", // Changed to a much cheaper model to reduce costs
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: `Here are the texts from the judgment:\n\n${textContent}` }
                ],
                temperature: 0.2
            });

            const usage = response.usage;
            if (usage) {
                // Approximate pricing for gpt-4o-mini: $0.150 per 1M input tokens, $0.600 per 1M output tokens
                const costUsd = (usage.prompt_tokens * 0.150 / 1000000) + (usage.completion_tokens * 0.600 / 1000000);
                const costInr = costUsd * 83.5; // Approximate exchange rate
                console.log("--- Token Usage & Cost ---");
                console.log(`Total Tokens: ${usage.total_tokens} (Prompt: ${usage.prompt_tokens}, Completion: ${usage.completion_tokens})`);
                console.log(`Total Cost: $${costUsd.toFixed(4)} (approx ₹${costInr.toFixed(2)})`);
                console.log("--------------------------");
            }

            const summaryText = response.choices[0]?.message?.content;
            if (summaryText) {
                console.log(`Summary generated for ID: ${doc._id}`);
                try {
                    const summaryJson = JSON.parse(summaryText);
                    // Save back to DB
                    await collection.updateOne(
                        { _id: new ObjectId(doc._id) },
                        { $set: { summary: summaryJson } }
                    );
                    console.log(`Successfully updated document ID: ${doc._id}`);
                } catch (e) {
                    console.error("Failed to parse JSON summary:", e);
                }
            } else {
                console.error("Failed to generate summary");
            }
        }
    } catch (err) {
        console.error("Error processing judgments:", err);
    } finally {
        await client.close();
    }
}

summarizeJudgments();
