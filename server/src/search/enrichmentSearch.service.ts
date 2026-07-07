import { ENRICHMENT_INDEX, elasticsearchRequest } from "../infra/elasticsearch.client";
import { EnrichmentDocument } from "./enrichmentIndex.service";

export interface EnrichmentSearchRequest {
  query?: string;
  page?: number;
  pageSize?: number;
  filters?: {
    year?: number;
    yearFrom?: number;
    yearTo?: number;
    bench?: string[];
    subject_areas?: string[];
    keywords?: string[];
    act_name?: string[];
    section_no?: string[];
    cited_docId?: string[];
    equivalent_citation?: string[];
  };
}

export interface EnrichmentSearchHit {
  id: string;
  score: number;
  source: EnrichmentDocument;
  highlights: Record<string, string[]>;
  match_reasons: string[];
}

function keywordTerms(field: string, values?: string[]) {
  if (!values?.length) return [];
  return [{ terms: { [field]: values } }];
}

function nestedTerms(path: string, field: string, values?: string[]) {
  if (!values?.length) return [];
  return [
    {
      nested: {
        path,
        query: {
          terms: { [`${path}.${field}`]: values },
        },
      },
    },
  ];
}

function buildFilters(filters: EnrichmentSearchRequest["filters"] = {}) {
  const clauses: any[] = [
    ...keywordTerms("bench.keyword", filters.bench),
    ...keywordTerms("subject_areas.keyword", filters.subject_areas),
    ...keywordTerms("keywords.keyword", filters.keywords),
    ...keywordTerms("equivalent_citation.keyword", filters.equivalent_citation),
    ...nestedTerms("cited_laws", "section_no", filters.section_no),
    ...nestedTerms("cited_judgements", "docId", filters.cited_docId),
  ];

  if (filters.year) clauses.push({ term: { year: filters.year } });
  if (filters.yearFrom || filters.yearTo) {
    clauses.push({
      range: {
        year: {
          ...(filters.yearFrom ? { gte: filters.yearFrom } : {}),
          ...(filters.yearTo ? { lte: filters.yearTo } : {}),
        },
      },
    });
  }

  if (filters.act_name?.length) {
    clauses.push({
      nested: {
        path: "cited_laws",
        query: {
          terms: {
            "cited_laws.act_name.keyword": filters.act_name,
          },
        },
      },
    });
  }

  return clauses;
}

function buildQuery(query: string, filters: EnrichmentSearchRequest["filters"]) {
  const trimmed = query.trim();
  const filter = buildFilters(filters);

  if (!trimmed) {
    return {
      bool: {
        filter,
        must: [{ match_all: {} }],
      },
    };
  }

  return {
    bool: {
      filter,
      should: [
        { term: { source_docId: { value: trimmed, boost: 40 } } },
        { term: { "title.keyword": { value: trimmed, boost: 30 } } },
        { term: { "equivalent_citation.keyword": { value: trimmed, boost: 35 } } },
        {
          match_phrase: {
            title: {
              query: trimmed,
              boost: 18,
              slop: 2,
            },
          },
        },
        {
          multi_match: {
            query: trimmed,
            type: "best_fields",
            operator: "and",
            fields: [
              "title^10",
              "equivalent_citation^9",
              "keywords^6",
              "subject_areas^5",
              "bench^3",
            ],
            boost: 7,
          },
        },
        {
          multi_match: {
            query: trimmed,
            type: "cross_fields",
            operator: "or",
            fields: [
              "title^8",
              "keywords^5",
              "subject_areas^4",
              "equivalent_citation^8",
              "bench^2",
            ],
            boost: 4,
          },
        },
        {
          match: {
            "title.autocomplete": {
              query: trimmed,
              boost: 5,
            },
          },
        },
        {
          nested: {
            path: "cited_laws",
            score_mode: "max",
            query: {
              bool: {
                should: [
                  {
                    multi_match: {
                      query: trimmed,
                      fields: [
                        "cited_laws.act_name^7",
                        "cited_laws.citation_text^8",
                        "cited_laws.section_no^10",
                      ],
                    },
                  },
                  { term: { "cited_laws.section_no": { value: trimmed, boost: 18 } } },
                  { term: { "cited_laws.act_name.keyword": { value: trimmed, boost: 15 } } },
                ],
                minimum_should_match: 1,
              },
            },
            inner_hits: {
              name: "matched_laws",
              size: 3,
              highlight: {
                fields: {
                  "cited_laws.act_name": {},
                  "cited_laws.citation_text": {},
                },
              },
            },
          },
        },
        {
          nested: {
            path: "cited_judgements",
            score_mode: "max",
            query: {
              bool: {
                should: [
                  { term: { "cited_judgements.docId": { value: trimmed, boost: 15 } } },
                  {
                    match_phrase: {
                      "cited_judgements.title": {
                        query: trimmed,
                        boost: 10,
                        slop: 2,
                      },
                    },
                  },
                  {
                    match: {
                      "cited_judgements.title": {
                        query: trimmed,
                        boost: 5,
                      },
                    },
                  },
                ],
                minimum_should_match: 1,
              },
            },
            inner_hits: {
              name: "matched_cited_judgements",
              size: 3,
              highlight: {
                fields: {
                  "cited_judgements.title": {},
                },
              },
            },
          },
        },
      ],
      minimum_should_match: 1,
    },
  };
}

