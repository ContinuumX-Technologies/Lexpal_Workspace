// server/src/search/enrichmentIndex.service.ts

import {
  ENRICHMENT_INDEX,
  elasticsearchNdjsonRequest,
  elasticsearchRequest,
  indexExists,
} from "../infra/elasticsearch.client";

export interface EnrichmentDocument {
  source_docId: string;
  title: string;
  normalized_title?: string;
  petitioner?: string;
  respondent?: string;
  reversed_title?: string;
  parties_text?: string;
  year: number | null;
  bench: string[];
  keywords: string[];
  equivalent_citation: string[];
  subject_areas: string[];
  cited_judgements: Array<{
    docId: string;
    title: string;
  }>;
  cited_laws: Array<{
    section_no: string;
    act_name: string;
    act_year: number | null;
    citation_text: string;
  }>;
}

export interface IndexedEnrichmentDocument extends EnrichmentDocument {
  esId: string;
}

export function normalizeEnrichmentDocument(doc: any): IndexedEnrichmentDocument {
  return {
    esId: String(doc._id),
    source_docId: String(doc.source_docId || ""),
    title: String(doc.title || ""),
    normalized_title: doc.normalized_title ? String(doc.normalized_title) : undefined,
    petitioner: doc.petitioner ? String(doc.petitioner) : undefined,
    respondent: doc.respondent ? String(doc.respondent) : undefined,
    reversed_title: doc.reversed_title ? String(doc.reversed_title) : undefined,
    parties_text: doc.parties_text ? String(doc.parties_text) : undefined,
    year: typeof doc.year === "number" ? doc.year : null,
    bench: Array.isArray(doc.bench) ? doc.bench.map(String) : [],
    keywords: Array.isArray(doc.keywords) ? doc.keywords.map(String) : [],
    equivalent_citation: Array.isArray(doc.equivalent_citation)
      ? doc.equivalent_citation.map(String)
      : [],
    subject_areas: Array.isArray(doc.subject_areas)
      ? doc.subject_areas.map(String)
      : [],
    cited_judgements: Array.isArray(doc.cited_judgements)
      ? doc.cited_judgements.map((item: any) => ({
          docId: String(item.docId || ""),
          title: String(item.title || ""),
        }))
      : [],
    cited_laws: Array.isArray(doc.cited_laws)
      ? doc.cited_laws.map((item: any) => ({
          section_no: String(item.section_no || ""),
          act_name: String(item.act_name || ""),
          act_year: typeof item.act_year === "number" ? item.act_year : null,
          citation_text: String(item.citation_text || ""),
        }))
      : [],
  };
}

