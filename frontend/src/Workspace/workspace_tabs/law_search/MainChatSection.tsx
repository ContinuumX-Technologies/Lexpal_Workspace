import { useEffect, useMemo, useRef, useState } from "react";
import ChatInput from "./components/ChatInput";
import { type LawSearchChatMessage, useSidebar } from "./context/SidebarContext";
import styles from "./MainChatSection.module.css";
import LawCards, { type DiscoveredLaw as LawCardLaw } from "./components/LawCards";
import {
  type AttachmentMetadataPayload,
  type ChatHistoryMessage,
  type OutboundContextObject,
  useLawSearchAttachments,
} from "./context/attachments.context";
import { type AttachmentMetadata, type DiscoveredLaw } from "./api/lawSearch.api";
import { TextShimmer } from "@/components/ui/text-shimmer";
import ReactMarkdown from "react-markdown";
import {
  Copy,
  RotateCw,
  Share,
  MoreHorizontal,
  Sparkles,
  PanelLeft,
  Zap,
  BrainCog,
} from "lucide-react";
import {ws_url_base} from "@/config";



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



type InboundSocketPayload = {
  type?: string;
  content?: string;
  discovered_laws?: DiscoveredLaw[];
  message_id?: string | null;
  convo_id?: string;
  title?: string | null;
  role?: "User" | "AI";
  client_message_id?: string | null;
  message?: string;
};




const composeSocketContent = (prompt: string, context: OutboundContextObject) => {
  const historyLabel =
    context.chat_history.length > 0
      ? context.chat_history.map((msg, idx) => `${idx + 1}. ${msg.sender}: ${msg.content}`).join("\n\n")
      : "No recent conversation history.";

  const attachmentLabel =
    context.attachments.length > 0
      ? context.attachments
          .map((file) => `Attached File --> file${file.index}: ${file.file_name}\n${file.text_content}`)
          .join("\n\n")
      : "No attached files.";

  return [
    "--- Conversation History ---",
    historyLabel,
    "--- End Conversation History ---",
    "",
    "--- Attachments ---",
    attachmentLabel,
    "--- End Attachments ---",
    "",
    "--- User Prompt ---",
    prompt,
    "--- End User Prompt ---",
  ].join("\n");
};






