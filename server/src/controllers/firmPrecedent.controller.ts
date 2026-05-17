import { Request, Response } from "express";
import { MongoClient, ObjectId } from "mongodb";
import { getOrCreateChromaCollection } from "../infra/chroma.client";
import { getEmbedding } from "../services/AI";
import mammoth from "mammoth";

const COLLECTION_NAME_PREFIX = "firm_precedents_";

/**
 * Upload and index a firm's private precedent
 */
export const uploadFirmPrecedent = async (req: Request, res: Response) => {
  try {
    const file = req.file;
    const { firmId = "default_firm", title, year = new Date().getFullYear() } = req.body;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // 1. Extract text from DOCX
    const { value: text } = await mammoth.extractRawText({ buffer: file.buffer });
    
    // 2. Save metadata to MongoDB
    const mongoUrl = process.env.MONGO_CONNECTION_URL;
    if (!mongoUrl) throw new Error("MONGO_CONNECTION_URL not set");
    
    const client = new MongoClient(mongoUrl);
    await client.connect();
    const db = client.db("Lexpal_Workspace");
    const collection = db.collection("firm_precedents");
    
    const doc = {
      firmId,
      title: title || file.originalname.replace(".docx", ""),
      year: Number(year),
      content: text,
      createdAt: new Date().toISOString()
    };
    
    const result = await collection.insertOne(doc);
    const dbId = result.insertedId.toString();

    // 3. Chunk and Index in ChromaDB
    const chunks = chunkText(text, 1000); // Simple chunking
    const collectionName = `${COLLECTION_NAME_PREFIX}${firmId}`;
    const chromaCollection = await getOrCreateChromaCollection(collectionName);
    
    const embeddings = await Promise.all(chunks.map(q => getEmbedding(q)));
    
    await chromaCollection.add({
      ids: chunks.map((_, i) => `${dbId}_${i}`),
      embeddings: embeddings,
      metadatas: chunks.map((_, i) => ({
        judgement_db_id: dbId,
        title: doc.title,
        year: doc.year,
        chunk_index: i,
        firmId
      })),
      documents: chunks
    });

    await client.close();
    res.json({ success: true, id: dbId, title: doc.title });
  } catch (err) {
    console.error("Firm upload failed:", err);
    res.status(500).json({ error: "Failed to process firm precedent" });
  }
};

/**
 * Search firm's private precedents
 */
export const searchFirmPrecedents = async (req: Request, res: Response) => {
  try {
    const { query, firmId = "default_firm", pageSize = 5 } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }

    const embedding = await getEmbedding(query);
    const collectionName = `${COLLECTION_NAME_PREFIX}${firmId}`;
    const chromaCollection = await getOrCreateChromaCollection(collectionName);
    
    const results = await chromaCollection.query({
      queryEmbeddings: [embedding],
      nResults: 20 // Fetch more to group
    });

    // Group by document ID
    const docsMap = new Map<string, any>();
    const metadatas = results.metadatas[0] || [];
    const distances = results.distances[0] || [];

    for (let i = 0; i < metadatas.length; i++) {
      const meta = metadatas[i] as any;
      const dist = distances[i] as number;
      const id = meta.judgement_db_id;
      
      if (!docsMap.has(id)) {
        docsMap.set(id, {
          judgement_db_id: id,
          short_hand_title: meta.title,
          year: meta.year,
          score: 1 - dist
        });
      } else {
        // Keep the best score
        const existing = docsMap.get(id);
        existing.score = Math.max(existing.score, 1 - dist);
      }
    }

    const finalResults = Array.from(docsMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, pageSize);

    res.json({ results: finalResults });
  } catch (err) {
    console.error("Firm search failed:", err);
    res.status(500).json({ error: "Search failed" });
  }
};

// Simple chunking helper
function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}
