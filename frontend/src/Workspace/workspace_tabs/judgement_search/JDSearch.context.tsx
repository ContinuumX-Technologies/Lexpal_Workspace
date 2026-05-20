import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";

// ─── App state machine ────────────────────────────────────────────────────────
export type AppState = "idle" | "loading" | "results" | "reloading" | "loadingMore";
export type SearchSource = "public" | "firm";

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
  finalDecision: string;
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

export interface PinnedCase {
  id: string;
  title: string;
  court: string;
  year: number;
}

// ─── Context value ─────────────────────────────────────────────────────────────
interface JDSearchContextValue {
  appState: AppState;
  query: string;
  listItems: JudgmentListItem[];
  hasMore: boolean;
  selectedCase: CaseResult | null;
  previewLoading: boolean;
  pinnedCases: PinnedCase[];
  searchSource: SearchSource;
  setSearchSource: (val: SearchSource) => void;
  
  // filters
  jurisdiction: string;
  setJurisdiction: (val: string) => void;
  year: string;
  setYear: (val: string) => void;
  status: string;
  setStatus: (val: string) => void;
  area: string;
  setArea: (val: string) => void;
  resetFilters: () => void;

  // actions
  search: (query: string) => void;
  refineSearch: (query: string) => void;
  loadMore: () => void;
  selectJudgment: (item: JudgmentListItem) => void;
  togglePin: (item: PinnedCase) => void;
}

const JDSearchContext = createContext<JDSearchContextValue | null>(null);

