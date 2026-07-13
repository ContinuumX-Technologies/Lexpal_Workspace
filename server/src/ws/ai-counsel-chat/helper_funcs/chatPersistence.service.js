import AI_Counsel_Message from "../../../models/AI_Counsel_Messages.model.ts";
import mongoose from "mongoose";

/**
 * Save AI Counsel chat message
 */
export default async function saveChatMessage({
    convo_id,
    sender,
    content,
    client_message_id = null,
    attachments = [],
    attachment_metadata = [],
    discovered_laws = [],
}) {
    try {
        const safeAttachmentIds = Array.isArray(attachments)
            ? attachments
                .map((item) =>
                    typeof item === "string" ? item.trim() : ""
                )
                .filter(Boolean)
            : [];

        const safeAttachmentMetadata = Array.isArray(attachment_metadata)
            ? attachment_metadata
                .map((item) => {
                    const id =
                        typeof item?.id === "string"
                            ? item.id.trim()
                            : "";
                    const file_name =
                        typeof item?.file_name === "string"
                            ? item.file_name.trim()
                            : "";

                    if (!id || !file_name) {
                        return null;
                    }

                    return {
                        id,
                        file_name,
                        size:
                            typeof item?.size === "number" &&
                                Number.isFinite(item.size) &&
                                item.size >= 0
                                ? item.size
                                : 0,
                        mime_type:
                            typeof item?.mime_type === "string"
                                ? item.mime_type.trim()
                                : "",
                    };
                })
                .filter((item) => item !== null)
            : [];

        const transformed_discovered_laws = Array.isArray(discovered_laws)
            ? discovered_laws.map((law) => ({
                act_name:
                    typeof law?.act_name === "string"
                        ? law.act_name.trim()
                        : "",
                section_no:
                    typeof law?.section_no === "string"
                        ? law.section_no.trim()
                        : "",
                chapter_name:
                    typeof law?.chapter_name === "string"
                        ? law.chapter_name.trim()
                        : null,
                chapter_code:
                    typeof law?.chapter_code === "string"
                        ? law.chapter_code.trim()
                        : null,
                act_year:
                    typeof law?.act_year === "string"
                        ? law.act_year.trim()
                        : null,
                chunk_id:
                    typeof law?.chunk_id === "string"
                        ? law.chunk_id.trim()
                        : null,
                law_text:
                    typeof law?.law_text === "string"
                        ? law.law_text
                        : "",
                reasoning:
                    typeof law?.reasoning === "string"
                        ? law.reasoning
                        : "",
                relevance_score:
                    typeof law?.relevance_score === "number" &&
                        Number.isFinite(law.relevance_score)
                        ? Math.max(0, Math.min(10, law.relevance_score))
                        : 0,
            }))
            : [];

        const message = await AI_Counsel_Message.create({
            convo_id,
            sender,
            content,
            client_message_id:
                typeof client_message_id === "string" &&
                    client_message_id.trim()
                    ? client_message_id.trim()
                    : undefined,
            attachments: safeAttachmentIds,
            attachment_metadata: safeAttachmentMetadata,
            discovered_laws: transformed_discovered_laws,
        });
        console.log(
            mongoose.connection.name,
            AI_Counsel_Message.collection.name
        );//dev log
        return message;
    }
    catch (err) {
        const isDuplicateError =
            err &&
            typeof err === "object" &&
            "code" in err &&
            err.code === 11000;

        if (isDuplicateError) {
            const existing = await AI_Counsel_Message.findOne({
                convo_id,
                sender,
                client_message_id,
            });
             console.log(
            mongoose.connection.name,
            AI_Counsel_Message.collection.name
        );//dev log
            return existing;
        }

        return err;
    }
}