const MainChatSection = () => {
  

  const {
    toggleSidebar,
    activeConvoId,
    commitConversation,

    messages,
    messagesLoading,
    messagesError,

    refreshConversations,

    appendMessage,
    markMessageSent,
    markMessageError,
    trimMessagesAfter,
    getAttachmentMetadataById,
  } = useSidebar();

  const [isProcessing, setIsProcessing] = useState(false);
  const [socketReady, setSocketReady] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [socketVersion, setSocketVersion] = useState(0);
  const [showShareToast, setShowShareToast] = useState(false);
  const [, setActiveMoreMenuIndex] = useState<number | null>(null);
  const [chatMode, setChatMode] = useState<"basic_chat" | "reasoning_chat">("basic_chat");
  const [reasoningMode, setReasoningMode] = useState<"lite" | "deep">("lite");
  // const [webSearch, setWebSearch]= useState<boolean>(false);
  const [fallbackAttachmentMap, setFallbackAttachmentMap] = useState<Record<string, AttachmentMetadata>>({});

  const socketRef = useRef<WebSocket | null>(null);
  const chatAreaRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const seenAiMessageIdsRef = useRef<Set<string>>(new Set());
  const activeConvoIdRef = useRef(activeConvoId);

  const { buildPayload, clearSelectedAttachments } = useLawSearchAttachments();

  const toggleChatMode = () => {
    setChatMode((prev) => (prev === "basic_chat" ? "reasoning_chat" : "basic_chat"));
  };




  useEffect(() => {
    seenAiMessageIdsRef.current = new Set(messages.filter((msg) => msg.sender === "AI").map((msg) => msg.id));
  }, [messages, activeConvoId]);



  useEffect(() => {
    activeConvoIdRef.current = activeConvoId;
  }, [activeConvoId]);




  useEffect(() => {
    let cancelled = false;

    const resolveLegacyAttachmentMetadata = async () => {
      const missingIds = new Set<string>();

      messages.forEach((message) => {
        if (message.sender !== "User") {
          return;
        }

        const presentIds = new Set(message.attachmentMetadata.map((meta) => meta.id));

        message.attachmentIds.forEach((attachmentId) => {
          if (!presentIds.has(attachmentId) && !fallbackAttachmentMap[attachmentId]) {
            missingIds.add(attachmentId);
          }
        });
      });

      if (missingIds.size === 0) {
        return;
      }

      const fetched = await Promise.all(
        Array.from(missingIds).map(async (id) => {
          const metadata = await getAttachmentMetadataById(id);
          return metadata ? ([id, metadata] as const) : null;
        })
      );

      if (cancelled) {
        return;
      }

      const nextMap: Record<string, AttachmentMetadata> = {};

      fetched.forEach((entry) => {
        if (!entry) {
          return;
        }

        const [id, metadata] = entry;
        nextMap[id] = metadata;
      });

      if (Object.keys(nextMap).length > 0) {
        setFallbackAttachmentMap((prev) => ({ ...prev, ...nextMap }));
      }
    };

    void resolveLegacyAttachmentMetadata();

    return () => {
      cancelled = true;
    };
  }, [messages, getAttachmentMetadataById, fallbackAttachmentMap]);






  //connect to ai-counsel-chat websocket
  useEffect(() => {
    setSocketReady(false);
    setConnectionError(null);

    let isMounted = true;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connectWebSocket = () => {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }

      
     
      const wsUrl = `${ws_url_base}/ws/ai-counsel-chat`;
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;



      socket.onopen = () => {
        if (!isMounted) {
          socket.close();
          return;
        }

        setSocketReady(true);
        setConnectionError(null);
      };





      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as InboundSocketPayload;

          if (payload.type === "convo_created" && payload.convo_id) {
            commitConversation(payload.convo_id);
           
            return;
          }
        

          if (payload.type === "convo_title_updated") {
            void refreshConversations();
            return;
          }


          if (payload.type === "message_ack") {
            const ackClientMessageId = payload.client_message_id ?? null;

            if (ackClientMessageId) {
              markMessageSent(ackClientMessageId);
            }
            
            return;
          }


          if (payload.type === "ai_message") {
            const aiMessageId = payload.message_id || `ai-${Date.now()}`;

            if (seenAiMessageIdsRef.current.has(aiMessageId)) {
              setIsProcessing(false);
              return;
            }

            seenAiMessageIdsRef.current.add(aiMessageId);

            appendMessage({
              id: aiMessageId,
              sender: "AI",
              content: typeof payload.content === "string" ? payload.content : "",
              discovered_laws: Array.isArray(payload.discovered_laws)
                ? payload.discovered_laws.map(toLawCardLaw)
                : [],
              attachmentIds: [],
              attachmentMetadata: [],
              status: "sent",
            });
             
            setIsProcessing(false);
            return;
          }

          if (payload.type === "error") {
            setConnectionError(payload.message || "Connection error");
            setIsProcessing(false);
          }


        } catch {
          setConnectionError("Failed to parse server response");
          setIsProcessing(false);
        }
      };




      socket.onerror = () => {
        if (isMounted) {
          setConnectionError("Connection error.");
          setSocketReady(false);
        }
      };




      socket.onclose = (event) => {
        if (!isMounted) {
          return;
        }

        setSocketReady(false);

        if (event.code !== 1000) {
          reconnectTimeout = setTimeout(() => {
            if (isMounted) {
              connectWebSocket();
            }
          }, 2000);
        }
      };



    };

    connectWebSocket();

    return () => {
      isMounted = false;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }

      if (socketRef.current) {
        socketRef.current.close(1000, "Cleanup");
        socketRef.current = null;
      }
    };
  }, [ socketVersion, refreshConversations, appendMessage, markMessageSent]);





  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, messagesLoading, isProcessing]);




  const sendToSocket = async (
    payload: {
      content: string;
      attachmentIds: string[];
      attachmentMetadata: AttachmentMetadataPayload[];
      clientMessageId: string;
    }
  ) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      return false;
    }

    socketRef.current.send(
      JSON.stringify({
        content: payload.content,
        attachments: payload.attachmentIds,
        attachment_metadata: payload.attachmentMetadata,
        client_message_id: payload.clientMessageId,
        convo_id: activeConvoId,
        chat_mode: chatMode,
        ...(chatMode === "reasoning_chat" ? { reasoning_mode: reasoningMode } : {}),
      })
    );

    return true;
  };



  const sendMessage = async (text: string) => {
    if (!text.trim() || !socketReady || isProcessing) {
      return false;
    }

    const historyMessages: ChatHistoryMessage[] = messages
      .slice(-10)
      .map((msg) => ({ sender: msg.sender, content: msg.content }));

    const payloadResult = buildPayload(historyMessages);

    if (!payloadResult.ok) {
      const errorMessage =
        "error" in payloadResult ? payloadResult.error : "Failed to build outgoing message payload.";
      setConnectionError(errorMessage);
      return false;
    }



    const clientMessageId = crypto.randomUUID();
    const finalContent = composeSocketContent(text, payloadResult.context);

    const optimisticMessage: LawSearchChatMessage = {
      id: `local-${clientMessageId}`,
      sender: "User",
      content: text,
      rawContent: finalContent,
      contextPayload: payloadResult.context,
      attachedContext:
        payloadResult.attachedContextPreview.length > 0
          ? payloadResult.attachedContextPreview
          : undefined,
      attachmentIds: payloadResult.attachmentIds,
      attachmentMetadata: payloadResult.attachmentMetadata,
      discovered_laws: [],
      clientMessageId,
      status: "sending",
    };

    setConnectionError(null);
    setIsProcessing(true);
    appendMessage(optimisticMessage);

    const sent = await sendToSocket({
      content: finalContent,
      attachmentIds: payloadResult.attachmentIds,
      attachmentMetadata: payloadResult.attachmentMetadata,
      clientMessageId,
    });

    if (!sent) {
      setIsProcessing(false);
      markMessageError(clientMessageId);
      setConnectionError("Socket is not connected");
      return false;
    }

    clearSelectedAttachments();
    return true;
  };

  const handleRegenerate = async () => {
    if (isProcessing || messages.length === 0) {
      return;
    }

    let lastUserMsgIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender === "User") {
        lastUserMsgIndex = i;
        break;
      }
    }

    if (lastUserMsgIndex === -1) {
      return;
    }

    const lastUserMsg = messages[lastUserMsgIndex];

    if (!lastUserMsg.rawContent) {
      return;
    }

    trimMessagesAfter(lastUserMsg.id);
    setIsProcessing(true);

    const sent = await sendToSocket({
      content: lastUserMsg.rawContent,
      attachmentIds: lastUserMsg.attachmentIds,
      attachmentMetadata: lastUserMsg.attachmentMetadata.map((attachment) => ({
        id: attachment.id,
        file_name: attachment.file_name,
        size: attachment.size,
        mime_type: attachment.mime_type,
      })),
      clientMessageId: crypto.randomUUID(),
    });

    if (!sent) {
      setIsProcessing(false);
      setConnectionError("Socket is not connected");
    }
  };




  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setShowShareToast(true);

    window.setTimeout(() => {
      setShowShareToast(false);
    }, 2000);
  };





  const handleStop = () => {
    if (socketRef.current) {
      socketRef.current.close(1000, "User stopped generation");
    }

    setIsProcessing(false);
    setSocketVersion((prev) => prev + 1);
  };

  const isEmptyState = messages.length === 0 && !messagesLoading;










  const displayMessages = useMemo(() => {
    return messages.map((msg) => {
      if (msg.sender !== "User") {
        return msg;
      }

      if (msg.attachmentIds.length === 0) {
        return msg;
      }

      const presentById = new Map(msg.attachmentMetadata.map((meta) => [meta.id, meta]));
      const merged = msg.attachmentIds
        .map((id) => presentById.get(id) || fallbackAttachmentMap[id] || null)
        .filter((item): item is AttachmentMetadata => item !== null);

      return {
        ...msg,
        attachmentMetadata: merged,
      };
    });
  }, [messages, fallbackAttachmentMap]);













  return (
    <main className={styles.main}>
      {showShareToast && <div className={styles.toast}>Link copied to clipboard</div>}

      <section className={styles.chatInterface}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <button className={styles.iconButton} onClick={toggleSidebar} title="Toggle sidebar">
              <PanelLeft size={18} />
            </button>
          </div>

          <div className={styles.headerCenter}>
            <h1 className={styles.title}>Lexpal AI</h1>
            <span className={styles.headerSubtext}>AI Legal Counsel</span>
          </div>

          <div className={styles.headerRight} />
        </div>

        <div className={styles.chatArea} ref={chatAreaRef}>
          <div className={styles.messageWrapper}>
            {connectionError && <div className={styles.errorMessage}>{connectionError}</div>}
            {messagesError && <div className={styles.errorMessage}>{messagesError}</div>}

            {displayMessages.map((msg, i) => (
              <div
                key={`${msg.id}-${i}`}
                className={msg.sender === "User" ? styles.userMessageWrapper : styles.aiMessage}
              >
                {msg.sender === "AI" ? (
                  <div className={styles.markdownContent}>
                    <ReactMarkdown>{msg.content}</ReactMarkdown>

                    {msg.discovered_laws.length > 0 && <LawCards laws={msg.discovered_laws} />}

                    <div className={styles.actionToolbar}>
                      <button
                        className={styles.actionToolbarBtn}
                        onClick={() => navigator.clipboard.writeText(msg.content)}
                      >
                        <Copy size={18} />
                      </button>

                      <button className={styles.actionToolbarBtn} onClick={handleRegenerate}>
                        <RotateCw size={18} />
                      </button>

                      <button className={styles.actionToolbarBtn} onClick={handleShare}>
                        <Share size={18} />
                      </button>

                      <button
                        className={styles.actionToolbarBtn}
                        onClick={() => setActiveMoreMenuIndex((prev) => (prev === i ? null : i))}
                      >
                        <MoreHorizontal size={18} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className={styles.userContentGroup}>
                    {msg.attachmentMetadata.length > 0 && (
                      <div className={styles.userAttachmentChips}>
                        {msg.attachmentMetadata.map((attachment) => (
                          <span key={attachment.id} className={styles.userAttachmentChip}>
                            {attachment.file_name}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className={styles.userMessageBubble}>{msg.content}</div>
                  </div>
                )}
              </div>
            ))}

            {(isProcessing || messagesLoading) && (
              <div className={styles.aiMessage}>
                <TextShimmer duration={1}>{messagesLoading ? "Loading history..." : "Thinking..."}</TextShimmer>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        <div className={`${styles.inputArea} ${isEmptyState ? styles.inputAreaCentered : ""}`}>
          {isEmptyState && (
            <div className={styles.welcomeMessage}>
              <div style={{ marginBottom: 16 }}>
                <Sparkles size={48} strokeWidth={1} style={{ opacity: 0.2 }} />
              </div>
              <p>Hello! I am Lexpal AI.</p>
              <p style={{ fontSize: "0.9em", opacity: 0.8, marginTop: 4 }}>
                Select context or start typing to begin.
              </p>
            </div>
          )}

          {chatMode === "reasoning_chat" && (
            <div className={styles.reasoningModeBar}>
              <button
                className={`${styles.reasoningModeBtn} ${
                  reasoningMode === "lite" ? styles.reasoningModeBtnActive : ""
                }`}
                onClick={() => setReasoningMode("lite")}
                title="Lite — faster, efficient reasoning"
              >
                <Zap size={13} strokeWidth={2} />
                Lite
              </button>
              <button
                className={`${styles.reasoningModeBtn} ${
                  reasoningMode === "deep" ? styles.reasoningModeBtnActive : ""
                }`}
                onClick={() => setReasoningMode("deep")}
                title="Deep — thorough, multi-step reasoning"
              >
                <BrainCog size={13} strokeWidth={2} />
                Deep
              </button>
            </div>
          )}

          <ChatInput
            onSendMessage={sendMessage}
            onStop={handleStop}
            isProcessing={isProcessing}
            disabled={!socketReady && !isProcessing}
            chatMode={chatMode}
            onToggleChatMode={toggleChatMode}
          />
        </div>
      </section>
    </main>
  );
};

export default MainChatSection;
