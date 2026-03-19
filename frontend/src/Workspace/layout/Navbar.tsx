'use client';

import { useTabCtx } from "../contexts/tab.context";
import styles from "./Navbar.module.css";

export default function Navbar() {
  const { activeTab, setActiveTab, isLeftPanelOpen, setIsLeftPanelOpen } = useTabCtx(); 

  return (
    <header className={styles.header}>
      
      <nav className={styles.nav}>
        <button
        className={`${styles.sidebarToggle} ${isLeftPanelOpen ? styles.sidebarToggleActive : ""}`}
        onClick={() => setIsLeftPanelOpen(!isLeftPanelOpen)}
        title="Toggle sidebar"
        aria-label="Toggle sidebar"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <polyline points="15 9 18 12 15 15" />
        </svg>
      </button>
        <button
          className={`${styles.navItem} ${
            activeTab === "judgement_search" ? styles.active : ""
          }`}
          onClick={() => setActiveTab("judgement_search")}
        >
          Judgement Search
        </button>

        <button
          className={`${styles.navItem} ${
            activeTab === "law_search" ? styles.active : ""
          }`}
          onClick={() => setActiveTab("law_search")}
        >
          Law Search
        </button>

        <button
          className={`${styles.navItem} ${
            activeTab === "judgement_analyzer" ? styles.active : ""
          }`}
          onClick={() => setActiveTab("judgement_analyzer")}
        >
          Judgement Analyser
        </button>

        <button
          className={`${styles.navItem} ${
            activeTab === "draft_space" ? styles.active : ""
          }`}
          onClick={() => setActiveTab("draft_space")}
        >
          Draftspace
        </button>
      </nav>
    </header>
  );
}
