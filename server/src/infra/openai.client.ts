import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.OPENAI_API_KEY) {
    throw new Error("[infra] OPENAI_API_KEY is not set in environment variables");
}

const openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export default openaiClient;