// ─── Fetch actual case detail from backend ───────────────────────────────────
async function fetchCaseDetail(id: string, item?: JudgmentListItem): Promise<CaseResult> {
  const res = await fetch(`http://localhost:3001/api/judgements/${id}`);
  if (!res.ok) throw new Error("Failed to fetch detail");
  const doc = await res.json();

  const stripMarkdown = (str: string) => str.replace(/[#*`_]/g, "").trim();

  let caseOverview = "", finalDecision = "", judgmentOutcome = "", issuesConsideredStr = "", keyHoldingsStr = "", statutesDomainsStr = "", significanceStr = "", benchStr = "";
  let summaryText = "";

  if (typeof doc.summary === "string") {
    summaryText = doc.summary || "";
    const extractSection = (headerStr: string, nextHeaderStr?: string) => {
      const startIdx = summaryText.indexOf(headerStr);
      if (startIdx === -1) return "";
      const contentStart = startIdx + headerStr.length;
      let endIdx = summaryText.length;
      if (nextHeaderStr) {
        const nIdx = summaryText.indexOf(nextHeaderStr, contentStart);
        if (nIdx !== -1) endIdx = nIdx;
      }
      return summaryText.substring(contentStart, endIdx).trim();
    };

    caseOverview = stripMarkdown(extractSection("1) Case Overview", "2) Final Decision"));
    finalDecision = stripMarkdown(extractSection("2) Final Decision", "3) Judgment Outcome"));
    judgmentOutcome = stripMarkdown(extractSection("3) Judgment Outcome", "4) Issues Considered"));
    issuesConsideredStr = extractSection("4) Issues Considered", "5) Key Holdings");
    keyHoldingsStr = extractSection("5) Key Holdings", "6) Statutes & Domains");
    statutesDomainsStr = extractSection("6) Statutes & Domains", "7) Significance");
    significanceStr = stripMarkdown(extractSection("7) Significance", "8) Bench - Judges in that case"));
    benchStr = stripMarkdown(extractSection("8) Bench - Judges in that case"));
  } else if (typeof doc.summary === "object" && doc.summary !== null) {
    const ensureString = (val: unknown) => typeof val === "string" ? val : (val ? JSON.stringify(val) : "");
    caseOverview = stripMarkdown(ensureString(doc.summary.caseOverview));
    finalDecision = stripMarkdown(ensureString(doc.summary.finalDecision));
    judgmentOutcome = stripMarkdown(ensureString(doc.summary.judgmentOutcome));
    issuesConsideredStr = ensureString(doc.summary.issuesConsidered);
    keyHoldingsStr = ensureString(doc.summary.keyHoldings);
    statutesDomainsStr = ensureString(doc.summary.statutesDomains);
    significanceStr = stripMarkdown(ensureString(doc.summary.significance));
    benchStr = stripMarkdown(ensureString(doc.summary.bench));
  }

  // Format arrays
  const issues = issuesConsideredStr.split('\n')
    .map((s: string) => stripMarkdown(s.replace(/^[-*•]/, '').replace(/^\d+\./, '')))
    .filter(Boolean);
  const holdings = keyHoldingsStr.split('\n')
    .map((h: string) => stripMarkdown(h.replace(/^[-*•]/, '').replace(/^\d+\./, '')))
    .filter(Boolean)
    .map((text: string, i: number) => ({ n: i + 1, text }));
  const tags = statutesDomainsStr.split('\n').map((s: string) => stripMarkdown(s.replace(/^[-*•]/, ''))).filter(Boolean);

  const determineOutcomeType = (outcomeStr: string) => {
    const s = outcomeStr.toLowerCase();
    if (s.includes("allowed") || s.includes("allow")) return "allowed";
    if (s.includes("dismissed") || s.includes("dismiss")) return "dismissed";
    if (s.includes("modified") || s.includes("modify")) return "modified";
    if (s.includes("remanded") || s.includes("remand")) return "remanded";
    return "allowed"; // default
  };

  const cType = (item?.judgement_type || "Supreme court").toLowerCase();
  const courtType = cType.includes("supreme") ? "supreme" : (cType.includes("high") ? "high" : "district");

  return {
    id: id,
    title: item?.short_hand_title || doc.title || "Unknown Title",
    shortTitle: item?.short_hand_title || doc.title || "Unknown Title",
    court: item?.judgement_type || "Supreme court",
    courtType,
    year: item?.year || doc.year || 2024,
    date: doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : "Unknown Date",
    judges: benchStr || doc.bench?.join(", ") || "Unknown Bench",
    citation: doc.source?.docId || "No Citation",
    outcome: judgmentOutcome || "Unknown Outcome",
    finalDecision: finalDecision || "Unknown Decision",
    outcomeType: determineOutcomeType(judgmentOutcome || finalDecision || ""),
    summary: caseOverview || summaryText || "No summary available.",
    issues: issues.length ? issues : ["No specific issues listed."],
    holdings: holdings.length ? holdings : [{ n: 1, text: "No key holdings listed." }],
    tags: tags.length ? tags : ["Legal"],
    significance: significanceStr || "Not provided.",
    slpNo: ""
  };
}

// ─── Real search API call ──────────────────────────────────────────────────────
async function callSearchApi(body: Record<string, unknown>, source: SearchSource): Promise<SearchApiResponse> {
  const url = source === "public" 
    ? "http://localhost:3001/api/judgements/search"
    : "http://localhost:3001/api/firm-precedents/search";
    
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Search API error: ${res.status}`);
  return res.json() as Promise<SearchApiResponse>;
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function JDSearchProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [appState, setAppState] = useState<AppState>("idle");
  const [query, setQuery] = useState("");
  const [listItems, setListItems] = useState<JudgmentListItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [reframedQuery, setReframedQuery] = useState("");
  const [seenIds, setSeenIds] = useState<string[]>([]);
  const [selectedCase, setSelectedCase] = useState<CaseResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pinnedCases, setPinnedCases] = useState<PinnedCase[]>([]);
  const [searchSource, setSearchSource] = useState<SearchSource>("public");
  const { caseId } = useParams<{ caseId: string }>();

  const [jurisdiction, setJurisdiction] = useState<string>("");
  const [year, setYear] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [area, setArea] = useState<string>("");

  useEffect(() => {
    if (caseId) {
      setAppState("results");
      setPreviewLoading(true);
      const item = location.state?.item;
      fetchCaseDetail(caseId, item)
        .then((detail) => setSelectedCase(detail))
        .catch((err) => console.error("Failed to load case directly by ID", err))
        .finally(() => setPreviewLoading(false));
    }
  }, [caseId, location.state?.item]);

  const resetFilters = useCallback(() => {
    setJurisdiction("");
    setYear("");
    setStatus("");
    setArea("");
  }, []);

  const getFilterParams = useCallback(() => ({
    jurisdiction,
    year: year ? parseInt(year) : undefined,
    status,
    area
  }), [jurisdiction, year, status, area]);

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
      const data = await callSearchApi({ 
        query: q, 
        ...getFilterParams() 
      }, searchSource);
      const ids = data.results.map((r) => r.judgement_db_id);
      setListItems(data.results);
      setReframedQuery(data.reframedQuery || "");
      setHasMore(data.hasMore);
      setSeenIds(ids);
      setAppState("results");
    } catch (err) {
      console.error(err);
      setAppState("results");
    }
  }, [getFilterParams, searchSource]);

  // ── Refine search (sidebar re-query) ───────────────────────────────────────
  const refineSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setQuery(q);
    setAppState("reloading");
    setSelectedCase(null);
    setSeenIds([]);
    setReframedQuery("");

    try {
      const data = await callSearchApi({ 
        query: q, 
        ...getFilterParams() 
      }, searchSource);
      const ids = data.results.map((r) => r.judgement_db_id);
      setListItems(data.results);
      setReframedQuery(data.reframedQuery || "");
      setHasMore(data.hasMore);
      setSeenIds(ids);
      setAppState("results");
    } catch (err) {
      console.error(err);
      setAppState("results");
    }
  }, [getFilterParams, searchSource]);

  // ── Load more ───────────────────────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (appState === "loadingMore" || !hasMore) return;
    setAppState("loadingMore");

    try {
      const data = await callSearchApi({ 
        reframedQuery, 
        excludeIds: seenIds,
        ...getFilterParams()
      }, searchSource);
      const newIds = data.results.map((r) => r.judgement_db_id);
      setListItems((prev) => [...prev, ...data.results]);
      setReframedQuery(data.reframedQuery || "");
      setHasMore(data.hasMore);
      setSeenIds((prev) => [...prev, ...newIds]);
      setAppState("results");
    } catch (err) {
      console.error(err);
      setAppState("results");
    }
  }, [appState, hasMore, reframedQuery, seenIds, getFilterParams, searchSource]);

  // ── Select a judgment → fetch detail ───────────────────────────────────────
  const selectJudgment = useCallback((item: JudgmentListItem) => {
    navigate(`/workspace/${item.judgement_db_id}`, { state: { item } });
  }, [navigate]);

  // ── Toggle pin ──────────────────────────────────────────────────────────────
  const togglePin = useCallback((caseItem: PinnedCase) => {
    setPinnedCases((prev) =>
      prev.some((p) => p.id === caseItem.id) 
        ? prev.filter((p) => p.id !== caseItem.id) 
        : [...prev, caseItem]
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
        jurisdiction,
        setJurisdiction,
        year,
        setYear,
        status,
        setStatus,
        area,
        setArea,
        resetFilters,
        search,
        refineSearch,
        loadMore,
        selectJudgment,
        togglePin,
        searchSource,
        setSearchSource,
      }}
    >
      {children}
    </JDSearchContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useJDSearch() {
  const ctx = useContext(JDSearchContext);
  if (!ctx) throw new Error("useJDSearch must be used within JDSearchProvider");
  return ctx;
}