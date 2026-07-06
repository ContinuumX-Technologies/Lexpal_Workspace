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

    const handleKeyDown = (
        e: React.KeyboardEvent
    ) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();

            if (isProcessing) return;

            handleSend();
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
            }
        });
    };

    return (
        <div className={styles.container}>
            {isPickerOpen && (
                <ContextPicker
                    onClose={() =>
                        setIsPickerOpen(false)
                    }
                />
            )}

            <div className={styles.inputWrapper}>
                {selectedAttachments.length > 0 && (
                    <div
                        className={
                            styles.contextChips
                        }
                    >
                        {selectedAttachments.map(
                            (ctx) => (
                                <div
                                    key={ctx.id}
                                    className={
                                        styles.chip
                                    }
                                >
                                    {ctx.parse_status ===
                                    "parsing" ? (
                                        <span
                                            className={
                                                styles.spinner
                                            }
                                        />
                                    ) : (
                                        <span className="material-symbols-outlined chipIcon">
                                            description
                                        </span>
                                    )}

                                    <span
                                        className={
                                            styles.chipName
                                        }
                                    >
                                        {ctx.file_name}
                                    </span>

                                    <span
                                        className={`${
                                            styles.chipInfo
                                        } ${
                                            ctx.parse_status ===
                                            "error"
                                                ? styles.chipError
                                                : ""
                                        }`}
                                    >
                                        {ctx.parse_status ===
                                        "error"
                                            ? "Parse failed"
                                            : ctx.parse_status ===
                                              "parsing"
                                            ? "Parsing..."
                                            : formatFileSize(
                                                  ctx.size
                                              )}
                                    </span>

                                    <button
                                        onClick={() =>
                                            removeSelectedAttachment(
                                                ctx.id
                                            )
                                        }
                                        className={
                                            styles.removeChip
                                        }
                                    >
                                        <span className="material-symbols-outlined">
                                            close
                                        </span>
                                    </button>
                                </div>
                            )
                        )}
                    </div>
                )}

                {attachmentError && (
                    <div className={styles.attachmentError}>
                        {attachmentError}
                    </div>
                )}

                <div className={styles.inputRow}>
                    <button
                        className={styles.attachBtn}
                        onClick={() => {
                            clearAttachmentError();
                            setIsPickerOpen(
                                !isPickerOpen
                            );
                        }}
                        title="Attach File"
                        disabled={isProcessing}
                    >
                        <span className="material-symbols-outlined">
                            attach_file
                        </span>
                    </button>

                    <textarea
                        ref={textareaRef}
                        rows={1}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder || "Ask legal question..."}
                        className={styles.input}
                        disabled={disabled && !isProcessing}
                    />

                    {/* Reasoning Mode Toggle */}
                    <button
                        className={`${styles.reasoningBtn} ${
                            reasoningMode ? styles.reasoningActive : ""
                        }`}
                        onClick={onToggleChatMode}
                        title={reasoningMode ? "Reasoning on — click to disable" : "Enable reasoning mode"}
                        disabled={isProcessing}
                    >
                        <Brain size={15} strokeWidth={reasoningMode ? 2.2 : 1.8} />
                        <span className={styles.reasoningLabel}>Reasoning</span>
                    </button>

                    {isProcessing ? (
                        <button
                            className={styles.stopBtn}
                            onClick={onStop}
                            title="Stop Generating"
                        >
                            <span className="material-symbols-outlined">
                                stop
                            </span>
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
                            <span className="material-symbols-outlined">
                                arrow_upward
                            </span>
                        </button>
                    )}
                </div>
            </div>

            <div className={styles.footerNote}>
                Lexpal AI can make mistakes.
                Please verify important
                information.
            </div>
        </div>
    );
}
