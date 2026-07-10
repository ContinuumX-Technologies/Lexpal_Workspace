// controllers/JDController.ts

import { Request, Response } from "express";
import { MongoClient, ObjectId } from "mongodb";
import axios from "axios";
import * as cheerio from "cheerio";
import * as zlib from "zlib";
import { getOrCreateChromaCollection } from "../infra/chroma.client";
import { getEmbedding, extractSearchFilters, generateShortTitles } from "../services/AI";
import { searchEnrichmentMetadata } from "../search/enrichmentSearch.service";
import { ENRICHMENT_INDEX, elasticsearchRequest } from "../infra/elasticsearch.client";
import { tokenize, normalizeText } from '../utils/normalizer.util';

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
    yearFrom?: number;
    yearTo?: number;
    status?: string;
    area?: string;
    bench?: string[];
    act_name?: string[];
    section_no?: string[];
}

interface SearchResponseItem {
    judgement_db_id: string;
    short_hand_title: string;
    judgement_type: string;
    year: number;
    citation?: string;
    bench?: string[];
    subject_areas?: string[];
    keywords?: string[];
    match_reasons?: string[];
    search_source?: "elasticsearch" | "chroma" | "mongo" | "elasticsearch_fuzzy";
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

function toShortTitle(title: string): string {
    const withoutDate = title.replace(/\s+on\s+\d{1,2}\s+[A-Za-z]+,?\s+(?:18|19|20)\d{2}\s*$/i, "");
    const normalized = withoutDate
        .replace(/\s+versus\s+/i, " vs ")
        .replace(/\s+v\.?\s+/i, " vs ")
        .replace(/\s+/g, " ")
        .trim();

    if (!normalized) return title || "Untitled Judgment";
    if (normalized.length <= 80) return normalized;
    return `${normalized.slice(0, 77).trim()}...`;
}

function buildEnrichmentFilters(body: SearchRequestBody) {
    const filters: any = {};

    if (body.year) filters.year = body.year;
    if (body.yearFrom) filters.yearFrom = body.yearFrom;
    if (body.yearTo) filters.yearTo = body.yearTo;
    if (body.area) filters.subject_areas = [body.area, `${body.area} Law`];
    if (body.bench?.length) filters.bench = body.bench;
    if (body.act_name?.length) filters.act_name = body.act_name;
    if (body.section_no?.length) filters.section_no = body.section_no;

    return Object.keys(filters).length ? filters : undefined;
}

async function validateCandidatesWithElasticsearch(
    esIds: string[],
    body: SearchRequestBody
): Promise<string[]> {
    const filters = buildEnrichmentFilters(body);
    if (!filters || !esIds.length) {
        return esIds;
    }

    try {
        const filterClauses: any[] = [
            { ids: { values: esIds } }
        ];

        if (filters.year) filterClauses.push({ term: { year: filters.year } });
        if (filters.yearFrom || filters.yearTo) {
            filterClauses.push({
                range: {
                    year: {
                        ...(filters.yearFrom ? { gte: filters.yearFrom } : {}),
                        ...(filters.yearTo ? { lte: filters.yearTo } : {}),
                    }
                }
            });
        }
        if (filters.subject_areas) {
            filterClauses.push({ terms: { "subject_areas.keyword": filters.subject_areas } });
        }
        if (filters.bench) {
            filterClauses.push({ terms: { "bench.keyword": filters.bench } });
        }
        if (filters.act_name) {
            filterClauses.push({
                nested: {
                    path: "cited_laws",
                    query: { terms: { "cited_laws.act_name.keyword": filters.act_name } }
                }
            });
        }
        if (filters.section_no) {
            filterClauses.push({
                nested: {
                    path: "cited_laws",
                    query: { terms: { "cited_laws.section_no": filters.section_no } }
                }
            });
        }

        const response = await elasticsearchRequest<any>(`/${ENRICHMENT_INDEX}/_search`, {
            method: "POST",
            body: {
                _source: false,
                size: esIds.length,
                query: {
                    bool: {
                        filter: filterClauses
                    }
                }
            }
        });

        const hits = response.hits?.hits || [];
        return hits.map((h: any) => h._id).filter(Boolean);
    } catch (err: any) {
        console.warn("Chroma candidate validation via ES failed, returning all:", err.message);
        return esIds;
    }
}

async function searchWithElasticsearch(body: SearchRequestBody, finalQuery: string): Promise<{
    results: SearchResponseItem[];
    hasMore: boolean;
} | null> {
    const excludeIds = body.excludeIds || [];
    const pageSize = body.pageSize || 5;
    const fetchSize = Math.min(pageSize + excludeIds.length + 25, 50);

    try {
        const enrichment = await searchEnrichmentMetadata({
            query: finalQuery,
            page: 1,
            pageSize: fetchSize,
            filters: buildEnrichmentFilters(body),
        });

        const filtered = enrichment.results.filter((hit) => !excludeIds.includes(hit.id));
        const selected = filtered.slice(0, pageSize);

        if (!selected.length) return null;

        return {
            results: selected.map((hit) => ({
                judgement_db_id: hit.id,
                short_hand_title: toShortTitle(hit.source.title),
                judgement_type: "Supreme court",
                year: hit.source.year || 0,
                citation: hit.source.equivalent_citation?.[0],
                bench: hit.source.bench,
                subject_areas: hit.source.subject_areas,
                keywords: hit.source.keywords,
                match_reasons: hit.match_reasons,
                search_source: "elasticsearch",
            })),
            hasMore: filtered.length > pageSize || enrichment.total > fetchSize,
        };
    } catch (error: any) {
        console.warn("Elasticsearch judgment search unavailable, falling back to Chroma:", error.message);
        return null;
    }
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

        if (!finalQuery && query) {
            try {
                const extracted = await extractSearchFilters(query as string);
                finalQuery = extracted.refinedQuery;
                if (extracted.year && !year) req.body.year = extracted.year;
                if (extracted.jurisdiction && !jurisdiction) req.body.jurisdiction = extracted.jurisdiction;
                if (extracted.bench && !req.body.bench) req.body.bench = extracted.bench;
                if (extracted.act_name && !req.body.act_name) req.body.act_name = extracted.act_name;
                if (extracted.section_no && !req.body.section_no) req.body.section_no = extracted.section_no;
            } catch (rewriteErr: any) {
                console.warn("Query extraction failed, using raw query:", rewriteErr.message);
                finalQuery = query as string;
            }
        }

        // Augment query with filters that aren't in metadata yet
        if (area) {
            finalQuery += ` focusing on ${area} law`;
        }
        if (status) {
            finalQuery += ` with ${status} status`;
        }

        const runSearch = async (body: SearchRequestBody) => {
            const esPromise = searchWithElasticsearch(body, finalQuery).catch((err) => {
                console.warn("ES Search failed or unavailable, proceeding with Chroma only.");
                return null;
            });

            const chromaPromise = (async () => {
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
                if (body.jurisdiction) {
                    andFilters.push({ judgement_type: body.jurisdiction });
                }
                if (body.year) {
                    andFilters.push({ year: body.year });
                }
                if (body.yearFrom) {
                    andFilters.push({ year: { $gte: body.yearFrom } });
                }
                if (body.yearTo) {
                    andFilters.push({ year: { $lte: body.yearTo } });
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

                const chromaIds = scoredJudgments.map((sj) => sj.judgmentId);
                const validIds = await validateCandidatesWithElasticsearch(chromaIds, body);
                const filteredScoredJudgments = scoredJudgments.filter((sj) => validIds.includes(sj.judgmentId));

                return filteredScoredJudgments;
            })();

            const [esRes, scoredJudgments] = await Promise.all([esPromise, chromaPromise]);
            return { esRes, scoredJudgments };
        };

        // -------------------------------
        // 2. Fetch Candidates Concurrently
        // -------------------------------
        const primaryBody: SearchRequestBody = { ...req.body };
        const { esRes, scoredJudgments } = await runSearch(primaryBody);

        const hasYearConstraint = Boolean(primaryBody.year || primaryBody.yearFrom || primaryBody.yearTo);
        const noResults = !esRes && scoredJudgments.length === 0;

        const searchOutcome = (hasYearConstraint && noResults)
            ? await runSearch({
                ...primaryBody,
                year: undefined,
                yearFrom: undefined,
                yearTo: undefined,
            })
            : { esRes, scoredJudgments };

        const finalEsRes = searchOutcome.esRes;
        const finalScoredJudgments = searchOutcome.scoredJudgments;

        let elasticsearchResults: SearchResponseItem[] = [];
        let hasMoreEs = false;
        if (finalEsRes) {
            elasticsearchResults = finalEsRes.results;
            hasMoreEs = finalEsRes.hasMore;
        }

        // -------------------------------
        // 7. RRF Fusion (Elasticsearch + Chroma)
        // -------------------------------
        const RRF_K = 60;
        const hybridMap = new Map<string, {
            score: number;
            metadata: Partial<SearchResponseItem>;
        }>();

        // Add Elasticsearch results
        elasticsearchResults.forEach((esHit, idx) => {
            const rank = idx + 1;
            const rrfScore = 1 / (RRF_K + rank);
            hybridMap.set(esHit.judgement_db_id, {
                score: rrfScore,
                metadata: esHit
            });
        });

        // Add Chroma results
        finalScoredJudgments.sort((a, b) => b.score - a.score);
        finalScoredJudgments.forEach((chromaHit, idx) => {
            const rank = idx + 1;
            const rrfScore = 1 / (RRF_K + rank);
            const existing = hybridMap.get(chromaHit.judgmentId);

            if (existing) {
                existing.score += rrfScore;
                existing.metadata.search_source = "chroma"; // or 'hybrid'
                // Ensure match reasons array exists
                existing.metadata.match_reasons = existing.metadata.match_reasons || [];
                if (!existing.metadata.match_reasons.includes("Vector similarity")) {
                    existing.metadata.match_reasons.push("Vector similarity");
                }
            } else {
                hybridMap.set(chromaHit.judgmentId, {
                    score: rrfScore,
                    metadata: {
                        judgement_db_id: chromaHit.judgmentId,
                        short_hand_title: toShortTitle(chromaHit.metadata.title), // We will overwrite this later via generateShortTitles
                        judgement_type: chromaHit.metadata.judgement_type,
                        year: chromaHit.metadata.year,
                        search_source: "chroma",
                        match_reasons: ["Vector similarity"]
                    }
                });
            }
        });

        // Convert map back to array and sort
        const combinedJudgments: Array<{ id: string, score: number, metadata: Partial<SearchResponseItem> }> = [];
        for (const [id, data] of hybridMap.entries()) {
            combinedJudgments.push({ id, score: data.score, metadata: data.metadata });
        }


        // -------------------------------
        // 8. Exact Title Match Boost
        // -------------------------------
        if (query && excludeIds.length === 0) {
            try {
                const fuzzyQueryBody = buildFuzzyTitleQuery(String(query));

                const esResponse = await elasticsearchRequest<any>(`/${ENRICHMENT_INDEX}/_search`, {
                    method: "POST",
                    body: {
                        ...fuzzyQueryBody,
                        size: 5 // Get top 5 matches instead of 1
                    }
                });

                const hits = esResponse.hits?.hits || [];

                // Loop through the top hits and push them to the top of the combined results
                hits.forEach((exactDoc: any, hitIndex: number) => {
                    const jId = exactDoc._source.source_docId || exactDoc._source.meta?.judgement_db_id || exactDoc._id;

                    if (jId) {
                        const existingIdx = combinedJudgments.findIndex(j => j.id === jId);
                        if (existingIdx !== -1) {
                            combinedJudgments.splice(existingIdx, 1);
                        }

                        combinedJudgments.push({
                            id: jId,
                            score: 9999 - hitIndex, // Guarantee top placement, preserving ES rank order
                            metadata: {
                                judgement_db_id: jId,
                                short_hand_title: toShortTitle(exactDoc._source.title),
                                judgement_type: jurisdiction || "Supreme court",
                                year: exactDoc._source.year || 2024,
                                search_source: "elasticsearch_fuzzy",
                                match_reasons: ["Fuzzy Title Match Boost"]
                            }
                        });
                    }
                });
            } catch (err) {
                console.error("Fuzzy title match boost failed:", err);
            }
        }

        combinedJudgments.sort((a, b) => b.score - a.score);

        const selected = combinedJudgments.slice(0, pageSize);

        // -------------------------------
        // 9. Generate shorthand titles
        // -------------------------------
        const titles: string[] = selected.map(
            (j) => j.metadata.short_hand_title || "Untitled Judgment"
        );

        const shortTitles: string[] = await generateShortTitles(
            titles
        );

        // -------------------------------
        // 10. Format response
        // -------------------------------
        const response: SearchResponseItem[] = selected.map(
            (j, idx) => ({
                ...(j.metadata as SearchResponseItem),
                short_hand_title: shortTitles[idx],
            })
        );

        res.json({
            results: response,
            reframedQuery: finalQuery,
            hasMore: combinedJudgments.length > pageSize || hasMoreEs,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Search failed" });
    }
};

function buildFuzzyTitleQuery(rawQuery: string) {
    const normTokens = tokenize(rawQuery);
    return {
        query: {
            bool: {
                should: [
                    {
                        term: {
                            "title.keyword": {
                                value: rawQuery,
                                boost: 50,
                            },
                        },
                    },
                    {
                        match_phrase: {
                            title: {
                                query: rawQuery,
                                boost: 25,
                                slop: 2,
                            },
                        },
                    },
                    {
                        multi_match: {
                            query: rawQuery,
                            fields: [
                                "title^12",
                                "title.autocomplete^8",
                                "petitioner^6",
                                "respondent^6",
                                "normalized_title^8",
                                "reversed_title^6",
                                "parties_text^4",
                                "equivalent_citation^6",
                                "keywords^4",
                                "subject_areas^3",
                            ],
                            type: "best_fields",
                            fuzziness: "AUTO",
                            prefix_length: 2,
                        }
                    },
                    ...(normTokens.length > 0 ? [{
                        terms: {
                            keywords: normTokens,
                            boost: 1.5,
                        }
                    }] : [])
                ],
                minimum_should_match: 1,
            }
        },
        _source: ["source_docId", "title", "year", "bench", "keywords", "equivalent_citation", "subject_areas", "meta"]
    };
}

export const getJudgementById = async (req: Request, res: Response): Promise<void> => {
    const url = process.env.MONGO_CONNECTION_URL;
    if (!url) {
        res.status(500).json({ error: "DB connection not configured" });
        return;
    }

    const client = new MongoClient(url);
    try {
        const id = req.params.id;
        let query: any = {};
        if (ObjectId.isValid(id)) {
            query = { _id: new ObjectId(id) };
        } else {
            query = { "source.docId": id };
        }

        await client.connect();
        const db = client.db("Lexpal_Workspace");
        const collection = db.collection("supreme_court_judgements");

        let doc = await collection.findOne(query);
        if (!doc) {
            if (!ObjectId.isValid(id)) {
                console.log(`[ON-DEMAND SCRAPE] Fetching and inserting docId: ${id}`);
                const scraped = await scrapeAndInsertOnDemand(id, collection);
                if (scraped) {
                    doc = scraped;
                }
            }
        }

        if (!doc) {
            res.status(404).json({ error: "Judgment not found" });
            return;
        }

        // Check if there is an inlined HTML file for this judgment
        const fs = await import("fs");
        const path = await import("path");
        const docId = doc.source?.docId;
        let htmlContent = (doc as any).htmlContent || null;
        let htmlSource = htmlContent ? "mongodb" : null;
        if (htmlContent) {
            if (Buffer.isBuffer(htmlContent)) {
                try {
                    htmlContent = zlib.gunzipSync(htmlContent).toString("utf8");
                } catch (zlibErr: any) {
                    console.error("Failed to decompress htmlContent:", zlibErr.message);
                    htmlContent = htmlContent.toString("utf8");
                }
            } else if (typeof htmlContent === "object" && (htmlContent as any).buffer) {
                try {
                    htmlContent = zlib.gunzipSync((htmlContent as any).buffer).toString("utf8");
                } catch (zlibErr: any) {
                    console.error("Failed to decompress htmlContent from binary object:", zlibErr.message);
                    htmlContent = htmlContent.toString("utf8");
                }
            }
        }
        if (!htmlContent && docId) {
            const htmlFilePath = path.join("/Users/saratbehera/Lexpal_Workspace/judgement_scraper-main/judgements/html", `${docId}.html`);
            if (fs.existsSync(htmlFilePath)) {
                htmlContent = fs.readFileSync(htmlFilePath, "utf8");
                htmlSource = "local_disk";
            }
        }

        res.json({
            ...doc,
            htmlContent,
            htmlSource: htmlSource || (htmlContent ? "mongodb" : "fallback_text")
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch judgment details" });
    } finally {
        await client.close();
    }
};

async function scrapeAndInsertOnDemand(docId: string, collection: any): Promise<any> {
    try {
        const BASE_URL = 'https://indiankanoon.org';
        const targetUrl = `${BASE_URL}/doc/${docId}/`;
        console.log(`[ON-DEMAND SCRAPE] Fetching: ${targetUrl}...`);
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
            },
            timeout: 30000
        });

        const html = response.data;
        const $ = cheerio.load(html);

        // 1. Remove comments
        $('*').contents().filter((_, el) => el.type === 'comment').remove();

        // 2. Remove page boundaries (.hidden_text spans)
        $('.hidden_text').remove();

        // 3. Remove all scripts EXCEPT the custom iframe listener
        $('script').each((_, el) => {
            const id = $(el).attr('id');
            if (id !== 'custom-iframe-listener') {
                $(el).remove();
            }
        });

        // 4. Remove unnecessary stylesheet links (keep only search_desktop style sheet)
        $('link[rel="stylesheet"], link[type="text/css"]').each((_, el) => {
            const href = $(el).attr('href') || '';
            if (!href.includes('search_desktop')) {
                $(el).remove();
            }
        });

        // Extract Title
        const title = $('h2.doc_title').text().trim() || 'Untitled Judgement';

        // Extract Bench
        let bench: string[] = [];
        const benchText = $('.doc_bench').text().trim();
        if (benchText) {
            const cleanedBench = benchText.replace(/Bench:/i, '').trim();
            bench = cleanedBench.split(',').map(b => b.trim()).filter(Boolean);
        }

        // Extract texts
        const texts: { type: string, content: string }[] = [];
        const judgmentsDiv = $('.judgments');
        if (judgmentsDiv.length > 0) {
            judgmentsDiv.find('p, div[id^="p_"]').each((_, el) => {
                const text = $(el).text().trim();
                if (text) {
                    const type = $(el).attr('data-structure') || 'text';
                    texts.push({ type, content: text });
                }
            });
        }

        if (texts.length === 0) {
            $('p').each((_, el) => {
                const text = $(el).text().trim();
                if (text) {
                    texts.push({ type: 'text', content: text });
                }
            });
        }

        // Resolve relative stylesheets to absolute Indian Kanoon URLs (no longer inlining CSS)
        $('link[rel="stylesheet"], link[type="text/css"]').each((_, element) => {
            const href = $(element).attr('href');
            if (href) {
                const absoluteUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
                $(element).attr('href', absoluteUrl);
            }
        });

        // Resolve images
        $('img').each((_, element) => {
            const src = $(element).attr('src');
            if (src && !src.startsWith('http') && !src.startsWith('data:')) {
                $(element).attr('src', src.startsWith('/') ? `${BASE_URL}${src}` : `${BASE_URL}/${src}`);
            }
        });

        // Disable external links / redirects, identify citation links
        $('a').each((_, element) => {
            const href = $(element).attr('href');
            if (href) {
                if (href.startsWith('#')) {
                    return; // Keep internal jumps
                }
                const match = href.match(/\/doc\/(\d+)/);
                if (match) {
                    const linkedDocId = match[1];
                    $(element).attr('href', 'javascript:void(0)');
                    $(element).attr('data-doc-id', linkedDocId);
                    $(element).addClass('citation-link');
                } else {
                    $(element).attr('href', 'javascript:void(0)');
                }
                $(element).removeAttr('target');
            }
        });

        // Convert equivalent citations into styled chips
        $('.doc_citations').each((_, element) => {
            const docCitationsEl = $(element);
            const text = docCitationsEl.text().trim();
            let citationsStr = text;
            let prefix = 'Equivalent citations:';
            if (text.toLowerCase().startsWith('equivalent citations:')) {
                citationsStr = text.substring('equivalent citations:'.length).trim();
            } else if (text.toLowerCase().startsWith('citations:')) {
                citationsStr = text.substring('citations:'.length).trim();
                prefix = 'Citations:';
            }

            const citationsList = citationsStr.split(',').map(c => c.trim()).filter(Boolean);
            if (citationsList.length > 0) {
                const chipsHtml = citationsList.map(c => `<span class="citation-chip">${c}</span>`).join('\n');
                const newLayout = `
<div class="citations-container">
  <span class="citations-label">${prefix}</span>
  <div class="citations-list">
    ${chipsHtml}
  </div>
</div>
                `;
                docCitationsEl.replaceWith(newLayout);
            }
        });

        // Remove navigation, sidebars, ads, covers, docsource_main, and doc_title
        $('header').remove();
        $('.main-header').remove();
        $('.skip-link').remove();
        $('.ad_doc').remove();
        $('.premium-banner').remove();
        $('.docoptions').remove();
        $('.button-form').remove();
        $('.left_column').remove();
        $('#structuralanal').remove();
        $('#citetextdash').remove();
        $('.right_column').remove();
        $('.mini-chatbot').remove();
        $('#chatbot-container').remove();
        $('.covers, #covers').remove();
        $('.docsource_main, #docsource_main').remove();
        $('.doc_title, #doc_title').remove();

        $('footer').remove();
        $('.homepage-footer').remove();
        $('.api-footer').remove();

        // Style the body layout
        $('style[id="custom-body-style"]').remove();
        $('head').append(`
<style id="custom-body-style">
  body {
    max-width: 800px;
    margin: 40px auto;
    padding: 0 20px;
    font-family: 'Outfit', sans-serif;
    background-color: #fff;
    color: #333;
  }
  .middle_column {
    float: none !important;
    width: 100% !important;
  }
  a, a:visited {
    color: #fbbf24 !important;
  }
  .citations-container {
    margin: 20px 0;
    font-family: 'Outfit', sans-serif;
  }
  .citations-label {
    display: block;
    font-size: 11px;
    font-weight: bold;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
  }
  .citations-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .citation-chip {
    display: inline-flex;
    align-items: center;
    font-size: 10px;
    font-weight: bold;
    color: #111827;
    background: linear-gradient(180deg, #ffffff 0%, #f9fafb 100%);
    border: 1px solid #e5e7eb;
    box-shadow: inset 0 1px 0 white, 0 1px 2px rgba(0, 0, 0, 0.05);
    border-radius: 9999px;
    padding: 4px 12px;
    text-transform: uppercase;
    letter-spacing: -0.01em;
    transition: opacity 0.2s;
  }
  .citation-chip:hover {
    opacity: 0.7;
    cursor: pointer;
  }
</style>
        `);

        // Injected click event listener inside iframe
        $('script[id="custom-iframe-listener"]').remove();
        $('head').append(`
<script id="custom-iframe-listener">
  document.addEventListener('click', (e) => {
    const target = e.target.closest('a.citation-link');
    if (target) {
      const docId = target.getAttribute('data-doc-id');
      if (docId) {
        window.parent.postMessage({ type: 'LOAD_JUDGEMENT_BY_DOC_ID', docId }, '*');
      }
    }
  });
</script>
        `);

        // Map data-structure attributes to user-friendly titles and propagate to siblings
        const dsToTitleMap: Record<string, string> = {
            'facts': 'Fact',
            'issue': 'Issue',
            'petarg': "Petitioner's Argument",
            'resparg': "Respondent's Argument",
            'section': 'Analysis of the law',
            'precedent': 'Precedent Analysis',
            'cdiscource': "Court's Reasoning",
            'conclusion': 'Conclusion'
        };

        let currentTitle = '';
        const container = $('.judgments').length > 0 ? $('.judgments') : $('body');
        container.children().each((_, el) => {
            const element = $(el);
            const dsAttr = element.attr('data-structure');
            if (dsAttr) {
                const normalizedDs = dsAttr.toLowerCase().trim();
                if (dsToTitleMap[normalizedDs]) {
                    currentTitle = dsToTitleMap[normalizedDs];
                }
            }
            if (currentTitle) {
                element.attr('title', currentTitle);
            }
        });

        // Clean and compress all text nodes directly
        $('*').contents().each((_, el) => {
            if (el.type === 'text') {
                let text = el.data || '';
                // Compress multiple spaces
                text = text.replace(/ {2,}/g, ' ');
                // Compress multiple newlines
                text = text.replace(/\n+/g, '\n');
                el.data = text;
            }
        });

        let minifiedHtml = $.html();
        minifiedHtml = minifiedHtml.replace(/\s+/g, ' ').replace(/> </g, '><').trim();

        const compressedHtml = zlib.gzipSync(Buffer.from(minifiedHtml, 'utf8'));

        const newDoc = {
            title,
            source: {
                url: targetUrl,
                docId,
                page: 1
            },
            bench,
            texts,
            htmlContent: compressedHtml,
            createdAt: new Date()
        };

        const titleLower = title.toLowerCase();
        const isJudgement = titleLower.includes("vs.") || titleLower.includes(" vs ") || titleLower.includes(" vs.") || titleLower.includes(" versus ");

        let docIdOrInsertedId: string;

        if (isJudgement) {
            const insertResult = await collection.insertOne(newDoc);
            console.log(`[ON-DEMAND SCRAPE SUCCESS] Inserted docId: ${docId} with MongoDB _id: ${insertResult.insertedId} (gzipped)`);
            docIdOrInsertedId = insertResult.insertedId.toString();
        } else {
            console.log(`[ON-DEMAND SCRAPE BYPASS-DB] Title "${title}" does not contain "vs.". Bypassing MongoDB storage.`);
            docIdOrInsertedId = docId; // Return original docId instead of a random ObjectId so subsequent fetches can request it and scrape on-demand
        }

        return {
            _id: docIdOrInsertedId,
            ...newDoc,
            htmlContent: minifiedHtml,
            htmlSource: "on_demand_scraped"
        };
    } catch (err: any) {
        console.error(`[ON-DEMAND SCRAPE ERROR] Failed to dynamically scrape docId: ${docId}:`, err.message);
        return null;
    }
}
