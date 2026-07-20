import mongoose from "mongoose";
import AI_Counsel_Convo from "../models/AI_Counsel_Convo.model";
import AI_Counsel_Message from "../models/AI_Counsel_Messages.model";
import { getOrCreateChromaCollection } from "../infra/chroma.client";
import type { WebResearch } from "./llm_websearch";

const LAW_COLLECTION_NAME = "Indian_Law_Acts";

type UnknownRecord = Record<string, unknown>;

interface DbConversation {
  _id: mongoose.Types.ObjectId;
  user_id?: mongoose.Types.ObjectId | string | null;
  title?: string | null;
}

interface DbAttachmentMetadata {
  id?: unknown;
  file_name?: unknown;
  size?: unknown;
  mime_type?: unknown;
}

interface DbDiscoveredLaw {
  act_name?: unknown;
  section_no?: unknown;
  chapter_name?: unknown;
  chapter_code?: unknown;
  act_year?: unknown;
  chunk_id?: unknown;
  law_text?: unknown;
  reasoning?: unknown;
  relevance_score?: unknown;
}

interface DbMessage {
  _id: mongoose.Types.ObjectId;
  convo_id: mongoose.Types.ObjectId;
  sender: "AI" | "User";
  content: string;
  createdAt: Date;
  attachments?: unknown;
  attachment_metadata?: DbAttachmentMetadata[];
  discovered_laws?: DbDiscoveredLaw[];
  client_message_id?: unknown;
  web_research:null|WebResearch
}

export interface AttachmentMetadata {
  id: string;
  file_name: string;
  size: number;
  mime_type: string;
}

export interface DiscoveredLawItem {
  act_name: string;
  section_no: string;
  chapter_name: string | null;
  chapter_code: string | null;
  act_year: string | null;
  chunk_id: string | null;
  law_text: string;
  reasoning: string;
  relevance_score: number;
}

export interface HistoryMessageItem {
  id: string;
  convo_id: string;
  sender: "AI" | "User";
  content: string;
  createdAt: string;
  attachments: string[];
  attachment_metadata: AttachmentMetadata[];
  discovered_laws: DiscoveredLawItem[];
  client_message_id: string | null;
  web_research: null|WebResearch
}

export interface ConversationListItem {
  id: string;
  title: string;
}

export interface LawLookupResult {
  act_name: string;
  section_no: string;
  chapter_name: string | null;
  chapter_code: string | null;
  act_year: string | null;
  chunk_id: string | null;
  law_text: string;
  metadata: UnknownRecord;
}






const toSafeString = (value: unknown): string => {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return String(value);
  }

  return "";
};


const toSafeNullableString = (value: unknown): string | null => {
  const normalized = toSafeString(value);
  return normalized ? normalized : null;
};


const toSafeNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
};






const parseAttachmentNamesFromContent = (content: string): string[] => {
  const names: string[] = [];
  const attachedFileRegex = /Attached File -->\s*file\d+:\s*(.+)/g;

  let match = attachedFileRegex.exec(content);

  while (match) {
    const name = match[1]?.trim();

    if (name) {
      names.push(name);
    }

    match = attachedFileRegex.exec(content);
  }

  return names;
};







const normalizeAttachmentIds = (attachments: unknown): string[] => {
  if (!Array.isArray(attachments)) {
    return [];
  }

  return attachments
    .map((item) => toSafeString(item))
    .filter((item) => item.length > 0);
};

const normalizeAttachmentMetadata = (
  metadataList: DbAttachmentMetadata[] | undefined,
  attachmentIds: string[],
  rawContent: string
): AttachmentMetadata[] => {
  if (Array.isArray(metadataList) && metadataList.length > 0) {
    return metadataList
      .map((entry) => {
        const id = toSafeString(entry.id);
        const fileName = toSafeString(entry.file_name);

        if (!id || !fileName) {
          return null;
        }

        return {
          id,
          file_name: fileName,
          size: Math.max(0, toSafeNumber(entry.size)),
          mime_type: toSafeString(entry.mime_type),
        } satisfies AttachmentMetadata;
      })
      .filter((entry): entry is AttachmentMetadata => entry !== null);
  }

  const parsedNames = parseAttachmentNamesFromContent(rawContent);

  return attachmentIds.map((id, index) => ({
    id,
    file_name: parsedNames[index] || `Attachment ${index + 1}`,
    size: 0,
    mime_type: "",
  }));
};








