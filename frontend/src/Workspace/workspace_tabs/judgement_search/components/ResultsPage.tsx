import React, { useState, useRef, useEffect } from "react";
import styles from "./ResultsPage.module.css";
import { useJDSearch } from "../JDSearch.context";
import type { CaseResult, JudgmentListItem } from "../JDSearch.context";

// ─── Skeleton: sidebar list ───────────────────────────────────────────────────
function ResultSkeleton() {
  return (
    <div className={styles.skeletonCard}>
      <div className={`${styles.skeletonLine} ${styles.skeletonMed}`} />
      <div className={`${styles.skeletonLine} ${styles.skeletonShort}`} />
    </div>
  );
}

// ─── Skeleton: preview panel ──────────────────────────────────────────────────
function PreviewSkeleton() {
  return (
    <div className={styles.previewSkeleton}>
      <div className={styles.skeletonBlock}>
        <div className={styles.skeletonTitle} />
        <div className={styles.skeletonSubtitle} />
      </div>
      <div className={styles.skeletonBlock}>
        {[100, 90, 95, 80, 85].map((w, i) => (
          <div key={i} className={styles.skeletonPara} style={{ width: `${w}%` }} />
        ))}
      </div>
      <div className={styles.skeletonBlock}>
        {[60, 75, 55].map((w, i) => (
          <div key={i} className={styles.skeletonPara} style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

// ─── Placeholder: nothing selected yet ───────────────────────────────────────
function PreviewPlaceholder() {
  return (
    <div className={styles.previewPlaceholder}>
      <div className={styles.placeholderIcon}>
        <span className="material-symbols-outlined">gavel</span>
      </div>
      <p className={styles.placeholderTitle}>Select a judgment to preview</p>
      <p className={styles.placeholderSub}>
        Choose a result from the list to see its full analysis, holdings, and significance.
      </p>
    </div>
  );
}

// ─── Outcome CSS helper ───────────────────────────────────────────────────────
function outcomeClass(type: CaseResult["outcomeType"]) {
  if (type === "allowed") return styles.outcomeAllowed;
  if (type === "dismissed") return styles.outcomeDismissed;
  if (type === "modified") return styles.outcomeModified;
  return "";
}

// ─── Court label normaliser ───────────────────────────────────────────────────
function courtLabel(judgementType: string): string {
  const t = judgementType.toLowerCase();
  if (t.includes("supreme")) return "Supreme Court";
  if (t.includes("high")) return "High Court";
  return judgementType;
}

function courtTypeClass(judgementType: string): string {
  const t = judgementType.toLowerCase();
  if (t.includes("supreme")) return styles.courtSupreme;
  if (t.includes("high")) return styles.courtHigh;
  return styles.courtDistrict;
}

// ─── Sidebar result card ──────────────────────────────────────────────────────
function ResultCard({
  item,
  active,
  pinned,
  onSelect,
  onPin,
}: {
  item: JudgmentListItem;
  active: boolean;
  pinned: boolean;
  onSelect: () => void;
  onPin: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={`${styles.resultCard} ${active ? styles.active : ""}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
    >
      <div className={styles.resultCardMain}>
        <p className={styles.resultCardTitle}>{item.short_hand_title}</p>
        <div className={styles.resultCardMeta}>
          <span className={`${styles.courtTag} ${courtTypeClass(item.judgement_type)}`}>
            {courtLabel(item.judgement_type)}
          </span>
          <span className={styles.yearTag}>{item.year}</span>
        </div>
      </div>

      <div className={styles.resultCardRight}>
        {active && <span className={styles.currentTag}>Current</span>}
        <button
          className={`${styles.resultPinBtn} ${pinned ? styles.pinned : ""}`}
          onClick={onPin}
          title={pinned ? "Unpin" : "Pin"}
        >
          <span className="material-symbols-outlined">push_pin</span>
        </button>
      </div>
    </div>
  );
}

// ─── Full case preview ────────────────────────────────────────────────────────
function CasePreview({
  c,
  pinned,
  onPin,
}: {
  c: CaseResult;
  pinned: boolean;
  onPin: () => void;
}) {
  return (
    <>
      <div className={styles.previewHeader}>
        <div className={styles.previewHeaderTop}>
          <div className={styles.previewBadges}>
            <span className={styles.previewCourtBadge}>{c.court}</span>
            <span className={styles.previewCitationBadge}>{c.citation}</span>
            <span className={styles.previewDateLabel}>{c.date}</span>
          </div>
          <div className={styles.previewActions}>
            <button
              className={`${styles.pinActionBtn} ${pinned ? styles.pinned : ""}`}
              onClick={onPin}
              title={pinned ? "Unpin" : "Pin"}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                push_pin
              </span>
            </button>
            <button className={styles.viewFullBtn}>
              <span className={`material-symbols-outlined ${styles.viewFullBtnIcon}`}>bolt</span>
              View Full Case
            </button>
          </div>
        </div>
        <h1 className={styles.previewTitle}>{c.title}</h1>
        <div className={styles.previewSubMeta}>
          <span>
            <span className={styles.previewSubMetaLabel}>Bench:</span>
            {c.judges}
          </span>
          {c.slpNo && (
            <>
              <span className={styles.previewSubMetaDot} />
              <span style={{ fontStyle: "italic" }}>{c.slpNo}</span>
            </>
          )}
        </div>
      </div>

      <div className={styles.previewBody}>
        <div className={styles.overviewBox}>
          <span className={styles.boxLabel}>Case Overview</span>
          <p className={styles.overviewText}>{c.summary}</p>
        </div>

        <div className={styles.outcomeStrip}>
          <span className={`material-symbols-outlined ${styles.outcomeIcon}`}>verified</span>
          <div>
            <span className={styles.outcomeStripLabel}>Judgment Outcome</span>
            <p className={styles.outcomeStripTitle}>{c.outcome}</p>
          </div>
        </div>

        <div className={styles.detailsGrid}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <div className={styles.decisionBlock}>
              <span className={styles.decisionTag}>Final Decision</span>
              <p className={styles.decisionText}>
                The {c.court} ruled:{" "}
                <span className={styles.highlight}>{c.outcome}</span>
                {c.formula && (
                  <> using the formula <span className={styles.highlight}>{c.formula}</span>.</>
                )}
              </p>
            </div>

            <div className={styles.issuesHoldingsBox}>
              <div>
                <span className={styles.boxLabel}>Issues Considered</span>
                <ul className={styles.issuesList}>
                  {c.issues.map((issue, i) => (
                    <li key={i} className={styles.issueItem}>
                      <span className={styles.bulletDot}>•</span>
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <span className={styles.boxLabel}>Key Holdings</span>
                <div className={styles.holdingsList}>
                  {c.holdings.map((h) => (
                    <div key={h.n} className={styles.holdingItem}>
                      <span className={styles.holdingNum}>{h.n}</span>
                      <p className={styles.holdingText}>{h.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {c.formula && (
              <div className={styles.formulaBar}>
                <span className={styles.formulaLabel}>
                  <span className={`material-symbols-outlined ${styles.formulaLabelIcon}`}>
                    calculate
                  </span>
                  Formula
                </span>
                <span className={styles.formulaText}>{c.formula}</span>
              </div>
            )}
          </div>

          <div className={styles.rightSidebar}>
            <div className={styles.tagsSection}>
              <span className={styles.boxLabel}>Statutes &amp; Domains</span>
              <div className={styles.tagChips}>
                {c.tags.map((t) => (
                  <span key={t} className={styles.tagChip}>{t}</span>
                ))}
              </div>
            </div>
            <div className={styles.significanceCard}>
              <span className={styles.significanceBg}>
                <span className="material-symbols-outlined">auto_awesome</span>
              </span>
              <div className={styles.significanceLabel}>
                <span className={`material-symbols-outlined ${styles.significanceLabelIcon}`}>
                  stars
                </span>
                Significance
              </div>
              <p className={styles.significanceText}>"{c.significance}"</p>
              <span className={styles.keyPrecedentTag}>Key Precedent</span>
            </div>
          </div>
        </div>

        <div style={{ height: "2rem" }} />
      </div>
    </>
  );
}

// ─── Main ResultsPage ─────────────────────────────────────────────────────────
export default function ResultsPage() {
  const {
    appState,
    query,
    listItems,
    hasMore,
    selectedCase,
    previewLoading,
    pinnedCases,
    refineSearch,
    loadMore,
    selectJudgment,
    togglePin,
  } = useJDSearch();

  const [sidebarQuery, setSidebarQuery] = useState(query);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setSidebarQuery(query);
  }, [query]);

  const handleRefine = () => {
    if (sidebarQuery.trim()) refineSearch(sidebarQuery.trim());
  };

  const handleTextareaKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleRefine();
    }
  };

  const isReloading = appState === "reloading";
  const isLoadingMore = appState === "loadingMore";

  return (
    <div className={styles.page}>
      {/* Filter bar */}
      <div className={styles.filterBar}>
        <div className={styles.filterGroup}>
          {["Jurisdiction", "Year: 2023", "Status", "Area"].map((label) => (
            <button key={label} className={styles.filterChip}>
              <span>{label}</span>
              <span className={`material-symbols-outlined ${styles.filterChipIcon}`}>
                expand_more
              </span>
            </button>
          ))}
        </div>
        <div className={styles.divider} />
        <button className={styles.clearBtn}>Clear Filters</button>
      </div>

      <main className={styles.main}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarSearch}>
            <span className={styles.sidebarSearchLabel}>Context Search</span>
            <div className={styles.sidebarSearchBox}>
              <textarea
                ref={textareaRef}
                className={styles.sidebarTextarea}
                value={sidebarQuery}
                onChange={(e) => setSidebarQuery(e.target.value)}
                onKeyDown={handleTextareaKey}
                placeholder="Refine your search…"
                rows={1}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${el.scrollHeight}px`;
                }}
              />
              <button className={styles.sidebarSearchSubmit} onClick={handleRefine}>
                <span className={`material-symbols-outlined ${styles.sidebarSearchSubmitIcon}`}>
                  arrow_upward
                </span>
              </button>
            </div>
          </div>

          <div className={styles.resultsMeta}>
            <span className={styles.resultsCount}>{listItems.length} Results Found</span>
            <button className={styles.sortBtn}>
              <span className={`material-symbols-outlined ${styles.sortIcon}`}>sort</span>
              Relevance
            </button>
          </div>

          {/* Scrollable list area */}
          <div className={styles.resultsList}>
            {isReloading ? (
              Array.from({ length: 5 }).map((_, i) => <ResultSkeleton key={i} />)
            ) : (
              <>
                {listItems.map((item) => (
                  <ResultCard
                    key={item.judgement_db_id}
                    item={item}
                    active={selectedCase?.id === item.judgement_db_id}
                    pinned={pinnedCases.includes(item.judgement_db_id)}
                    onSelect={() => selectJudgment(item)}
                    onPin={(e) => {
                      e.stopPropagation();
                      togglePin(item.judgement_db_id);
                    }}
                  />
                ))}

                {/* Loading more skeletons inline */}
                {isLoadingMore &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <ResultSkeleton key={`lm-${i}`} />
                  ))}

                {/* Load more button */}
                {hasMore && !isLoadingMore && (
                  <button className={styles.loadMoreBtn} onClick={loadMore}>
                    <span className={`material-symbols-outlined ${styles.loadMoreIcon}`}>
                      expand_more
                    </span>
                    Load more results
                  </button>
                )}

                {/* End of list */}
                {!hasMore && listItems.length > 0 && (
                  <p className={styles.endOfList}>— All results loaded —</p>
                )}
              </>
            )}
          </div>
        </aside>

        {/* Preview panel */}
        <section className={styles.preview}>
          {previewLoading ? (
            <PreviewSkeleton />
          ) : selectedCase ? (
            <CasePreview
              c={selectedCase}
              pinned={pinnedCases.includes(selectedCase.id)}
              onPin={() => togglePin(selectedCase.id)}
            />
          ) : (
            <PreviewPlaceholder />
          )}
        </section>
      </main>
    </div>
  );
}