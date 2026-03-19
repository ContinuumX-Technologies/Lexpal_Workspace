import { useDraftspace } from "../Draftspace.context";
import type { RightPanelTab } from "../Draftspace.context";
import AiChat from "./AiChat";
import Placeholders from "./Placeholders";
import FormatBuilderTab from "./FormatBuilderTab";// <-- import tree instead of FormatBuilder
import styles from "./RightPanel.module.css";

const TABS: { id: RightPanelTab; label: string }[] = [
    { id: "ai-chat", label: "AI Chat" },
    { id: "placeholders", label: "Placeholders" },
    { id: "format-builder", label: "Format Builder" },
];

export default function RightPanel() {
    const { activeTab, setActiveTab } = useDraftspace();

    return (
        <div className={styles.panel}>
            {/* Tab bar */}
            <div className={styles.tabBar}>
                {TABS.map(({ id, label }) => (
                    <button
                        key={id}
                        className={`${styles.tab} ${activeTab === id ? styles.tabActive : ""}`}
                        onClick={() => setActiveTab(id)}
                    >
                        {label}
                    </button>
                ))}
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