import { useState, useRef } from "react";
import styles from "./ChatInput.module.css";
import ContextPicker from "./ContextPicker";
import { Brain } from "lucide-react";
import {
    formatFileSize,
    useLawSearchAttachments,
} from "../context/attachments.context";

interface ChatInputProps {
    onSendMessage: (
        message: string
    ) => Promise<boolean>;
    onStop: () => void;
    isProcessing: boolean;
    disabled?: boolean;
    placeholder?: string;
    chatMode: "basic_chat" | "reasoning_chat";
    onToggleChatMode: () => void;
}

export default function ChatInput({
    onSendMessage,
    onStop,
    isProcessing,
    disabled,
    placeholder,
    chatMode,
    onToggleChatMode,
}: ChatInputProps) {
    const [input, setInput] = useState("");
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const {
        selectedAttachments,
        removeSelectedAttachment,
        canSendWithAttachments,
        attachmentError,
        clearAttachmentError,
    } = useLawSearchAttachments();

    const reasoningMode = chatMode === "reasoning_chat";

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (isProcessing) return;
            handleSend();
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
        }
    };

    const handleSend = () => {
        if (
            !input.trim() ||
            disabled ||
            isProcessing ||
            !canSendWithAttachments
        ) {
            return;
        }

        onSendMessage(input).then((sent) => {
            if (sent) {
                setInput("");
                setIsPickerOpen(false);
                if (textareaRef.current) {
                    textareaRef.current.style.height = 'auto';
                }
            }
        });
    };

    return (
        <div className={styles.container}>
            {isPickerOpen && (
                <ContextPicker onClose={() => setIsPickerOpen(false)} />
            )}

            <div className={styles.inputWrapper}>
                {/* Refined Spinning Glow Effect */}
                <div className={styles.glowRing} />

                <div className={styles.contentWrapper}>
                    {selectedAttachments.length > 0 && (
                        <div className={styles.contextChips}>
                            {selectedAttachments.map((ctx) => (
                                <div key={ctx.id} className={styles.chip}>
                                    {ctx.parse_status === "parsing" ? (
                                        <span className={styles.spinner} />
                                    ) : (
                                        <span className="material-symbols-outlined chipIcon">
                                            description
                                        </span>
                                    )}

                                    <span className={styles.chipName}>
                                        {ctx.file_name}
                                    </span>

                                    <span
                                        className={`${styles.chipInfo} ${
                                            ctx.parse_status === "error" ? styles.chipError : ""
                                        }`}
                                    >
                                        {ctx.parse_status === "error"
                                            ? "Parse failed"
                                            : ctx.parse_status === "parsing"
                                            ? "Parsing..."
                                            : formatFileSize(ctx.size)}
                                    </span>

                                    <button
                                        onClick={() => removeSelectedAttachment(ctx.id)}
                                        className={styles.removeChip}
                                    >
                                        <span className="material-symbols-outlined">close</span>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {attachmentError && (
                        <div className={styles.attachmentError}>
                            {attachmentError}
                        </div>
                    )}

                    <textarea
                        ref={textareaRef}
                        rows={1}
                        value={input}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder || "Ask legal question..."}
                        className={styles.input}
                        disabled={disabled && !isProcessing}
                    />

                    <div className={styles.actionRow}>
                        <div className={styles.leftActions}>
                            <button
                                className={styles.iconBtn}
                                onClick={() => {
                                    clearAttachmentError();
                                    setIsPickerOpen(!isPickerOpen);
                                }}
                                title="Attach File"
                                disabled={isProcessing}
                            >
                                <span className="material-symbols-outlined">attach_file</span>
                            </button>

                            <button
                                className={styles.iconBtn}
                                title="Search the Web"
                                disabled={isProcessing}
                            >
                                {/* Subtle and classy web search icon */}
                                <span className="material-symbols-outlined">language</span>
                            </button>
                        </div>

                        <div className={styles.rightActions}>
                            <button
                                className={`${styles.reasoningBtn} ${
                                    reasoningMode ? styles.reasoningActive : ""
                                }`}
                                onClick={onToggleChatMode}
                                title={reasoningMode ? "Reasoning on — click to disable" : "Enable reasoning mode"}
                                disabled={isProcessing}
                            >
                                <Brain size={16} strokeWidth={reasoningMode ? 2.2 : 1.8} />
                            </button>

                            {isProcessing ? (
                                <button
                                    className={styles.stopBtn}
                                    onClick={onStop}
                                    title="Stop Generating"
                                >
                                    <span className="material-symbols-outlined">stop</span>
                                </button>
                            ) : (
                                <button
                                    className={styles.sendBtn}
                                    onClick={handleSend}
                                    disabled={
                                        disabled ||
                                        !input.trim() ||
                                        !canSendWithAttachments
                                    }
                                    title={
                                        canSendWithAttachments
                                            ? "Send"
                                            : "Wait for attachments to finish parsing or remove failed files"
                                    }
                                >
                                    <span className="material-symbols-outlined">arrow_upward</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className={styles.footerNote}>
                Lexpal AI can make mistakes. Please verify important information.
            </div>
        </div>
    );
}