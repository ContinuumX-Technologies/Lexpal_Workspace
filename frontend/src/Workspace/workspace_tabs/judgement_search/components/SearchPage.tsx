import React, { useState, useEffect, useCallback } from "react";
import styles from "./SearchPage.module.css";
import { useJDSearch } from "../JDSearch.context";

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
  const { search, appState, pinnedCases, togglePin } = useJDSearch();
  const [query, setQuery] = useState("");

  const handleSearch = useCallback(() => {
    if (query.trim()) search(query.trim());
  }, [query, search]);

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
          <div className={styles.spinnerRing} />
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
          <button className={styles.filterBtn}>
            <span className={`material-symbols-outlined ${styles.filterBtnIcon}`}>tune</span>
            + Filters
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#94a3b8" }}>expand_more</span>
          </button>
        </div>

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
              <span className={`material-symbols-outlined ${styles.recentTitleIcon}`}>keep</span>
              Recent &amp; Pinned
            </h3>
            <button className={styles.viewAll}>View all activity</button>
          </div>
          <div className={styles.recentGrid}>
            {RECENT_MOCK.map((c) => {
              const isPinned = pinnedCases.includes(c.id);
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
                      onClick={(e) => { e.stopPropagation(); togglePin(c.id); }}
                      title={isPinned ? "Unpin" : "Pin"}
                    >
                      <span className="material-symbols-outlined">keep</span>
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