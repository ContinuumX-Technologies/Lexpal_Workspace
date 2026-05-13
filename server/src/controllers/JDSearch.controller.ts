// controllers/searchController.ts

import { Request, Response } from "express";
import { getOrCreateChromaCollection } from "../infra/chroma.client";
import { getEmbedding, rewriteQuery, generateShortTitles } from "../services/AI";

const COLLECTION_NAME = "judgements";

// -------------------------------
// Types
// -------------------------------

type SectionType = "reasoning" | "holding" | "facts" | string;

type CourtType = "Supreme court" | "High court" | string;

interface SafeQueryResult {
    ids: string[][];
    documents: string[][];
    metadatas: ChunkMetadata[][];
    distances: number[][];
}

interface ChunkMetadata {
    judgement_type: CourtType;
    judgement_db_id: string;
    title: string;
    year: number;
    section_type: SectionType;
    chunk_index: number;
    total_chunks_in_section: number;
    prev_chunk_id: string | null;
    next_chunk_id: string | null;
}

interface RetrievedChunk {
    id: string;
    text: string;
    metadata: ChunkMetadata;
    distance: number;
}

interface ProcessedChunk extends RetrievedChunk {
    weightedScore: number;
}

interface ScoredJudgment {
    judgmentId: string;
    score: number;
    metadata: ChunkMetadata;
}

interface SearchRequestBody {
    query?: string;
    reframedQuery?: string;
    excludeIds?: string[];
    pageSize?: number;
    jurisdiction?: string;
    year?: number;
    status?: string;
    area?: string;
}

interface SearchResponseItem {
    judgement_db_id: string;
    short_hand_title: string;
    judgement_type: string;
    year: number;
}

interface SearchResponse {
    results: SearchResponseItem[];
    reframedQuery: string;
    hasMore: boolean;
}

// -------------------------------
// Weights
// -------------------------------

const WEIGHTS = {
    similarity: 1.0,
    section: {
        reasoning: 1.3,
        holding: 1.5,
        facts: 0.7,
        default: 1.0,
    },
    court: {
        "Supreme court": 1.5,
        "High court": 1.2,
        default: 1.0,
    },
} as const;

// -------------------------------
// Helpers
// -------------------------------
function isChunkMetadata(obj: any): obj is ChunkMetadata {
    return (
        obj &&
        typeof obj === "object" &&
        typeof obj.judgement_db_id === "string" &&
        typeof obj.title === "string" &&
        typeof obj.year === "number" &&
        typeof obj.judgement_type === "string"
    );
}


function getSectionWeight(section: SectionType): number {
    return (
        WEIGHTS.section[section as keyof typeof WEIGHTS.section] ??
        WEIGHTS.section.default
    );
}

function getCourtWeight(court: CourtType): number {
    return (
        WEIGHTS.court[court as keyof typeof WEIGHTS.court] ??
        WEIGHTS.court.default
    );
}

// -------------------------------
// Controller
// -------------------------------

