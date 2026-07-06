import styles from "./AttachmentManager.module.css";
import { useRef, useState } from "react";
import {
    useUploadedFiles,
    type UploadedFileMeta,
} from "../../Workspace/contexts/upload_files.context";

import type { SelectedAttachment } from "./ai-prompt-box";


// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};


// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface AttachmentManagerProps {
    onToggleFileSelection: (file: UploadedFileMeta) => void;
    selectedAttachments: SelectedAttachment[];
    /**
     * Maximum number of files that can be attached at once.
     * When the user tries to select beyond this limit an inline error is shown.
     */
    maxAttachments: number;
    onClose: () => void;
}


// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function AttachmentManager({
    onToggleFileSelection,
    selectedAttachments,
    maxAttachments,
    onClose,
}: AttachmentManagerProps) {
    const { uploaded_files, uploadFile } = useUploadedFiles();

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);
    // Shown when the user tries to select more files than maxAttachments
    const [limitError, setLimitError] = useState<string | null>(null);

    const selectedMap = new Map(
        selectedAttachments.map((item) => [item.id, item])
    );

    const sortedFiles = [...uploaded_files].sort(
        (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const handleUploadClick = () => {
        setUploadError(null);
        setLimitError(null);
        fileInputRef.current?.click();
    };

    const handleInputChange = async (
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        const files = Array.from(event.target.files || []);
        if (files.length === 0) return;

        setUploadError(null);
        setLimitError(null);

        // How many slots are still open?
        const currentlySelected = selectedAttachments.length;
        const available = maxAttachments - currentlySelected;

        if (available <= 0) {
            setLimitError(
                `You can attach at most ${maxAttachments} file${maxAttachments === 1 ? "" : "s"}.`
            );
            event.target.value = "";
            return;
        }

        // Only upload as many as the remaining slots allow
        const filesToProcess = files.slice(0, available);
        if (files.length > available) {
            setLimitError(
                `Only ${available} more file${available === 1 ? "" : "s"} can be attached (max ${maxAttachments}).`
            );
        }

        for (const file of filesToProcess) {
            const result = await uploadFile(file);
            if (!result.success) {
                setUploadError(result.error);
                continue;
            }
            onToggleFileSelection(result.file);
        }

        event.target.value = "";
    };

    const handleSelect = (item: UploadedFileMeta) => {
        setUploadError(null);

        const alreadySelected = selectedMap.has(item.id);

        if (!alreadySelected && selectedAttachments.length >= maxAttachments) {
            // User is trying to add beyond the cap — show limit error and bail
            setLimitError(
                `You can attach at most ${maxAttachments} file${maxAttachments === 1 ? "" : "s"}.`
            );
            return;
        }

        // Clear limit error when deselecting or when safely within cap
        setLimitError(null);
        onToggleFileSelection(item);
    };

    return (
        <div className={styles.popover}>
            <div className={styles.header}>
                <span className={styles.title}>Attach Files</span>
                <button className={styles.closeBtn} onClick={onClose}>
                    <span className="material-symbols-outlined">close</span>
                </button>
            </div>

            <div className={styles.list}>
                {sortedFiles.length === 0 && (
                    <div className={styles.loading}>No uploaded files yet.</div>
                )}

                {sortedFiles.map((item) => {
                    const selectedState = selectedMap.get(item.id);
                    const selected = !!selectedState;
                    const isParsing = selectedState?.parse_status === "parsing";
                    const hasError = selectedState?.parse_status === "error";
                    // Dim non-selected items when the cap is reached to signal they're unavailable
                    const atLimit = !selected && selectedAttachments.length >= maxAttachments;

                    return (
                        <button
                            key={item.id}
                            className={`${styles.item} ${selected ? styles.itemSelected : ""} ${atLimit ? styles.itemDisabled ?? "" : ""}`}
                            onClick={() => handleSelect(item)}
                            title={
                                atLimit
                                    ? `Max ${maxAttachments} attachments reached`
                                    : selectedState?.error || item.name
                            }
                            aria-disabled={atLimit}
                        >
                            <div className={styles.iconWrap}>
                                {isParsing ? (
                                    <span className={styles.spinner} />
                                ) : (
                                    <span className="material-symbols-outlined">description</span>
                                )}
                            </div>

                            <div className={styles.itemMeta}>
                                <span className={styles.itemName}>{item.name}</span>
                                <span
                                    className={`${styles.itemInfo} ${hasError ? styles.itemError : ""}`}
                                >
                                    {hasError
                                        ? selectedState?.error
                                        : formatFileSize(item.size)}
                                </span>
                            </div>

                            {selected ? (
                                <span className="material-symbols-outlined addIcon">
                                    check_circle
                                </span>
                            ) : (
                                <span className="material-symbols-outlined addIcon">
                                    add_circle
                                </span>
                            )}
                        </button>
                    );
                })}

                {/* Error area — limit errors take precedence over upload errors */}
                {(limitError || uploadError) && (
                    <div className={styles.errorText}>
                        {limitError || uploadError}
                    </div>
                )}

                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    multiple
                    className={styles.fileInput}
                    onChange={handleInputChange}
                />

                <button className={styles.uploadArea} onClick={handleUploadClick}>
                    <span className="material-symbols-outlined">upload_file</span>
                    <span>Upload new file</span>
                </button>
            </div>
        </div>
    );
}