export async function createEnrichmentIndex(indexName = ENRICHMENT_INDEX) {
  if (await indexExists(indexName)) return;

  await elasticsearchRequest(`/${indexName}`, {
    method: "PUT",
    body: {
      settings: {
        analysis: {
          filter: {
            legal_edge_ngram_filter: {
              type: "edge_ngram",
              min_gram: 2,
              max_gram: 20,
            },
            legal_synonym_filter: {
              type: "synonym_graph",
              synonyms: [
                "vs, v, versus",
                "ipc, i.p.c., indian penal code",
                "crpc, cr.p.c., code of criminal procedure",
                "cpc, c.p.c., code of civil procedure",
                "constitution, constitution of india",
              ],
            },
          },
          analyzer: {
            legal_text: {
              tokenizer: "standard",
              filter: ["lowercase", "asciifolding", "legal_synonym_filter"],
            },
            legal_autocomplete: {
              tokenizer: "standard",
              filter: ["lowercase", "asciifolding", "legal_edge_ngram_filter"],
            },
            legal_autocomplete_search: {
              tokenizer: "standard",
              filter: ["lowercase", "asciifolding"],
            },
          },
        },
        index: {
          similarity: {
            legal_bm25: {
              type: "BM25",
              k1: 1.4,
              b: 0.65,
            },
          },
        },
      },
      mappings: {
        dynamic: "strict",
        properties: {
          source_docId: { type: "keyword" },
          title: {
            type: "text",
            analyzer: "legal_text",
            search_analyzer: "legal_text",
            similarity: "legal_bm25",
            fields: {
              keyword: { type: "keyword", ignore_above: 512 },
              autocomplete: {
                type: "text",
                analyzer: "legal_autocomplete",
                search_analyzer: "legal_autocomplete_search",
              },
            },
          },
          normalized_title: {
            type: "text",
            analyzer: "legal_text",
            search_analyzer: "legal_text",
            similarity: "legal_bm25",
          },
          petitioner: {
            type: "text",
            analyzer: "legal_text",
            search_analyzer: "legal_text",
            similarity: "legal_bm25",
          },
          respondent: {
            type: "text",
            analyzer: "legal_text",
            search_analyzer: "legal_text",
            similarity: "legal_bm25",
          },
          reversed_title: {
            type: "text",
            analyzer: "legal_text",
            search_analyzer: "legal_text",
            similarity: "legal_bm25",
          },
          parties_text: {
            type: "text",
            analyzer: "legal_text",
            search_analyzer: "legal_text",
            similarity: "legal_bm25",
          },
          year: { type: "integer" },
          bench: {
            type: "text",
            analyzer: "legal_text",
            fields: { keyword: { type: "keyword", ignore_above: 256 } },
          },
          keywords: {
            type: "text",
            analyzer: "legal_text",
            fields: { keyword: { type: "keyword", ignore_above: 256 } },
          },
          equivalent_citation: {
            type: "text",
            analyzer: "legal_text",
            fields: { keyword: { type: "keyword", ignore_above: 256 } },
          },
          subject_areas: {
            type: "text",
            analyzer: "legal_text",
            fields: { keyword: { type: "keyword", ignore_above: 256 } },
          },
          cited_judgements: {
            type: "nested",
            properties: {
              docId: { type: "keyword" },
              title: {
                type: "text",
                analyzer: "legal_text",
                fields: { keyword: { type: "keyword", ignore_above: 512 } },
              },
            },
          },
          cited_laws: {
            type: "nested",
            properties: {
              section_no: { type: "keyword" },
              act_name: {
                type: "text",
                analyzer: "legal_text",
                fields: { keyword: { type: "keyword", ignore_above: 256 } },
              },
              act_year: { type: "integer" },
              citation_text: {
                type: "text",
                analyzer: "legal_text",
                fields: { keyword: { type: "keyword", ignore_above: 512 } },
              },
            },
          },
        },
      },
    },
  });
}

export async function deleteEnrichmentIndex(indexName = ENRICHMENT_INDEX) {
  if (!(await indexExists(indexName))) return;
  await elasticsearchRequest(`/${indexName}`, { method: "DELETE" });
}

export async function setEnrichmentIndexWriteMode(indexName = ENRICHMENT_INDEX) {
  await elasticsearchRequest(`/${indexName}/_settings`, {
    method: "PUT",
    body: {
      index: {
        refresh_interval: "-1",
        number_of_replicas: 0,
      },
    },
  });
}

export async function setEnrichmentIndexSearchMode(indexName = ENRICHMENT_INDEX) {
  await elasticsearchRequest(`/${indexName}/_settings`, {
    method: "PUT",
    body: {
      index: {
        refresh_interval: "1s",
      },
    },
  });

  await elasticsearchRequest(`/${indexName}/_refresh`, { method: "POST" });
}

export async function bulkIndexEnrichments(
  docs: IndexedEnrichmentDocument[],
  indexName = ENRICHMENT_INDEX
) {
  if (!docs.length) return { indexed: 0, errors: [] as unknown[] };

  const ndjson = docs
    .flatMap((doc) => {
      const { esId, ...source } = doc;
      return [
        JSON.stringify({ index: { _index: indexName, _id: esId } }),
        JSON.stringify(source),
      ];
    })
    .join("\n");

  const result = await elasticsearchNdjsonRequest<any>("/_bulk", ndjson);
  const errors = Array.isArray(result.items)
    ? result.items.filter((item: any) => item.index?.error).map((item: any) => item.index.error)
    : [];

  return {
    indexed: docs.length - errors.length,
    errors,
  };
}