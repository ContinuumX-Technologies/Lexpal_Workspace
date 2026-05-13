"use client";

import { useTabCtx } from "../contexts/tab.context";
import { useJDSearch } from "../workspace_tabs/judgement_search/JDSearch.context";
import { useDraftStore } from "../workspace_tabs/draftspace/store/draftStore";
import styles from "./LeftPanel.module.css";

export default function LeftPanel() {
  const { isLeftPanelOpen } = useTabCtx();
  const { pinnedCases, togglePin } = useJDSearch();
  const { drafts, activeDraftId, setActiveDraftId, createNewDraft, deleteDraft } = useDraftStore();

  const draftEntries = Object.entries(drafts).sort((a, b) => {
    return new Date(b[1].updatedAt).getTime() - new Date(a[1].updatedAt).getTime();
  });

  return (
    <aside className={`${styles.leftPanel} ${isLeftPanelOpen ? styles.open : ""}`}>
      <div className={styles.content}>
        
        <div className={styles.sectionHeader}>
          <h3>Saved Drafts</h3>
          <button 
            className={styles.newDraftBtn} 
            onClick={() => createNewDraft("Untitled Draft")}
            title="New Draft"
          >
            <span className="material-symbols-outlined">add</span>
          </button>
        </div>

        {draftEntries.length === 0 ? (
          <p>No drafts yet.</p>
        ) : (
          <div className={styles.pinnedList}>
            {draftEntries.map(([id, draft]) => (
              <div 
                key={id} 
                className={`${styles.pinnedItem} ${id === activeDraftId ? styles.activeDraft : ""}`}
                onClick={() => setActiveDraftId(id)}
                style={{ cursor: 'pointer' }}
              >
                <div className={styles.pinnedItemMain}>
                  <p className={styles.pinnedItemTitle}>{draft.title}</p>
                  <div className={styles.pinnedItemMeta}>
                    <span className={styles.pinnedItemCourt}>Draft</span>
                    <span className={styles.pinnedItemYear}>
                      {new Date(draft.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <button
                  className={styles.unpinBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteDraft(id);
                  }}
                  title="Delete Draft"
                >
                  <span className="material-symbols-outlined">delete</span>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={styles.divider} />

        <div className={styles.sectionHeader}>
          <h3>Pinned Cases</h3>
        </div>
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
