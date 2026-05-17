import React, { useState, useEffect, useCallback } from "react";
import styles from "./SearchPage.module.css";
import { useJDSearch } from "../JDSearch.context";
import LoadingLines from "@/components/ui/loading-lines";

const SUGGESTED = [
  "Unilateral appointment of arbitrator",
  "Duty of care in medical negligence",
  "Specific performance of contract",
  "Doctrine of lifting corporate veil",
];

const RECENT_MOCK = [
  {
    id: "1",
    courtType: "supreme" as const,
    courtLabel: "Supreme Court",
    title: "Vedanta Limited vs. Shenzhen Shandong Nuclear Power Construction...",
    date: "Oct 12, 2023",
    judge: "Justice DY Chandrachud",
  },
  {
    id: "2",
    courtType: "high" as const,
    courtLabel: "High Court",
    title: "Amazon.com NV Investment Holdings LLC vs. Future Retail Limited",
    date: "Aug 06, 2023",
    judge: "Justice RF Nariman",
  },
];

export default function SearchPage() {
  const { 
    search, appState, pinnedCases, togglePin,
    jurisdiction, setJurisdiction,
    year, setYear,
    status, setStatus,
    area, setArea,
    resetFilters,
    searchSource,
    setSearchSource,
  } = useJDSearch();
  
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const handleSearch = useCallback(() => {
    if (query.trim()) search(query.trim());
  }, [query, search]);

  const handleFirmUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("firmId", "lexpal_internal");
    
    try {
      const res = await fetch("http://localhost:3001/api/firm-precedents/upload", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        alert(`Successfully indexed "${data.title}" into your firm library!`);
      }
    } catch (err) {
      alert("Failed to upload precedent.");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch();
  };

  // Global Cmd+K shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document.getElementById("main-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isLoading = appState === "loading";

  return (
    <div className={styles.root}>
      <div className={styles.blob1} />
      <div className={styles.blob2} />

      {isLoading && (
        <div className={styles.loadingOverlay}>
          <LoadingLines />
          <p className={styles.loadingText}>Searching case law…</p>
          <p className={styles.loadingSubtext}>Analyzing judgments with AI</p>
        </div>
      )}

      <div className={styles.inner}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.logo}>
            <span className={styles.logoIcon}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>balance</span>
            </span>
            <span className={styles.logoText}>Lexis<span>Glass</span></span>
          </div>
          <h1 className={styles.title}>Judgment Search</h1>
          <p className={styles.subtitle}>Analyze the law with precision and AI-driven insights.</p>
        </div>

        {/* Source Toggle */}
        <div className={styles.sourceTabs}>
          <button 
            className={`${styles.sourceTab} ${searchSource === "public" ? styles.activeTab : ""}`}
            onClick={() => setSearchSource("public")}
          >
            Public Judgments
          </button>
          <button 
            className={`${styles.sourceTab} ${searchSource === "firm" ? styles.activeTab : ""}`}
            onClick={() => setSearchSource("firm")}
          >
            Firm Library
          </button>
          {searchSource === "firm" && (
            <label className={styles.uploadLabel}>
              <input type="file" onChange={handleFirmUpload} hidden accept=".docx" />
              <span>+ Upload Precedent</span>
            </label>
          )}
        </div>

        {/* Search bar */}
        <div className={styles.searchWrap}>
          <div className={styles.searchBox}>
            <span className={`material-symbols-outlined ${styles.searchIcon}`}>search</span>
            <input
              id="main-search"
              className={styles.searchInput}
              placeholder="Search judgments, statutes, or legal principles using natural language…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
            />
            <span className={styles.kbdHint}>⌘ K</span>
            <button className={styles.searchBtn} onClick={handleSearch}>
              <span className={`material-symbols-outlined ${styles.btnIcon}`}>arrow_forward</span>
              Search
            </button>
          </div>
        </div>

        {/* Filters row */}
        <div className={styles.filtersRow}>
          <button 
            className={`${styles.filterBtn} ${showFilters ? styles.filterBtnActive : ""}`}
            onClick={() => setShowFilters(!showFilters)}
          >
            <span className={`material-symbols-outlined ${styles.filterBtnIcon}`}>tune</span>
            {showFilters ? "Hide Filters" : "+ Filters"}
            <span className={`material-symbols-outlined ${styles.expandIcon} ${showFilters ? styles.expanded : ""}`}>expand_more</span>
          </button>
          
          {/* Active filter chips */}
          {(jurisdiction || year || status || area) && (
            <button className={styles.clearAllBtn} onClick={resetFilters}>Clear all</button>
          )}
        </div>

        {/* Expandable Filter Panel */}
        {showFilters && (
          <div className={styles.filterPanel}>
            <div className={styles.filterGrid}>
              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>Jurisdiction</label>
                <select 
                  className={styles.filterSelect}
                  value={jurisdiction}
                  onChange={(e) => setJurisdiction(e.target.value)}
                >
                  <option value="">All Jurisdictions</option>
                  <option value="Supreme court">Supreme Court</option>
                  <option value="High court">High Court</option>
                </select>
              </div>

              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>Year</label>
                <input 
                  type="number"
                  className={styles.filterInput}
                  placeholder="e.g. 2023"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                />
              </div>

              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>Status</label>
                <select 
                  className={styles.filterSelect}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">All Statuses</option>
                  <option value="Reportable">Reportable</option>
                  <option value="Non-reportable">Non-reportable</option>
                </select>
              </div>

              <div className={styles.filterGroup}>
                <label className={styles.filterLabel}>Legal Area</label>
                <select 
                  className={styles.filterSelect}
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                >
                  <option value="">All Areas</option>
                  <option value="Arbitration">Arbitration</option>
                  <option value="Criminal">Criminal</option>
                  <option value="Civil">Civil</option>
                  <option value="Constitutional">Constitutional</option>
                  <option value="Taxation">Taxation</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Suggested chips */}
        <div className={styles.suggestedSection}>
          <p className={styles.suggestedLabel}>Suggested contextual searches</p>
          <div className={styles.suggestedChips}>
            {SUGGESTED.map((s) => (
              <button
                key={s}
                className={styles.chip}
                onClick={() => {
                  setQuery(s);
                  search(s);
                }}
              >
                <span className={`material-symbols-outlined ${styles.chipIcon}`}>auto_awesome</span>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Recent & Pinned */}
        <div className={styles.recentSection}>
          <div className={styles.recentHeader}>
            <h3 className={styles.recentTitle}>
              <span className={`material-symbols-outlined ${styles.recentTitleIcon}`}>push_pin</span>
              Recent &amp; Pinned
            </h3>
            <button className={styles.viewAll}>View all activity</button>
          </div>
          <div className={styles.recentGrid}>
            {RECENT_MOCK.map((c) => {
              const isPinned = pinnedCases.some(p => p.id === c.id);
              return (
                <div
                  key={c.id}
                  className={styles.recentCard}
                  onClick={() => search(c.title)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && search(c.title)}
                >
                  <div className={styles.recentCardTop}>
                    <span
                      className={`${styles.courtBadge} ${
                        c.courtType === "supreme" ? styles.courtBadgeSupreme : styles.courtBadgeHigh
                      }`}
                    >
                      {c.courtLabel}
                    </span>
                    <button
                      className={`${styles.pinBtn} ${isPinned ? styles.pinned : ""}`}
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        togglePin({
                          id: c.id,
                          title: c.title,
                          court: c.courtLabel,
                          year: parseInt(c.date.slice(-4)) || new Date().getFullYear()
                        }); 
                      }}
                      title={isPinned ? "Unpin" : "Pin"}
                    >
                      <span className="material-symbols-outlined">push_pin</span>
                    </button>
                  </div>
                  <p className={styles.recentCardTitle}>{c.title}</p>
                  <div className={styles.recentCardMeta}>
                    <span className={styles.metaItem}>
                      <span className={`material-symbols-outlined ${styles.metaIcon}`}>calendar_today</span>
                      {c.date}
                    </span>
                    <span className={styles.metaItem}>
                      <span className={`material-symbols-outlined ${styles.metaIcon}`}>person</span>
                      {c.judge}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <p className={styles.tip}>
          Tip: You can use phrases like "Which judgments discuss the retrospective effect of tax statutes?"
        </p>
      </div>
    </div>
  );
}