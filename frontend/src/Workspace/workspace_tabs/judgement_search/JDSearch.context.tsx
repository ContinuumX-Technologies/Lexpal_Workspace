import React, { createContext, useContext, useState, useCallback } from "react";

// ─── App state machine ────────────────────────────────────────────────────────
export type AppState = "idle" | "loading" | "results" | "reloading" | "loadingMore";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Minimal shape returned from the search API (result list items) */
export interface JudgmentListItem {
  judgement_db_id: string;
  short_hand_title: string;
  judgement_type: string;
  year: number;
}

/** Full case detail — loaded separately when a judgment is selected */
export interface CaseResult {
  id: string;
  title: string;
  shortTitle: string;
  court: string;
  courtType: "supreme" | "high" | "district";
  year: number;
  date: string;
  judges: string;
  citation: string;
  outcome: string;
  outcomeType: "allowed" | "dismissed" | "modified" | "remanded";
  summary: string;
  issues: string[];
  holdings: { n: number; text: string }[];
  formula?: string;
  tags: string[];
  significance: string;
  slpNo?: string;
}

// ─── API response shape ────────────────────────────────────────────────────────
interface SearchApiResponse {
  results: JudgmentListItem[];
  reframedQuery: string;
  hasMore: boolean;
}

// ─── Context value ─────────────────────────────────────────────────────────────
interface JDSearchContextValue {
  appState: AppState;
  query: string;
  listItems: JudgmentListItem[];
  hasMore: boolean;
  selectedCase: CaseResult | null;
  previewLoading: boolean;
  pinnedCases: string[];
  // actions
  search: (query: string) => void;
  refineSearch: (query: string) => void;
  loadMore: () => void;
  selectJudgment: (item: JudgmentListItem) => void;
  togglePin: (id: string) => void;
}

const JDSearchContext = createContext<JDSearchContextValue | null>(null);

// ─── Mock detail fetch (replace with real endpoint) ────────────────────────────
/** Simulates fetching full case detail by db id. Replace with your real endpoint. */
async function fetchCaseDetail(id: string): Promise<CaseResult> {
  await new Promise((r) => setTimeout(r, 900));

  // Fallback mock — map known ids to richer data, otherwise return generic
  const MOCK_DETAILS: Record<string, CaseResult> = {
    abc123: {
      id: "abc123",
      title: "Devendra Kumar Tripathi & Ors. v. Oriental Insurance Co. Ltd.",
      shortTitle: "Tripathi v. Oriental Insurance",
      court: "Supreme Court of India",
      courtType: "supreme",
      year: 2025,
      date: "15 Dec 2025",
      judges: "K. Vinod Chandran J., Ahsanuddin Amanullah J.",
      citation: "2025 INSC 1429",
      outcome: "Appeal Allowed with Modification",
      outcomeType: "modified",
      summary:
        "Civil appeal concerning determination of appropriate compensation in a motor accident claim involving the death of a minor child. The Supreme Court standardised the compensation framework by integrating minimum wage standards and the multiplier method.",
      issues: [
        "Appropriate notional income for a deceased minor",
        "Applicable multiplier in motor accident compensation",
        "Applicability of future prospects",
      ],
      holdings: [
        { n: 1, text: "Minimum wages can be adopted as notional income." },
        { n: 2, text: "Future prospects at 40% are applicable." },
        { n: 3, text: "Multiplier of 15 applies as per Reshma Kumari." },
      ],
      formula: "Min Wages × 12 × 140% × multiplier (15) × ½ deduction",
      tags: ["Motor Accident", "Compensation", "Minimum Wages"],
      significance:
        "Clarifies the method for computing compensation in cases involving death of minor children, integrating minimum wage and multiplier standards.",
      slpNo: "SLP (C) No. 2195 of 2024",
    },
  };

  if (MOCK_DETAILS[id]) return MOCK_DETAILS[id];

  // Generic fallback for any unknown id
  return {
    id,
    title: `Judgment — DB ID: ${id}`,
    shortTitle: `Case ${id}`,
    court: "Supreme Court of India",
    courtType: "supreme",
    year: 2024,
    date: "Jan 01, 2024",
    judges: "Justice A. B. Chandran",
    citation: `2024 INSC ${id}`,
    outcome: "Appeal Allowed",
    outcomeType: "allowed",
    summary:
      "This is a placeholder summary. Integrate your real case-detail endpoint to populate this field with the full judgment summary.",
    issues: ["Issue relating to primary legal question", "Procedural question on jurisdiction"],
    holdings: [
      { n: 1, text: "Primary holding as determined by the court." },
      { n: 2, text: "Secondary holding on procedural matter." },
    ],
    tags: ["Civil", "Procedure"],
    significance:
      "Significance of the judgment will appear here once your detail endpoint is wired up.",
  };
}

