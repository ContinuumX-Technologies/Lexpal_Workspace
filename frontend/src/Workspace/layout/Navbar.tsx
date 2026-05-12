import { useState, useRef, useEffect } from "react";
import { useTabCtx } from "../contexts/tab.context";
import { useUsageStore } from "../../store/usageStore";
import styles from "./Navbar.module.css";

export default function Navbar() {
  const { activeTab, setActiveTab, isLeftPanelOpen, setIsLeftPanelOpen } = useTabCtx(); 
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const { tokensUsed, tokenLimit, resetUsage } = useUsageStore();

  const handleReset = () => {
    if (window.confirm("Are you sure you want to PERMANENTLY clear all local data? This cannot be undone.")) {
      localStorage.clear();
      resetUsage(); // Ensure store is also reset
      window.location.reload();
    }
  };

  const usagePercent = Math.round((tokensUsed / tokenLimit) * 100);

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
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={styles.toggleIcon}
          >
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M9 3v18" />
            <path d="M14 10l2 2-2 2" />
          </svg>
        </button>

        <button
          className={`${styles.navItem} ${activeTab === "judgement_search" ? styles.active : ""}`}
          onClick={() => setActiveTab("judgement_search")}
        >
          Judgement Search
        </button>

        <button
          className={`${styles.navItem} ${activeTab === "law_search" ? styles.active : ""}`}
          onClick={() => setActiveTab("law_search")}
        >
          Law Search
        </button>

        <button
          className={`${styles.navItem} ${activeTab === "judgement_analyzer" ? styles.active : ""}`}
          onClick={() => setActiveTab("judgement_analyzer")}
        >
          Judgement Analyser
        </button>

        <button
          className={`${styles.navItem} ${activeTab === "draft_space" ? styles.active : ""}`}
          onClick={() => setActiveTab("draft_space")}
        >
          Draftspace
        </button>
      </nav>

      <div className={styles.navRight} ref={dropdownRef}>
        <div className={styles.apiStatus}>
          <span className={styles.statusDot}></span>
          <span className={styles.statusText}>API Online</span>
        </div>

        <button 
          className={styles.profileBtn}
          onClick={() => setIsProfileOpen(!isProfileOpen)}
          aria-label="Profile and Settings"
        >
          <div className={styles.avatar}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
        </button>

        {isProfileOpen && (
          <div className={styles.dropdown}>
            <div className={styles.dropdownHeader}>
              <p className={styles.userName}>Yash Behera</p>
              <p className={styles.userPlan}>Founder & Expert Plan</p>
            </div>

            <div className={styles.usageSection}>
              <div className={styles.usageLabel}>
                <span>Token Usage</span>
                <span>{usagePercent}%</span>
              </div>
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${usagePercent}%` }}></div>
              </div>
              <p className={styles.usageDetail}>{tokensUsed.toLocaleString()} / {tokenLimit.toLocaleString()} monthly tokens</p>
            </div>

            <div className={styles.dropdownDivider}></div>

            <button className={styles.dropdownItem}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
              Settings
            </button>

            <button className={styles.dropdownItem}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export Drafts
            </button>

            <div className={styles.dropdownDivider}></div>

            <button className={`${styles.dropdownItem} ${styles.danger}`} onClick={handleReset}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              Reset All Data
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
