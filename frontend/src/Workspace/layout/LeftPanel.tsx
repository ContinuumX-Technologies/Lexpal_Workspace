"use client";

import { useTabCtx } from "../contexts/tab.context";
import styles from "./LeftPanel.module.css";

export default function LeftPanel() {
  const { isLeftPanelOpen } = useTabCtx();

  return (
    <aside className={`${styles.leftPanel} ${isLeftPanelOpen ? styles.open : ""}`}>
      <div className={styles.content}>
        {/* -Placeholder content for the left panel
            -access data and make api calls through a draftspace context provider 
            -avoid prop-drilling create call draftspace context consumer functions
        */}
        <h3>Left Panel</h3>
        <p>Your content goes here</p>
      </div>
    </aside>
  );
}
