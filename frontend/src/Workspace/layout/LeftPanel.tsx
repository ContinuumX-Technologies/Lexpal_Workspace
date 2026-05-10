"use client";

import { useTabCtx } from "../contexts/tab.context";
import { useJDSearch } from "../workspace_tabs/judgement_search/JDSearch.context";
import styles from "./LeftPanel.module.css";

export default function LeftPanel() {
  const { isLeftPanelOpen } = useTabCtx();
  const { pinnedCases, togglePin } = useJDSearch();

  return (
    <aside className={`${styles.leftPanel} ${isLeftPanelOpen ? styles.open : ""}`}>
      <div className={styles.content}>
        <h3>Pinned Cases</h3>
        {pinnedCases.length === 0 ? (
          <p>No cases pinned yet.</p>
        ) : (
          <div className={styles.pinnedList}>
            {pinnedCases.map((c) => (
              <div key={c.id} className={styles.pinnedItem}>
                <div className={styles.pinnedItemMain}>
                  <p className={styles.pinnedItemTitle}>{c.title}</p>
                  <div className={styles.pinnedItemMeta}>
                    <span className={styles.pinnedItemCourt}>{c.court}</span>
                    <span className={styles.pinnedItemYear}>{c.year}</span>
                  </div>
                </div>
                <button
                  className={styles.unpinBtn}
                  onClick={() => togglePin(c)}
                  title="Unpin"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
