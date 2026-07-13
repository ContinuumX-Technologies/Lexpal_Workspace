"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchConversationMessages,
  fetchHistoricConversations,
  fetchLawSection,
  type AttachmentMetadata,
  type ConversationListItem,
  type DiscoveredLaw,
  type HistoricMessage,
  type LawLookupResponse,
} from "../api/lawSearch.api";
import type { DiscoveredLaw as LawCardLaw } from "../components/LawCards";

export const NEW_CONVERSATION_ID = "new" as const;
const MONGO_OBJECT_ID_REGEX = /^[a-fA-F0-9]{24}$/;

export type ActiveConversationId = string | typeof NEW_CONVERSATION_ID;

export const isMongoObjectId = (value: string): boolean => {
  return MONGO_OBJECT_ID_REGEX.test(value.trim());
};

type LawCacheKey = string;

type ChatHistoryMessage = {
  sender: "AI" | "User";
  content: string;
};

type ContextAttachment = {
  index: number;
  file_name: string;
  text_content: string;
};

export type OutboundContextObject = {
  chat_history: ChatHistoryMessage[];
  attachments: ContextAttachment[];
};

export type AttachedContextPreview = {
  id: string;
  name: string;
  info?: string;
};

export type MessageDeliveryStatus = "sending" | "sent" | "error";

export type LawSearchChatMessage = {
  id: string;
  sender: "AI" | "User";
  content: string;
  createdAt?: string;
  attachedContext?: AttachedContextPreview[];
  rawContent?: string;
  contextPayload?: OutboundContextObject;
  attachmentIds: string[];
  attachmentMetadata: AttachmentMetadata[];
  discovered_laws: LawCardLaw[];
  clientMessageId?: string | null;
  status?: MessageDeliveryStatus;
};

type SidebarContextType = {
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  activeConvoId: ActiveConversationId;
  setActiveConvoId: (id: ActiveConversationId) => void;
  conversations: ConversationListItem[];
  conversationsLoading: boolean;
  conversationsError: string | null;
  refreshConversations: () => Promise<void>;
  messages: LawSearchChatMessage[];
  messagesLoading: boolean;
  messagesError: string | null;
  clearMessages: () => void;
  replaceMessages: (nextMessages: LawSearchChatMessage[]) => void;
  appendMessage: (message: LawSearchChatMessage) => void;
  updateMessage: (
    messageId: string,
    updater: (message: LawSearchChatMessage) => LawSearchChatMessage
  ) => void;
  markMessageSent: (clientMessageId: string) => void;
  markMessageError: (clientMessageId: string) => void;
  trimMessagesAfter: (messageId: string) => void;
  hydrateMessageLaws: (baseMessages: HistoricMessage[], signal?: AbortSignal) => Promise<HistoricMessage[]>;
  getAttachmentMetadataById: (id: string) => Promise<AttachmentMetadata | null>;
};

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

const normalizeLawCacheKey = (actName: string, sectionNo: string): LawCacheKey => {
  return `${actName.trim().toLowerCase()}::${sectionNo.trim().toLowerCase()}`;
};

const toDiscoveredLawWithHydratedText = (
  law: DiscoveredLaw,
  lookup: LawLookupResponse
): DiscoveredLaw => {
  return {
    ...law,
    law_text: lookup.law_text,
    chapter_name: law.chapter_name ?? lookup.chapter_name,
    chapter_code: law.chapter_code ?? lookup.chapter_code,
    act_year: law.act_year ?? lookup.act_year,
    chunk_id: law.chunk_id ?? lookup.chunk_id,
  };
};

const toLawCardLaw = (law: DiscoveredLaw): LawCardLaw => ({
  act_name: law.act_name,
  section_no: law.section_no,
  chapter_name: law.chapter_name ?? undefined,
  chapter_code: law.chapter_code ?? undefined,
  act_year: law.act_year ?? undefined,
  chunk_id: law.chunk_id ?? undefined,
  law_text: law.law_text,
  reasoning: law.reasoning,
  relevance_score: law.relevance_score,
});

