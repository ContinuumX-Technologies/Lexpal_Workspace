import { useDraftspace } from "./Draftspace.context";
import type { RightPanelTab } from "./Draftspace.context";
import { NavBar } from "@/components/ui/tubelight-navbar";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    ArrowLeft,
    Check,
    FileText,
    History,
    LayoutTemplate,
    MessageSquare,
} from "lucide-react";
import { useDraftStore } from "./store/draftStore";
import styles from "./TopBar.module.css";

const ACTIVE_TAB_LABEL: Record<RightPanelTab, string> = {
    "ai-task-manager": "Draft Agent",
    "placeholders": "Placeholders",
    "format-builder": "Format Builder",
    "comments": "Comments",
    "activity": "Activity",
};

export default function TopBar() {
    const { activeTab, setActiveTab } = useDraftspace();
    const { activeDraftId, drafts } = useDraftStore();
    const navigate = useNavigate();
    const currentDraft = drafts[activeDraftId];
    const lastActivity = currentDraft?.activityLog?.[0];
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);

    const lastActivityText = useMemo(() => {
        if (!lastActivity) return "Not saved yet";
        const activityTime = new Date(lastActivity.timestamp).getTime();
        return `Last saved ${formatTimeAgo(activityTime, now)}`;
    }, [lastActivity, now]);

    const navItems = [
        { name: "Draft Agent", icon: MessageSquare, onClick: () => setActiveTab("ai-task-manager") },
        { name: "Placeholders", icon: FileText, onClick: () => setActiveTab("placeholders") },
        { name: "Format Builder", icon: LayoutTemplate, onClick: () => setActiveTab("format-builder") },
        { name: "Comments", icon: MessageSquare, onClick: () => setActiveTab("comments") },
        { name: "Activity", icon: History, onClick: () => setActiveTab("activity") },
    ];

    const handleBack = () => {
        if (window.history.length > 1) {
            navigate(-1);
            return;
        }
        navigate("/workspace");
    };

    return (
        <header className={styles.topBar}>
            <button
                type="button"
                className={styles.backButton}
                onClick={handleBack}
                aria-label="Back to drafts"
            >
                <ArrowLeft size={16} />
                <span>Back to Drafts</span>
            </button>

            <div className={styles.leftSection}>
                <div className={styles.titleRow}>
                    <h1 className={styles.draftName}>{currentDraft?.title || "Untitled Draft"}</h1>
                    <span className={styles.draftChip}>Draft</span>
                </div>

                <div className={styles.lastActivityRow}>
                    <span className={styles.lastActivityIcon}>
                        <Check size={12} strokeWidth={3} />
                    </span>
                    <p className={styles.lastActivity}>{lastActivityText}</p>
                </div>
            </div>

            <div className={styles.navSection}>
                <NavBar
                    items={navItems}
                    activeTab={ACTIVE_TAB_LABEL[activeTab]}
                    className={styles.navWrap}
                />
            </div>
        </header>
    );
}

function formatTimeAgo(timestamp: number, now: number): string {
    const diff = now - timestamp;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}
