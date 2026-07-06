import {
    createContext,
    useContext,
    useMemo,
    useState,
} from "react";
import parseFileToText from "../../../utils/parseFileToText.util";
import {
    useUploadedFiles,
    type UploadedFileMeta,
} from "../../../contexts/upload_files.context";

export const MAX_SELECTED_ATTACHMENTS = 3;

export type AttachmentParseStatus =
    | "parsing"
    | "ready"
    | "error";

export type SelectedAttachment = {
    id: string;
    file_name: string;
    size: number;
    parse_status: AttachmentParseStatus;
    text_content: string;
    error: string | null;
};

export type AttachedContextPreview = {
    id: string;
    name: string;
    info?: string;
};

export type ChatHistoryMessage = {
    sender: "AI" | "User";
    content: string;
};

export type ContextAttachment = {
    index: number;
    file_name: string;
    text_content: string;
};

export type OutboundContextObject = {
    chat_history: ChatHistoryMessage[];
    attachments: ContextAttachment[];
};

type BuildPayloadResult =
    | {
          ok: true;
          context: OutboundContextObject;
          attachmentIds: string[];
          attachedContextPreview: AttachedContextPreview[];
      }
    | {
          ok: false;
          error: string;
      };

type LawSearchAttachmentsContextType = {
    selectedAttachments: SelectedAttachment[];
    selectedAttachmentIds: string[];
    selectedCount: number;
    isParsingAny: boolean;
    hasAttachmentErrors: boolean;
    canSendWithAttachments: boolean;
    attachmentError: string | null;
    clearAttachmentError: () => void;
    selectUploadedFile: (
        fileMeta: UploadedFileMeta
    ) => Promise<void>;
    removeSelectedAttachment: (id: string) => void;
    clearSelectedAttachments: () => void;
    buildPayload: (
        history: ChatHistoryMessage[]
    ) => BuildPayloadResult;
};

const LawSearchAttachmentsContext =
    createContext<LawSearchAttachmentsContextType | null>(
        null
    );

const getErrorMessage = (err: unknown) =>
    err instanceof Error
        ? err.message
        : "Failed to process attachment.";

export const formatFileSize = (
    bytes: number
): string => {
    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function LawSearchAttachmentsProvider({
    children,
}: {
    children: React.ReactNode;
}) {
    const {
        getFile,
        markAsUsed,
    } = useUploadedFiles();

    const [selectedAttachments, setSelectedAttachments] =
        useState<SelectedAttachment[]>([]);

    const [attachmentError, setAttachmentError] =
        useState<string | null>(null);

    const selectedAttachmentIds = useMemo(
        () =>
            selectedAttachments.map((item) => item.id),
        [selectedAttachments]
    );

    const selectedCount = selectedAttachments.length;

    const isParsingAny = selectedAttachments.some(
        (item) => item.parse_status === "parsing"
    );

    const hasAttachmentErrors =
        selectedAttachments.some(
            (item) => item.parse_status === "error"
        );

    const canSendWithAttachments =
        !isParsingAny && !hasAttachmentErrors;

    const clearAttachmentError = () => {
        setAttachmentError(null);
    };

    const selectUploadedFile = async (
        fileMeta: UploadedFileMeta
    ) => {
        setAttachmentError(null);

        const alreadySelected =
            selectedAttachments.some(
                (item) => item.id === fileMeta.id
            );

        if (alreadySelected) {
            return;
        }

        if (
            selectedAttachments.length >=
            MAX_SELECTED_ATTACHMENTS
        ) {
            setAttachmentError(
                "You can attach up to 3 files only."
            );
            return;
        }

        const storedFile = await getFile(fileMeta.id);

        if (!storedFile?.file) {
            setAttachmentError(
                "Unable to load this file from local storage."
            );
            return;
        }

        setSelectedAttachments((prev) => [
            ...prev,
            {
                id: fileMeta.id,
                file_name: fileMeta.name,
                size: fileMeta.size,
                parse_status: "parsing",
                text_content: "",
                error: null,
            },
        ]);

        try {
            const parseableFile = new File(
                [storedFile.file],
                storedFile.name,
                {
                    type: storedFile.type,
                }
            );

            const parsedText = await parseFileToText(
                parseableFile
            );

            if (!parsedText.trim()) {
                throw new Error(
                    "No text could be extracted from this file."
                );
            }

            setSelectedAttachments((prev) =>
                prev.map((item) =>
                    item.id === fileMeta.id
                        ? {
                              ...item,
                              parse_status: "ready",
                              text_content: parsedText,
                              error: null,
                          }
                        : item
                )
            );

            await markAsUsed(fileMeta.id);
        } catch (err) {
            const message = getErrorMessage(err);

            setSelectedAttachments((prev) =>
                prev.map((item) =>
                    item.id === fileMeta.id
                        ? {
                              ...item,
                              parse_status: "error",
                              text_content: "",
                              error: message,
                          }
                        : item
                )
            );

            setAttachmentError(
                `Failed to parse ${fileMeta.name}. ${message}`
            );
        }
    };

    const removeSelectedAttachment = (id: string) => {
        setAttachmentError(null);
        setSelectedAttachments((prev) =>
            prev.filter((item) => item.id !== id)
        );
    };

    const clearSelectedAttachments = () => {
        setSelectedAttachments([]);
        setAttachmentError(null);
    };

    const buildPayload = (
        history: ChatHistoryMessage[]
    ): BuildPayloadResult => {
        if (isParsingAny) {
            return {
                ok: false,
                error:
                    "Please wait until all attachments finish parsing.",
            };
        }

        const errored = selectedAttachments.find(
            (item) => item.parse_status === "error"
        );

        if (errored) {
            return {
                ok: false,
                error:
                    errored.error ||
                    `Attachment parsing failed for ${errored.file_name}.`,
            };
        }

        const readyAttachments = selectedAttachments.filter(
            (item) => item.parse_status === "ready"
        );

        const attachments: ContextAttachment[] =
            readyAttachments.map((item, index) => ({
                index: index + 1,
                file_name: item.file_name,
                text_content: item.text_content,
            }));

        const attachmentIds = readyAttachments.map(
            (item) => item.id
        );

        const attachedContextPreview: AttachedContextPreview[] =
            readyAttachments.map((item) => ({
                id: item.id,
                name: item.file_name,
                info: formatFileSize(item.size),
            }));

        return {
            ok: true,
            context: {
                chat_history: history.slice(-10),
                attachments,
            },
            attachmentIds,
            attachedContextPreview,
        };
    };

    return (
        <LawSearchAttachmentsContext.Provider
            value={{
                selectedAttachments,
                selectedAttachmentIds,
                selectedCount,
                isParsingAny,
                hasAttachmentErrors,
                canSendWithAttachments,
                attachmentError,
                clearAttachmentError,
                selectUploadedFile,
                removeSelectedAttachment,
                clearSelectedAttachments,
                buildPayload,
            }}
        >
            {children}
        </LawSearchAttachmentsContext.Provider>
    );
}

export function useLawSearchAttachments() {
    const context = useContext(
        LawSearchAttachmentsContext
    );

    if (!context) {
        throw new Error(
            "useLawSearchAttachments must be used inside LawSearchAttachmentsProvider"
        );
    }

    return context;
}
