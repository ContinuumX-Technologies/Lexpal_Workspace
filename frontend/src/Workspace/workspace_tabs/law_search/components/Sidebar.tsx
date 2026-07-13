import { SquarePen, PlusIcon } from "lucide-react";
import styles from "./Sidebar.module.css";
import { NEW_CONVERSATION_ID, useSidebar } from "../context/SidebarContext";

export default function Sidebar() {
  const {
    activeConvoId,
    setActiveConvoId,
    isSidebarOpen,
    setSidebarOpen,
    conversations,
    conversationsLoading,
    conversationsError,
  } = useSidebar();

  if (!isSidebarOpen) {
    return (
      <aside className={`${styles.sidebar} ${styles.miniSidebar}`}>
        <div className={styles.miniHeader}>
          <button
            className={styles.miniIconBtn}
            onClick={() => setActiveConvoId(NEW_CONVERSATION_ID)}
            title="New Chat"
          >
            <SquarePen size={18} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTopBar}>
          <button className={styles.newChatBtn} onClick={() => setActiveConvoId(NEW_CONVERSATION_ID)}>
            <PlusIcon size={15} strokeWidth={2.5} />
            <span>New Chat</span>
          </button>
        </div>

        <div className={styles.historyList}>
          {conversationsLoading && <div className={styles.loading}>Loading…</div>}

          {!conversationsLoading && conversationsError && (
            <div className={styles.empty}>{conversationsError}</div>
          )}

          {!conversationsLoading && !conversationsError && conversations.length === 0 && (
            <div className={styles.empty}>No conversations yet</div>
          )}

          {!conversationsLoading && !conversationsError && conversations.length > 0 && (
            <>
              <div className={styles.dateGroup}>Recent</div>

              {conversations.map((convo) => {
                const isActive = activeConvoId === convo.id;

                return (
                  <div key={convo.id} className={styles.historyItemWrapper}>
                    <button
                      className={`${styles.historyItem} ${isActive ? styles.active : ""}`}
                      onClick={() => {
                        setActiveConvoId(convo.id);
                        if (window.innerWidth < 768) {
                          setSidebarOpen(false);
                        }
                      }}
                    >
                      <span className={styles.historyItemTitle}>{convo.title || "Untitled Chat"}</span>
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </aside>

      <div
        className={`${styles.mobileOverlay} ${isSidebarOpen ? styles.visible : ""}`}
        onClick={() => setSidebarOpen(false)}
      />
    </>
  );
}