const extractPromptFromContent = (content: string) => {
  const newFormatMatch = content.match(/--- User Prompt ---\n([\s\S]*?)\n--- End User Prompt ---/);

  if (newFormatMatch?.[1]) {
    return newFormatMatch[1].trim();
  }

  const legacyRegex = /--- Context Attached ---\n([\s\S]*?)\n--- End Context ---\n\n/g;
  const legacyMatch = legacyRegex.exec(content);

  if (!legacyMatch) {
    return content;
  }

  return content.replace(legacyMatch[0], "").trim();
};

const extractAttachedContextPreview = (content: string): AttachedContextPreview[] => {
  const previews: AttachedContextPreview[] = [];
  const attachedFileRegex = /Attached File -->\s*file\d+:\s*(.+)/g;

  let attachedFileMatch = attachedFileRegex.exec(content);

  while (attachedFileMatch) {
    previews.push({
      id: `history-${previews.length + 1}`,
      name: attachedFileMatch[1]?.trim() || "File",
      info: "",
    });

    attachedFileMatch = attachedFileRegex.exec(content);
  }

  return previews;
};

const toChatMessage = (msg: HistoricMessage): LawSearchChatMessage => {
  const attachmentIds = Array.isArray(msg.attachments) ? msg.attachments : [];
  const attachmentMetadata = Array.isArray(msg.attachment_metadata) ? msg.attachment_metadata : [];

  if (msg.sender === "AI") {
    return {
      id: msg.id,
      sender: "AI",
      content: msg.content,
      createdAt: msg.createdAt,
      attachmentIds,
      attachmentMetadata,
      discovered_laws: Array.isArray(msg.discovered_laws) ? msg.discovered_laws.map(toLawCardLaw) : [],
      clientMessageId: msg.client_message_id,
      status: "sent",
    };
  }

  return {
    id: msg.id,
    sender: "User",
    content: extractPromptFromContent(msg.content),
    createdAt: msg.createdAt,
    rawContent: msg.content,
    attachedContext: extractAttachedContextPreview(msg.content),
    attachmentIds,
    attachmentMetadata,
    discovered_laws: [],
    clientMessageId: msg.client_message_id,
    status: "sent",
  };
};

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [activeConvoId, setActiveConvoIdState] = useState<ActiveConversationId>(NEW_CONVERSATION_ID);

  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [conversationsError, setConversationsError] = useState<string | null>(null);

  const [messages, setMessages] = useState<LawSearchChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const lawCacheRef = useRef<Map<LawCacheKey, LawLookupResponse>>(new Map());
  const messageRequestSeqRef = useRef(0);

  useEffect(() => {
    const savedOpen = localStorage.getItem("lexpal_sidebar_open");
    const savedWidth = localStorage.getItem("lexpal_sidebar_width");
    const isMobile = window.innerWidth < 768;

    if (savedOpen !== null) {
      setIsSidebarOpen(isMobile ? false : savedOpen === "true");
    } else {
      setIsSidebarOpen(!isMobile);
    }

    if (savedWidth) {
      const parsed = Number.parseInt(savedWidth, 10);
      if (Number.isFinite(parsed) && parsed >= 200 && parsed <= 480) {
        setSidebarWidth(parsed);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("lexpal_sidebar_open", String(isSidebarOpen));
    localStorage.setItem("lexpal_sidebar_width", String(sidebarWidth));
  }, [isSidebarOpen, sidebarWidth]);

  const toggleSidebar = () => setIsSidebarOpen((prev) => !prev);
  const setSidebarOpen = (open: boolean) => setIsSidebarOpen(open);

  const setActiveConvoId = useCallback((id: ActiveConversationId) => {
    const normalized = typeof id === "string" ? id.trim() : "";

    if (!normalized) {
      return;
    }

    if (normalized === NEW_CONVERSATION_ID || isMongoObjectId(normalized)) {
      setActiveConvoIdState(normalized);
    }
  }, []);

  const replaceMessages = useCallback((nextMessages: LawSearchChatMessage[]) => {
    setMessages((prev) => {
      const nextIds = new Set(nextMessages.map((m) => m.id));
      const optimisticOrLiveMessages = prev.filter(
        (m) => !nextIds.has(m.id) && (m.status === "sending" || m.status === "sent" || m.status === "error")
      );
      return [...nextMessages, ...optimisticOrLiveMessages];
    });
    setMessagesError(null);
  }, []);

  const appendMessage = useCallback((message: LawSearchChatMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const updateMessage = useCallback(
    (
      messageId: string,
      updater: (message: LawSearchChatMessage) => LawSearchChatMessage
    ) => {
      if (!messageId) {
        return;
      }

      setMessages((prev) => {
        let hasChanges = false;

        const next = prev.map((message) => {
          if (message.id !== messageId) {
            return message;
          }

          hasChanges = true;
          return updater(message);
        });

        return hasChanges ? next : prev;
      });
    },
    []
  );

  const updateByClientMessageId = useCallback(
    (clientMessageId: string, status: MessageDeliveryStatus) => {
      if (!clientMessageId) {
        return;
      }

      setMessages((prev) => {
        let hasChanges = false;

        const next = prev.map((message) => {
          if (message.clientMessageId !== clientMessageId) {
            return message;
          }

          hasChanges = true;
          return {
            ...message,
            status,
          };
        });

        return hasChanges ? next : prev;
      });
    },
    []
  );

  const markMessageSent = useCallback(
    (clientMessageId: string) => {
      updateByClientMessageId(clientMessageId, "sent");
    },
    [updateByClientMessageId]
  );

  const markMessageError = useCallback(
    (clientMessageId: string) => {
      updateByClientMessageId(clientMessageId, "error");
    },
    [updateByClientMessageId]
  );

  const trimMessagesAfter = useCallback((messageId: string) => {
    if (!messageId) {
      return;
    }

    setMessages((prev) => {
      const index = prev.findIndex((message) => message.id === messageId);

      if (index === -1) {
        return prev;
      }

      return prev.slice(0, index + 1);
    });
  }, []);

  const refreshConversations = useCallback(async () => {
    setConversationsLoading(true);
    setConversationsError(null);

    try {
      const data = await fetchHistoricConversations();
      setConversations(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to load conversations";
      setConversationsError(errorMessage);
      setConversations([]);
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  const hydrateMessageLaws = async (
    baseMessages: HistoricMessage[],
    signal?: AbortSignal
  ): Promise<HistoricMessage[]> => {
    const uniqueLawKeys = new Set<LawCacheKey>();
    const lookupPairs: Array<{ key: LawCacheKey; act_name: string; section_no: string }> = [];

    baseMessages.forEach((message) => {
      message.discovered_laws.forEach((law) => {
        if (!law.act_name || !law.section_no) {
          return;
        }

        const key = normalizeLawCacheKey(law.act_name, law.section_no);

        if (lawCacheRef.current.has(key) || uniqueLawKeys.has(key)) {
          return;
        }

        uniqueLawKeys.add(key);
        lookupPairs.push({
          key,
          act_name: law.act_name,
          section_no: law.section_no,
        });
      });
    });

    await Promise.all(
      lookupPairs.map(async (item) => {
        try {
          const lookup = await fetchLawSection(item.act_name, item.section_no, signal);
          lawCacheRef.current.set(item.key, lookup);
        } catch {
          // keep partial hydration resilient; unresolved laws stay as-is
        }
      })
    );

    return baseMessages.map((message) => {
      if (message.discovered_laws.length === 0) {
        return message;
      }

      const hydratedLaws = message.discovered_laws.map((law) => {
        const key = normalizeLawCacheKey(law.act_name, law.section_no);
        const cached = lawCacheRef.current.get(key);

        if (!cached) {
          return law;
        }

        return toDiscoveredLawWithHydratedText(law, cached);
      });

      return {
        ...message,
        discovered_laws: hydratedLaws,
      };
    });
  };

  const getAttachmentMetadataById = async (id: string): Promise<AttachmentMetadata | null> => {
    if (!id) {
      return null;
    }

    try {
      const dbRequest = indexedDB.open("lexpal");

      const fileRecord = await new Promise<Record<string, unknown> | null>((resolve) => {
        dbRequest.onerror = () => resolve(null);
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          if (!db.objectStoreNames.contains("uploaded_files")) {
            resolve(null);
            return;
          }

          const tx = db.transaction("uploaded_files", "readonly");
          const store = tx.objectStore("uploaded_files");
          const getReq = store.get(id);

          getReq.onsuccess = () => {
            const result = getReq.result;
            if (result && typeof result === "object") {
              resolve(result as Record<string, unknown>);
              return;
            }

            resolve(null);
          };

          getReq.onerror = () => resolve(null);
        };
      });

      if (!fileRecord) {
        return null;
      }

      const file_name = typeof fileRecord.name === "string" ? fileRecord.name : "";

      if (!file_name) {
        return null;
      }

      return {
        id,
        file_name,
        size: typeof fileRecord.size === "number" ? fileRecord.size : 0,
        mime_type: typeof fileRecord.type === "string" ? fileRecord.type : "",
      };
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const requestSeq = ++messageRequestSeqRef.current;
    const controller = new AbortController();

    const loadMessages = async () => {
      if (activeConvoId === NEW_CONVERSATION_ID) {
        replaceMessages([]);
        setMessagesLoading(false);
        return;
      }

      setMessagesLoading(true);
      setMessagesError(null);

      try {
        const rawMessages = await fetchConversationMessages(activeConvoId, controller.signal);
        const hydrated = await hydrateMessageLaws(rawMessages, controller.signal);

        if (requestSeq !== messageRequestSeqRef.current) {
          return;
        }

        replaceMessages(hydrated.map(toChatMessage));
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }

        if (requestSeq !== messageRequestSeqRef.current) {
          return;
        }

        const errorMessage = err instanceof Error ? err.message : "Failed to load messages";
        setMessagesError(errorMessage);
        setMessages([]);
      } finally {
        if (requestSeq === messageRequestSeqRef.current) {
          setMessagesLoading(false);
        }
      }
    };

    void loadMessages();

    return () => {
      controller.abort();
    };
  }, [activeConvoId, replaceMessages]);

  const clearMessages = () => {
    replaceMessages([]);
    setMessagesLoading(false);
  };

  const contextValue = useMemo<SidebarContextType>(
    () => ({
      isSidebarOpen,
      toggleSidebar,
      setSidebarOpen,
      sidebarWidth,
      setSidebarWidth,
      activeConvoId,
      setActiveConvoId,
      conversations,
      conversationsLoading,
      conversationsError,
      refreshConversations,
      messages,
      messagesLoading,
      messagesError,
      clearMessages,
      replaceMessages,
      appendMessage,
      updateMessage,
      markMessageSent,
      markMessageError,
      trimMessagesAfter,
      hydrateMessageLaws,
      getAttachmentMetadataById,
    }),
    [
      isSidebarOpen,
      sidebarWidth,
      activeConvoId,
      setActiveConvoId,
      conversations,
      conversationsLoading,
      conversationsError,
      messages,
      messagesLoading,
      messagesError,
      replaceMessages,
      appendMessage,
      updateMessage,
      markMessageSent,
      markMessageError,
      trimMessagesAfter,
    ]
  );

  return <SidebarContext.Provider value={contextValue}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const context = useContext(SidebarContext);

  if (context === undefined) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }

  return context;
}
