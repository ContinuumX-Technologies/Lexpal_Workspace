import { useEffect, useState, useMemo, useRef } from "react";
import styles from "./Sidebar.module.css";
import {
    SquarePen,
    Check,
    X,
    Trash2,
    MoreHorizontal,
    Pencil,
    PlusIcon,
} from "lucide-react";
import { getRelativeDateLabel } from "../utils/util_funcs";
import { useSidebar } from "../context/SidebarContext";



interface Conversation {
    _id: string;
    title: string | null;
    description: string;
    timestamp: Date | string;
}




export default function Sidebar() {

    const {
        currentConvoId,
        setCurrentConvoId,
        isSidebarOpen,
        setSidebarOpen,
    } = useSidebar();

    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(false);

    const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const menuRef = useRef<HTMLDivElement>(null);

    const server_url = import.meta.env.VITE_SERVER_URL;

    const fetchRecentConvos = async () => {
        setLoading(true);
        try {
            const res = await fetch(
                `${server_url}/api/AI/recent-conversation`,
                {
                    method: "GET",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                }
            );
            if (!res.ok) return;
            const data = await res.json();
            setConversations(data.conversations);
        } catch (err) {
            console.error("Failed to fetch conversations", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRecentConvos();

        const handleClickOutside = (event: MouseEvent) => {
            if (
                menuRef.current &&
                !menuRef.current.contains(event.target as Node)
            ) {
                setActiveMenuId(null);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);


    const handleMenuOpen = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setActiveMenuId(activeMenuId === id ? null : id);
    };

    const handleStartRename = (e: React.MouseEvent, convo: Conversation) => {
        e.stopPropagation();
        setRenamingId(convo._id);
        setRenameValue(convo.title || "Untitled Chat");
        setActiveMenuId(null);
    };

    const handleSubmitRename = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!renamingId) return;

        setConversations((prev) =>
            prev.map((c) =>
                c._id === renamingId ? { ...c, title: renameValue } : c
            )
        );

        try {
            await fetch(
                `${server_url}/api/AI/conversation/${renamingId}`,
                {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ title: renameValue }),
                }
            );
        } catch (err) {
            console.error("Rename failed", err);
            fetchRecentConvos();
        }

        setRenamingId(null);
    };

    const handleStartDelete = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setDeletingId(id);
        setActiveMenuId(null);
    };

    const confirmDelete = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setDeletingId(null);
        setConversations((prev) => prev.filter((c) => c._id !== id));

        try {
            await fetch(
                `${server_url}/api/AI/conversation/${id}`,
                { method: "DELETE", credentials: "include" }
            );
            if (currentConvoId === id) {
                setCurrentConvoId("new");
            }
        } catch (err) {
            console.error("Failed to delete", err);
            fetchRecentConvos();
        }
    };

    const groupedConversations = useMemo(() => {
        const groups: Record<string, Conversation[]> = {};

        const sorted = [...conversations].sort(
            (a, b) =>
                new Date(b.timestamp).getTime() -
                new Date(a.timestamp).getTime()
        );

        sorted.forEach((convo) => {
            const label = getRelativeDateLabel(convo.timestamp);
            if (!groups[label]) groups[label] = [];
            groups[label].push(convo);
        });

        const order = ["Today", "Yesterday", "Previous 7 Days", "Previous 30 Days"];
        Object.keys(groups).forEach((key) => {
            if (!order.includes(key)) order.push(key);
        });

        return order
            .filter((key) => groups[key] && groups[key].length > 0)
            .map((key) => ({ label: key, items: groups[key] }));
    }, [conversations]);


    // Mini (collapsed) sidebar
    if (!isSidebarOpen) {
        return (
            <aside className={`${styles.sidebar} ${styles.miniSidebar}`}>
                <div className={styles.miniHeader}>
                    <button
                        className={styles.miniIconBtn}
                        onClick={() => setCurrentConvoId("new")}
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
                {/* New Chat Button */}
                <div className={styles.sidebarTopBar}>
                    <button
                        className={styles.newChatBtn}
                        onClick={() => setCurrentConvoId("new")}
                    >
                        <PlusIcon size={15} strokeWidth={2.5} />
                        <span>New Chat</span>
                    </button>
                </div>

                {/* Conversation History */}
                <div className={styles.historyList}>
                    {loading && (
                        <div className={styles.loading}>Loading…</div>
                    )}

                    {!loading && conversations.length === 0 && (
                        <div className={styles.empty}>No recent chats</div>
                    )}

                    {!loading &&
                        groupedConversations.map((group) => (
                            <div key={group.label}>
                                <div className={styles.dateGroup}>
                                    {group.label}
                                </div>

                                {group.items.map((convo) => {
                                    const isActive = currentConvoId === convo._id;
                                    const isRenaming = renamingId === convo._id;
                                    const isDeleting = deletingId === convo._id;
                                    const isMenuOpen = activeMenuId === convo._id;

                                    return (
                                        <div
                                            key={convo._id}
                                            className={styles.historyItemWrapper}
                                        >
                                            {isDeleting ? (
                                                <div className={styles.deleteConfirm}>
                                                    <span className={styles.deleteLabel}>Delete?</span>
                                                    <button
                                                        className={styles.confirmIconBtn}
                                                        onClick={(e) => confirmDelete(e, convo._id)}
                                                        title="Confirm delete"
                                                    >
                                                        <Check size={14} />
                                                    </button>
                                                    <button
                                                        className={styles.cancelIconBtn}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setDeletingId(null);
                                                        }}
                                                        title="Cancel"
                                                    >
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            ) : isRenaming ? (
                                                <div className={styles.historyItem}>
                                                    <form
                                                        onSubmit={handleSubmitRename}
                                                        style={{ width: "100%" }}
                                                    >
                                                        <input
                                                            className={styles.renameInput}
                                                            autoFocus
                                                            value={renameValue}
                                                            onChange={(e) => setRenameValue(e.target.value)}
                                                            onBlur={() => handleSubmitRename()}
                                                            onKeyDown={(e) => {
                                                                if (e.key === "Escape") setRenamingId(null);
                                                            }}
                                                        />
                                                    </form>
                                                </div>
                                            ) : (
                                                <>
                                                    <button
                                                        className={`${styles.historyItem} ${isActive ? styles.active : ""}`}
                                                        onClick={() => {
                                                            setCurrentConvoId(convo._id);
                                                            if (window.innerWidth < 768) setSidebarOpen(false);
                                                        }}
                                                    >
                                                        <span className={styles.historyItemTitle}>
                                                            {convo.title || "Untitled Chat"}
                                                        </span>
                                                    </button>

                                                    <button
                                                        className={styles.itemOptionsBtn}
                                                        onClick={(e) => handleMenuOpen(e, convo._id)}
                                                        title="Options"
                                                    >
                                                        <MoreHorizontal size={14} />
                                                    </button>

                                                    {isMenuOpen && (
                                                        <div
                                                            className={styles.menuPopover}
                                                            ref={menuRef}
                                                        >
                                                            <button
                                                                className={styles.menuItem}
                                                                onClick={(e) => handleStartRename(e, convo)}
                                                            >
                                                                <Pencil size={13} />
                                                                Rename
                                                            </button>

                                                            <button
                                                                className={`${styles.menuItem} ${styles.delete}`}
                                                                onClick={(e) => handleStartDelete(e, convo._id)}
                                                            >
                                                                <Trash2 size={13} />
                                                                Delete
                                                            </button>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                </div>
            </aside>

            <div
                className={`${styles.mobileOverlay} ${isSidebarOpen ? styles.visible : ""}`}
                onClick={() => setSidebarOpen(false)}
            />
        </>
    );
}
