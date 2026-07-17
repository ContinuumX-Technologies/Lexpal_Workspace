import { SquarePen } from "lucide-react";
import styles from "./Sidebar.module.css";
import { NEW_CONVERSATION_ID, useSidebar } from "../context/SidebarContext";




export default function Sidebar() {
  
  
  
  const {
    activeConvoId,
    
    openConversation,

    isSidebarOpen,
    toggleSidebar,

    conversations,
    conversationsLoading,
    conversationsError,
  } = useSidebar();




  //to show thin sidebar column when sidebar is closed
  // if (!isSidebarOpen) {
  //   return (
  //     <aside className={`${styles.sidebar} ${styles.miniSidebar}`}>
  //       <div className={styles.miniHeader}>
  //         <button
  //           className={styles.miniIconBtn}
  //           onClick={() => activateConversation(NEW_CONVERSATION_ID)}
  //           title="New Chat"
  //         >
  //           <SquarePen size={18} />
  //         </button>
  //       </div>
  //     </aside>
  //   );
  // }






  return (
    <>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTopBar}>
          <button className={styles.newChatBtn} onClick={() => openConversation(NEW_CONVERSATION_ID)}>
            <SquarePen size={15} strokeWidth={2.5} />
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
                        openConversation(convo.id);
                        if (window.innerWidth < 768) {
                          toggleSidebar();
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
        onClick={() => toggleSidebar()}
      />
    </>
  );
}