const normalizeDiscoveredLaws = (
  discovered: DbDiscoveredLaw[] | undefined
): DiscoveredLawItem[] => {
  if (!Array.isArray(discovered)) {
    return [];
  }

  return discovered
    .map((item) => {
      const actName = toSafeString(item.act_name);
      const sectionNo = toSafeString(item.section_no);

      if (!actName || !sectionNo) {
        return null;
      }

      return {
        act_name: actName,
        section_no: sectionNo,
        chapter_name: toSafeNullableString(item.chapter_name),
        chapter_code: toSafeNullableString(item.chapter_code),
        act_year: toSafeNullableString(item.act_year),
        chunk_id: toSafeNullableString(item.chunk_id),
        law_text: toSafeString(item.law_text),
        reasoning: toSafeString(item.reasoning),
        relevance_score: Math.max(0, Math.min(10, toSafeNumber(item.relevance_score))),
      } satisfies DiscoveredLawItem;
    })
    .filter((item): item is DiscoveredLawItem => item !== null);
};






const isConversationOwnedByUser = (
  conversation: DbConversation,
  userId: string
): boolean => {
  if (!conversation.user_id) {
    return false;
  }

  return String(conversation.user_id) === userId;
};





export const listUserConversations = async (
  userId: string
): Promise<ConversationListItem[]> => {
  const conversations = await AI_Counsel_Convo.find({ user_id: userId })
    .sort({ updatedAt: -1 })
    .select({ _id: 1, title: 1 })
    .lean<DbConversation[]>();

  return conversations.map((item) => ({
    id: item._id.toString(),
    title: toSafeString(item.title) || "Untitled Chat",
  }));
};







export const findOwnedConversation = async (
  conversationId: string,
  userId: string
): Promise<DbConversation | null> => {
  if (!mongoose.isValidObjectId(conversationId)) {
    return null;
  }

  const conversation = await AI_Counsel_Convo.findById(conversationId)
    .select({ _id: 1, user_id: 1, title: 1 })
    .lean<DbConversation | null>();

  if (!conversation) {
    return null;
  }

  if (!isConversationOwnedByUser(conversation, userId)) {
    return null;
  }

  return conversation;
};











export const getOwnedConversationMessages = async (
  conversationId: string,
  userId: string
): Promise<HistoryMessageItem[] | null> => {
  const ownedConversation = await findOwnedConversation(conversationId, userId);

  if (!ownedConversation) {
    return null;
  }

  const messages = await AI_Counsel_Message.find({ convo_id: conversationId })
    .sort({ createdAt: 1 })
    .lean<DbMessage[]>();
  
  console.log(messages);//dev logs

  return messages.map((item) => {
    const attachmentIds = normalizeAttachmentIds(item.attachments);

    return {
      id: item._id.toString(),
      convo_id: item.convo_id.toString(),
      sender: item.sender,
      content: toSafeString(item.content),
      createdAt: item.createdAt.toISOString(),
      attachments: attachmentIds,
      attachment_metadata: normalizeAttachmentMetadata(
        item.attachment_metadata,
        attachmentIds,
        item.content
      ),
      discovered_laws: normalizeDiscoveredLaws(item.discovered_laws),
      client_message_id: toSafeNullableString(item.client_message_id),
      web_research: item.web_research
    } satisfies HistoryMessageItem;
  });
};












export const lookupLawByActAndSection = async (
  actName: string,
  sectionNo: string
): Promise<LawLookupResult | null> => {
  const trimmedActName = toSafeString(actName);
  const trimmedSectionNo = toSafeString(sectionNo);

  if (!trimmedActName || !trimmedSectionNo) {
    return null;
  }

  const collection = await getOrCreateChromaCollection(LAW_COLLECTION_NAME);
  const response = await collection.get({
    where: {
      $and: [
        { act_name: { $eq: trimmedActName } },
        { section_no: { $eq: trimmedSectionNo } },
      ],
    },
    include: ["documents", "metadatas"],
  });

  const docs = Array.isArray(response.documents) ? response.documents : [];
  const metadatas = Array.isArray(response.metadatas)
    ? (response.metadatas as unknown[])
    : [];

  if (docs.length === 0) {
    return null;
  }

  const combinedLawText = docs
    .map((doc) => toSafeString(doc))
    .filter(Boolean)
    .join("\n");

  const rawMetadataCandidate = metadatas.find((item) => {
    return Boolean(item) && typeof item === "object" && !Array.isArray(item);
  });

  const metadataCandidate: UnknownRecord =
    rawMetadataCandidate && typeof rawMetadataCandidate === "object"
      ? (rawMetadataCandidate as UnknownRecord)
      : {};

  return {
    act_name: toSafeString(metadataCandidate.act_name) || trimmedActName,
    section_no: toSafeString(metadataCandidate.section_no) || trimmedSectionNo,
    chapter_name: toSafeNullableString(metadataCandidate.chapter_name),
    chapter_code: toSafeNullableString(metadataCandidate.chapter_code),
    act_year: toSafeNullableString(metadataCandidate.act_year),
    chunk_id: toSafeNullableString(metadataCandidate.chunk_id),
    law_text: combinedLawText,
    metadata: metadataCandidate,
  };
};