function matchReasons(hit: any): string[] {
  const reasons: string[] = [];
  const highlight = hit.highlight || {};
  const innerHits = hit.inner_hits || {};

  if (highlight.title) reasons.push("Matched case title");
  if (highlight.equivalent_citation) reasons.push("Matched citation");
  if (highlight.keywords) reasons.push("Matched legal keyword");
  if (highlight.subject_areas) reasons.push("Matched subject area");
  if (highlight.bench) reasons.push("Matched judge or bench");
  if (innerHits.matched_laws?.hits?.hits?.length) reasons.push("Matched cited law/section");
  if (innerHits.matched_cited_judgements?.hits?.hits?.length) {
    reasons.push("Matched cited judgment");
  }
  if (!reasons.length) reasons.push("BM25 metadata match");

  return reasons;
}

export async function searchEnrichmentMetadata(input: EnrichmentSearchRequest) {
  const page = Math.max(input.page || 1, 1);
  const pageSize = Math.min(Math.max(input.pageSize || 10, 1), 50);
  const query = input.query || "";

  const response = await elasticsearchRequest<any>(`/${ENRICHMENT_INDEX}/_search`, {
    method: "POST",
    body: {
      from: (page - 1) * pageSize,
      size: pageSize,
      track_total_hits: true,
      query: buildQuery(query, input.filters),
      highlight: {
        pre_tags: ["<mark>"],
        post_tags: ["</mark>"],
        fields: {
          title: { number_of_fragments: 0 },
          equivalent_citation: { number_of_fragments: 0 },
          keywords: { number_of_fragments: 0 },
          subject_areas: { number_of_fragments: 0 },
          bench: { number_of_fragments: 0 },
        },
      },
      aggs: {
        years: { terms: { field: "year", size: 20, order: { _key: "desc" } } },
        subject_areas: { terms: { field: "subject_areas.keyword", size: 30 } },
        keywords: { terms: { field: "keywords.keyword", size: 30 } },
        bench: { terms: { field: "bench.keyword", size: 30 } },
        cited_laws: {
          nested: { path: "cited_laws" },
          aggs: {
            act_names: { terms: { field: "cited_laws.act_name.keyword", size: 30 } },
            sections: { terms: { field: "cited_laws.section_no", size: 30 } },
          },
        },
      },
    },
  });

  const hits: EnrichmentSearchHit[] = response.hits.hits.map((hit: any) => ({
    id: hit._id,
    score: hit._score,
    source: hit._source,
    highlights: hit.highlight || {},
    match_reasons: matchReasons(hit),
  }));

  return {
    query,
    page,
    pageSize,
    total:
      typeof response.hits.total === "number"
        ? response.hits.total
        : response.hits.total?.value || 0,
    results: hits,
    facets: {
      years: response.aggregations?.years?.buckets || [],
      subject_areas: response.aggregations?.subject_areas?.buckets || [],
      keywords: response.aggregations?.keywords?.buckets || [],
      bench: response.aggregations?.bench?.buckets || [],
      cited_laws: {
        act_names: response.aggregations?.cited_laws?.act_names?.buckets || [],
        sections: response.aggregations?.cited_laws?.sections?.buckets || [],
      },
    },
  };
}
