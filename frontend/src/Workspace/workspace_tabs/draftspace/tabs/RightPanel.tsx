import { useDraftspace } from "../Draftspace.context";
import type { RightPanelTab } from "../Draftspace.context";
import { Download, MoreVertical, Share2 } from "lucide-react";
import AiChat from "./AiChat";
import Placeholders from "./Placeholders";
import FormatBuilderTab from "./FormatBuilderTab";
import CommentsTab from "./CommentsTab";
import ActivityTab from "./ActivityTab";
import styles from "./RightPanel.module.css";

const PANEL_TITLES: Record<RightPanelTab, string> = {
    "ai-chat": "AI Chat",
    "placeholders": "Placeholders",
    "format-builder": "Format Builder",
    "comments": "Comments",
    "activity": "Activity",
};

function renderTabContent(activeTab: RightPanelTab) {
    if (activeTab === "ai-chat") return <AiChat />;
    if (activeTab === "placeholders") return <Placeholders />;
    if (activeTab === "format-builder") return <FormatBuilderTab />;
    if (activeTab === "comments") return <CommentsTab />;
    return <ActivityTab />;
}

export default function RightPanel() {
    const { activeTab } = useDraftspace();

    return (
        <aside className={styles.panel} aria-label="Draft side panel">
            <div className={styles.panelCard}>
                <div className={styles.panelToolbar}>
                    <span className={styles.panelTitle}>{PANEL_TITLES[activeTab]}</span>

                    <div className={styles.toolbarGroup}>
                        <button type="button" className={styles.actionButton} aria-label="Share draft">
                            <Share2 size={14} />
                            <span>Share</span>
                        </button>
                        <button type="button" className={`${styles.actionButton} ${styles.primaryActionButton}`} aria-label="Download draft">
                            <Download size={14} />
                            <span>Download</span>
                        </button>
                    </div>

                    <button type="button" className={styles.iconButton} aria-label="More actions">
                        <MoreVertical size={16} />
                    </button>
                </div>

                <div className={styles.content}>
                    {renderTabContent(activeTab)}
                </div>
            </div>
        </aside>
    );
}