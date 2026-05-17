"use client";

import { useTabCtx } from "../contexts/tab.context";
import { useJDSearch } from "../workspace_tabs/judgement_search/JDSearch.context";
import { useDraftStore } from "../workspace_tabs/draftspace/store/draftStore";
import { useUserStore } from "../../store/userStore";
import styles from "./LeftPanel.module.css";

export default function LeftPanel() {
  const { isLeftPanelOpen } = useTabCtx();
  const { pinnedCases, togglePin } = useJDSearch();
  const { drafts, activeDraftId, setActiveDraftId, createNewDraft, deleteDraft, assignDraft } = useDraftStore();
  const { availableUsers, currentUser } = useUserStore();

  const handleAssign = (draftId: string, userId: string) => {
    const assignedUser = availableUsers.find(u => u.id === userId);
    assignDraft(draftId, userId, assignedUser?.name || 'Unknown', currentUser.name, currentUser.id);
  };

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
              >
                <div className={styles.pinnedItemMain}>
                  <p className={styles.pinnedItemTitle}>{draft.title}</p>
                  <div className={styles.pinnedItemMeta}>
                    <span className={styles.pinnedItemCourt}>Draft</span>
                    <span className={styles.pinnedItemYear}>
                      {new Date(draft.updatedAt).toLocaleDateString()}
                    </span>
                    {draft.assignedTo && (
                      <span className={styles.assignmentBadge}>
                        Assigned to: {availableUsers.find(u => u.id === draft.assignedTo)?.name.split(" ")[0]}
                      </span>
                    )}
                  </div>
                </div>
                <div className={styles.draftActions}>
                  <select 
                    className={styles.assignSelect}
                    value={draft.assignedTo || ""}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      handleAssign(id, e.target.value);
                    }}
                    title="Assign to collaborator"
                  >
                    <option value="">Assign</option>
                    {availableUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.name.split(" ")[0]}</option>
                    ))}
                  </select>
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
                <div className={styles.draftActions}>
                  <button
                    className={styles.unpinBtn}
                    onClick={() => togglePin(c)}
                    title="Unpin"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