// ─── Real search API call ──────────────────────────────────────────────────────
async function callSearchApi(body: Record<string, unknown>): Promise<SearchApiResponse> {
  const res = await fetch("http://localhost:3001/api/judgements/search-judgements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Search API error: ${res.status}`);
  return res.json() as Promise<SearchApiResponse>;
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function JDSearchProvider({ children }: { children: React.ReactNode }) {
  const [appState, setAppState] = useState<AppState>("idle");
  const [query, setQuery] = useState("");
  const [listItems, setListItems] = useState<JudgmentListItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [reframedQuery, setReframedQuery] = useState("");
  const [seenIds, setSeenIds] = useState<string[]>([]);
  const [selectedCase, setSelectedCase] = useState<CaseResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pinnedCases, setPinnedCases] = useState<string[]>([]);

  // ── Initial search ──────────────────────────────────────────────────────────
  const search = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setQuery(q);
    setAppState("loading");
    setSelectedCase(null);
    setListItems([]);
    setSeenIds([]);
    setReframedQuery("");

    try {
      const data = await callSearchApi({ query: q });
      const ids = data.results.map((r) => r.judgement_db_id);
      setListItems(data.results);
      setReframedQuery(data.reframedQuery);
      setHasMore(data.hasMore);
      setSeenIds(ids);
      setAppState("results");
    } catch (err) {
      console.error(err);
      setAppState("results"); // still transition so UI doesn't hang
    }
  }, []);

  // ── Refine search (sidebar re-query) ───────────────────────────────────────
  const refineSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setQuery(q);
    setAppState("reloading");
    setSelectedCase(null);
    setSeenIds([]);
    setReframedQuery("");

    try {
      const data = await callSearchApi({ query: q });
      const ids = data.results.map((r) => r.judgement_db_id);
      setListItems(data.results);
      setReframedQuery(data.reframedQuery);
      setHasMore(data.hasMore);
      setSeenIds(ids);
      setAppState("results");
    } catch (err) {
      console.error(err);
      setAppState("results");
    }
  }, []);

  // ── Load more ───────────────────────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (appState === "loadingMore" || !hasMore) return;
    setAppState("loadingMore");

    try {
      const data = await callSearchApi({ reframedQuery, excludeIds: seenIds });
      const newIds = data.results.map((r) => r.judgement_db_id);
      setListItems((prev) => [...prev, ...data.results]);
      setReframedQuery(data.reframedQuery);
      setHasMore(data.hasMore);
      setSeenIds((prev) => [...prev, ...newIds]);
      setAppState("results");
    } catch (err) {
      console.error(err);
      setAppState("results");
    }
  }, [appState, hasMore, reframedQuery, seenIds]);

  // ── Select a judgment → fetch detail ───────────────────────────────────────
  const selectJudgment = useCallback(async (item: JudgmentListItem) => {
    setPreviewLoading(true);
    setSelectedCase(null);
    try {
      const detail = await fetchCaseDetail(item.judgement_db_id);
      setSelectedCase(detail);
    } catch (err) {
      console.error(err);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  // ── Toggle pin ──────────────────────────────────────────────────────────────
  const togglePin = useCallback((id: string) => {
    setPinnedCases((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }, []);

  return (
    <JDSearchContext.Provider
      value={{
        appState,
        query,
        listItems,
        hasMore,
        selectedCase,
        previewLoading,
        pinnedCases,
        search,
        refineSearch,
        loadMore,
        selectJudgment,
        togglePin,
      }}
    >
      {children}
    </JDSearchContext.Provider>
  );
}

export function useJDSearch() {
  const ctx = useContext(JDSearchContext);
  if (!ctx) throw new Error("useJDSearch must be used within JDSearchProvider");
  return ctx;
}