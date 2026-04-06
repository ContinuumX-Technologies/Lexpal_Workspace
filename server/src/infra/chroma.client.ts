import { CloudClient, ChromaClient } from "chromadb";
import  openaiClient from "./openai.client";


const DATABASE = "Lexpal";

// Use CloudClient if CHROMA_API_KEY is provided, otherwise fallback to local ChromaClient
const chroma = process.env.CHROMA_API_KEY 
  ? new CloudClient({
      apiKey: process.env.CHROMA_API_KEY,
      tenant: process.env.CHROMA_TENANT,
      database: DATABASE
    })
  : new ChromaClient({
      path: process.env.CHROMA_URL || "http://localhost:8000"
    });
/**
 * OpenAI embedding function (manual, explicit)
 */
const embeddingFunction = {
  generate: async (texts:string[]) => {
    const response = await openaiClient.embeddings.create({
      model: "text-embedding-3-small",
      input: texts,
    });

    return response.data.map(d => d.embedding);
  },
};

/**
 * Get or create the Chroma collection
 */
export async function getOrCreateChromaCollection(collection_name:string) {
  try {
    return await chroma.getCollection({
      name: collection_name,
      embeddingFunction,
    });
  } catch {
    return await chroma.createCollection({
      name: collection_name,
      embeddingFunction,
    });
  }
}