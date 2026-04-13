import { useDraftspace } from "../Draftspace.context";
import type { RightPanelTab } from "../Draftspace.context";
import AiChat from "./AiChat";
import Placeholders from "./Placeholders";
import FormatBuilderTab from "./FormatBuilderTab";
import { NavBar } from "@/components/ui/tubelight-navbar";
import { MessageSquare, FileText, LayoutTemplate } from "lucide-react";
import styles from "./RightPanel.module.css";

const ACTIVE_TAB_LABEL: Record<RightPanelTab, string> = {
    "ai-chat": "AI Chat",
    "placeholders": "Placeholders",
    "format-builder": "Format Builder",
};

export default function RightPanel() {
    const { activeTab, setActiveTab } = useDraftspace();

    const navItems = [
        { name: "AI Chat", icon: MessageSquare, onClick: () => setActiveTab("ai-chat") },
        { name: "Placeholders", icon: FileText, onClick: () => setActiveTab("placeholders") },
        { name: "Format Builder", icon: LayoutTemplate, onClick: () => setActiveTab("format-builder") },
    ];

    return (
        <div className={styles.panel}>
            {/* Tubelight Tab Bar */}
            <div className={styles.tabBar}>
                <NavBar
                    items={navItems}
                    activeTab={ACTIVE_TAB_LABEL[activeTab]}
                />
            </div>

            {/* Tab content */}
            <div className={styles.content}>
                {activeTab === "ai-chat" && <AiChat />}
                {activeTab === "placeholders" && <Placeholders />}
                {activeTab === "format-builder" && <FormatBuilderTab />}
            </div>
        </div>
    );
}