export const searchJudgements = async (
    req: Request<{}, {}, SearchRequestBody>,
    res: Response<SearchResponse | { error: string }>
): Promise<void> => {
    try {
        const {
            query,
            reframedQuery,
            excludeIds = [],
            pageSize = 5,
            jurisdiction,
            year,
            status,
            area
        } = req.body;

        if (!query && !reframedQuery) {
            res.status(400).json({ error: "Query is required" });
            return;
        }

        // -------------------------------
        // 1. Query Reconstruction
        // -------------------------------
        let finalQuery: string = reframedQuery ?? "";

        if (!finalQuery) {
            finalQuery = await rewriteQuery(query as string);
        }

        // Augment query with filters that aren't in metadata yet
        if (area) {
            finalQuery += ` focusing on ${area} law`;
        }
        if (status) {
            finalQuery += ` with ${status} status`;
        }

        const queries: string[] = [
            query ?? finalQuery,
            finalQuery,
        ];

        const embeddings: number[][] = await Promise.all(
            queries.map((q) => getEmbedding(q))
        );

        // -------------------------------
        // 2. Dynamic chunk fetch size
        // -------------------------------
        const BASE_FETCH = 120;
        const CHUNK_FETCH_LIMIT = BASE_FETCH; // Fixed size because Chroma filters natively

        const chromaCollection = await getOrCreateChromaCollection(COLLECTION_NAME);

        let whereClause: any = undefined;
        const andFilters: any[] = [];

        if (excludeIds.length > 0) {
            andFilters.push({ judgement_db_id: { $nin: excludeIds } });
        }
        if (jurisdiction) {
            // Mapping frontend "Supreme Court" to backend "Supreme court" if needed
            andFilters.push({ judgement_type: jurisdiction });
        }
        if (year) {
            andFilters.push({ year: year });
        }

        if (andFilters.length > 0) {
            whereClause = andFilters.length === 1 ? andFilters[0] : { $and: andFilters };
        }

        const raw = await chromaCollection.query({
            queryEmbeddings: embeddings,
            nResults: CHUNK_FETCH_LIMIT,
            where: whereClause
        });

        // -------------------------------
        // Normalize Chroma response safely
        // -------------------------------
        const ids = raw.ids ?? [];
        const documents = raw.documents ?? [];
        const metadatas = raw.metadatas ?? [];
        const distances = raw.distances ?? [];

        // -------------------------------
        // 3. Flatten results
        // -------------------------------
        const chunks: RetrievedChunk[] = [];

        for (let i = 0; i < ids.length; i++) {
            const idArr = ids[i] ?? [];
            const docArr = documents[i] ?? [];
            const metaArr = metadatas[i] ?? [];
            const distArr = distances[i] ?? [];

            for (let j = 0; j < idArr.length; j++) {
                const id = idArr[j];
                const text = docArr[j];
                const metadata = metaArr[j];
                const distance = distArr[j];

                if (
                    !id ||
                    !text ||
                    !metadata ||
                    typeof distance !== "number" ||
                    !isChunkMetadata(metadata)
                ) {
                    continue;
                }

                chunks.push({
                    id,
                    text,
                    metadata: metadata as ChunkMetadata,
                    distance,
                });
            }
        }

        // -------------------------------
        // 4. Score chunks
        // -------------------------------
        const processedChunks: ProcessedChunk[] = chunks.map((c) => {
            const similarity = 1 - c.distance;

            const sectionWeight = getSectionWeight(
                c.metadata.section_type
            );
            const courtWeight = getCourtWeight(
                c.metadata.judgement_type
            );

            const weightedScore =
                similarity *
                WEIGHTS.similarity *
                sectionWeight *
                courtWeight;

            return {
                ...c,
                weightedScore,
            };
        });

        // -------------------------------
        // 5. Group by judgment_id
        // -------------------------------
        const judgmentMap = new Map<string, ProcessedChunk[]>();

        for (const chunk of processedChunks) {
            const jId = chunk.metadata.judgement_db_id;

            if (excludeIds.includes(jId)) continue;

            if (!judgmentMap.has(jId)) {
                judgmentMap.set(jId, []);
            }

            judgmentMap.get(jId)!.push(chunk);
        }

        // -------------------------------
        // 6. Score judgments
        // -------------------------------
        const scoredJudgments: ScoredJudgment[] = [];

        for (const [jId, chunkList] of judgmentMap.entries()) {
            chunkList.sort((a, b) => b.weightedScore - a.weightedScore);

            const topChunks = chunkList.slice(0, 3);

            const score = topChunks.reduce(
                (sum, c) => sum + c.weightedScore,
                0
            );

            scoredJudgments.push({
                judgmentId: jId,
                score,
                metadata: topChunks[0].metadata,
            });
        }

        // -------------------------------
        // 6.5 Exact Title Match Boost
        // -------------------------------
        if (query && excludeIds.length === 0) {
            try {
                const qStr = String(query).toLowerCase();
                const isTitleSearch = qStr.includes(" vs ") || qStr.includes(" v. ") || qStr.includes(" v ");
                
                if (isTitleSearch) {
                    const { MongoClient } = await import("mongodb");
                    const url = process.env.MONGO_CONNECTION_URL;
                    if (url) {
                        const client = new MongoClient(url);
                        await client.connect();
                        const db = client.db("Lexpal_Workspace");
                        const collection = db.collection("supreme_court_judgements");
                        
                        const mongoQuery: any = { $text: { $search: String(query) } };
                        if (year) mongoQuery.year = year;
                        if (jurisdiction) mongoQuery.judgement_type = jurisdiction;

                        const exactDocs = await collection.find(
                            mongoQuery,
                            { projection: { score: { $meta: "textScore" }, title: 1, year: 1 } }
                        ).sort({ score: { $meta: "textScore" } }).limit(1).toArray();
                        
                        if (exactDocs.length > 0) {
                            const exactDoc = exactDocs[0] as any;
                            if (exactDoc.score > 1.0) {
                                const jId = exactDoc._id.toString();
                                const existingIdx = scoredJudgments.findIndex(j => j.judgmentId === jId);
                                if (existingIdx !== -1) {
                                    scoredJudgments.splice(existingIdx, 1);
                                }
                                scoredJudgments.push({
                                    judgmentId: jId,
                                    score: 9999, // Guarantee top placement
                                    metadata: {
                                        judgement_type: "Supreme court",
                                        judgement_db_id: jId,
                                        title: exactDoc.title,
                                        year: exactDoc.year || 2024,
                                        section_type: "default",
                                        chunk_index: 0,
                                        total_chunks_in_section: 1,
                                        prev_chunk_id: null,
                                        next_chunk_id: null
                                    }
                                });
                            }
                        }
                        await client.close();
                    }
                }
            } catch (err) {
                console.error("Exact match boost failed:", err);
            }
        }

        scoredJudgments.sort((a, b) => b.score - a.score);

        const selected = scoredJudgments.slice(0, pageSize);

        // -------------------------------
        // 7. Generate shorthand titles
        // -------------------------------
        const titles: string[] = selected.map(
            (j) => j.metadata.title
        );

        const shortTitles: string[] = await generateShortTitles(
            titles
        );

        // -------------------------------
        // 8. Format response
        // -------------------------------
        const response: SearchResponseItem[] = selected.map(
            (j, idx) => ({
                judgement_db_id: j.judgmentId,
                short_hand_title: shortTitles[idx],
                judgement_type: j.metadata.judgement_type,
                year: j.metadata.year,
            })
        );

        res.json({
            results: response,
            reframedQuery: finalQuery,
            hasMore: scoredJudgments.length > pageSize,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Search failed" });
    }
};

export const getJudgementById = async (req: Request, res: Response): Promise<void> => {
    const { MongoClient, ObjectId } = await import("mongodb");
    const url = process.env.MONGO_CONNECTION_URL;
    if (!url) {
        res.status(500).json({ error: "DB connection not configured" });
        return;
    }
    
    const client = new MongoClient(url);
    try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
            res.status(400).json({ error: "Invalid judgment ID" });
            return;
        }

        await client.connect();
        const db = client.db("Lexpal_Workspace");
        const collection = db.collection("supreme_court_judgements");
        
        const doc = await collection.findOne({ _id: new ObjectId(id) });
        if (!doc) {
            res.status(404).json({ error: "Judgment not found" });
            return;
        }

        res.json(doc);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch judgment details" });
    } finally {
        await client.close();
    }
};