import styles from "./ContextPicker.module.css";
import {
    useRef,
    useState,
} from "react";
import {
    useUploadedFiles,
    type UploadedFileMeta,
} from "../../../contexts/upload_files.context";
import {
    formatFileSize,
    useLawSearchAttachments,
} from "../context/attachments.context";

interface ContextPickerProps {
    onClose: () => void;
}
export default function ContextPicker({
    onClose,
}: ContextPickerProps) {
    const {
        uploaded_files,
        uploadFile,
    } = useUploadedFiles();

    const {
        selectUploadedFile,
        selectedAttachmentIds,
        selectedAttachments,
        attachmentError,
        clearAttachmentError,
    } = useLawSearchAttachments();

    const fileInputRef =
        useRef<HTMLInputElement>(null);

    const [uploadError, setUploadError] =
        useState<string | null>(null);

    const selectedMap = new Map(
        selectedAttachments.map((item) => [
            item.id,
            item,
        ])
    );

    const sortedFiles = [...uploaded_files].sort(
        (a, b) =>
            new Date(b.createdAt).getTime() -
            new Date(a.createdAt).getTime()
    );

    const handleUploadClick = () => {
        clearAttachmentError();
        setUploadError(null);
        fileInputRef.current?.click();
    };

    const handleInputChange = async (
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        const files = Array.from(
            event.target.files || []
        );

        if (files.length === 0) {
            return;
        }

        clearAttachmentError();
        setUploadError(null);

        for (const file of files) {
            const result = await uploadFile(file);

            if (!result.success) {
                setUploadError(result.error);
                continue;
            }

            await selectUploadedFile(result.file);
        }

        event.target.value = "";
    };

    const handleSelect = async (
        item: UploadedFileMeta
    ) => {
        clearAttachmentError();
        setUploadError(null);
        await selectUploadedFile(item);
    };

    return (
        <div className={styles.popover}>
            <div className={styles.header}>
                <span className={styles.title}>
                    Attach Files
                </span>

                <button
                    className={styles.closeBtn}
                    onClick={onClose}
                >
                    <span className="material-symbols-outlined">
                        close
                    </span>
                </button>
            </div>

            <div className={styles.list}>
                {sortedFiles.length === 0 && (
                    <div className={styles.loading}>
                        No uploaded files yet.
                    </div>
                )}

                {sortedFiles.map((item) => {
                    const selected =
                        selectedAttachmentIds.includes(
                            item.id
                        );

                    const selectedState =
                        selectedMap.get(item.id);

                    const isParsing =
                        selectedState?.parse_status ===
                        "parsing";

                    const hasError =
                        selectedState?.parse_status ===
                        "error";

                    return (
                        <button
                            key={item.id}
                            className={`${styles.item} ${
                                selected
                                    ? styles.itemSelected
                                    : ""
                            }`}
                            onClick={() =>
                                handleSelect(item)
                            }
                            title={
                                selectedState?.error ||
                                item.name
                            }
                        >
                            <div
                                className={styles.iconWrap}
                            >
                                {isParsing ? (
                                    <span
                                        className={
                                            styles.spinner
                                        }
                                    />
                                ) : (
                                    <span className="material-symbols-outlined">
                                        description
                                    </span>
                                )}
                            </div>

                            <div
                                className={styles.itemMeta}
                            >
                                <span
                                    className={
                                        styles.itemName
                                    }
                                >
                                    {item.name}
                                </span>

                                <span
                                    className={`${
                                        styles.itemInfo
                                    } ${
                                        hasError
                                            ? styles.itemError
                                            : ""
                                    }`}
                                >
                                    {hasError
                                        ? selectedState?.error
                                        : formatFileSize(
                                              item.size
                                          )}
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

                {(uploadError || attachmentError) && (
                    <div className={styles.errorText}>
                        {uploadError || attachmentError}
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

                <button
                    className={styles.uploadArea}
                    onClick={handleUploadClick}
                >
                    <span className="material-symbols-outlined">
                        upload_file
                    </span>

                    <span>Upload new file</span>
                </button>
            </div>
        </div>
    );
}
