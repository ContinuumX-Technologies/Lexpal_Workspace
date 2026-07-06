import { useEffect, useRef, useState } from "react";
import ChatInput from "./components/ChatInput";
import { useSidebar } from "./context/SidebarContext";
import styles from "./MainChatSection.module.css";
import LawCards, { type DiscoveredLaw } from "./components/LawCards";
import {
  type AttachedContextPreview,
  type ChatHistoryMessage,
  type OutboundContextObject,
  useLawSearchAttachments,
} from "./context/attachments.context";

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




type ChatMessage = {
  id?: string;
  sender: "AI" | "User";
  content: string;
  createdAt?: string;
  attachedContext?: AttachedContextPreview[];
  rawContent?: string;
  contextPayload?: OutboundContextObject;
  attachmentIds?: string[];
  discovered_laws?: DiscoveredLaw[];
};

const extractPromptFromContent = (
  content: string
) => {
  const newFormatMatch = content.match(
    /--- User Prompt ---\n([\s\S]*?)\n--- End User Prompt ---/
  );

  if (newFormatMatch?.[1]) {
    return newFormatMatch[1].trim();
  }

  const legacyRegex =
    /--- Context Attached ---\n([\s\S]*?)\n--- End Context ---\n\n/g;

  const legacyMatch = legacyRegex.exec(content);

  if (!legacyMatch) {
    return content;
  }

  return content.replace(legacyMatch[0], "").trim();
};

const extractAttachedContextPreview = (
  content: string
): AttachedContextPreview[] => {
  const previews: AttachedContextPreview[] = [];

  const attachedFileRegex =
    /Attached File -->\s*file\d+:\s*(.+)/g;

  let attachedFileMatch = attachedFileRegex.exec(content);

  while (attachedFileMatch) {
    previews.push({
      id: `history-${previews.length + 1}`,
      name: attachedFileMatch[1]?.trim() || "File",
      info: "",
    });

    attachedFileMatch = attachedFileRegex.exec(content);
  }

  if (previews.length > 0) {
    return previews;
  }

  const legacyRegex =
    /--- Context Attached ---\n([\s\S]*?)\n--- End Context ---\n\n/g;

  const legacyMatch = legacyRegex.exec(content);

  if (!legacyMatch) {
    return [];
  }

  const contextBlock = legacyMatch[1];
  const lines = contextBlock.split("\n");

  lines.forEach((line) => {
    if (line.includes("File Metadata -")) {
      const name =
        line
          .split("File Metadata -")[1]
          ?.split("(")[0]
          ?.trim() || "File";

      previews.push({
        id: `history-${previews.length + 1}`,
        name,
        info: "",
      });
    }
  });

  return previews;
};

const composeSocketContent = (
  prompt: string,
  context: OutboundContextObject
) => {
  const historyLabel =
    context.chat_history.length > 0
      ? context.chat_history
          .map(
            (msg, idx) =>
              `${idx + 1}. ${msg.sender}: ${msg.content}`
          )
          .join("\n\n")
      : "No recent conversation history.";

  const attachmentLabel =
    context.attachments.length > 0
      ? context.attachments
          .map(
            (file) =>
              `Attached File --> file${file.index}: ${file.file_name}\n${file.text_content}`
          )
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


  const server_url = import.meta.env.VITE_SERVER_URL;

  const { toggleSidebar,currentConvoId } = useSidebar();

  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [cursor, setCursor] = useState<string | null>(null);

  const [hasMore, setHasMore] = useState(true);

  const [isFetching, setIsFetching] = useState(false);

  const [isProcessing, setIsProcessing] = useState(false);

  const [socketReady, setSocketReady] = useState(false);

  const [connectionError, setConnectionError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);

  const chatAreaRef = useRef<HTMLDivElement | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const [socketVersion, setSocketVersion] = useState(0);

  const [showShareToast, setShowShareToast] = useState(false);

  const [activeMoreMenuIndex, setActiveMoreMenuIndex] =
    useState<number | null>(null);

  // ── AI mode states ──────────────────────────────────────────────
  const [chatMode, setChatMode] = useState<"basic_chat" | "reasoning_chat">("basic_chat");
  const [reasoningMode, setReasoningMode] = useState<"lite" | "deep">("lite");

  const {
    buildPayload,
    clearSelectedAttachments,
  } = useLawSearchAttachments();

  const toggleChatMode = () =>
    setChatMode((prev) =>
      prev === "basic_chat" ? "reasoning_chat" : "basic_chat"
    );







  // parse historic user messages with both old and new context formats
  const parseMessageWithContext = (
    msg: any
  ): ChatMessage => {
    const baseMsg = {
      id: msg._id,
      sender: msg.sender as "AI" | "User",
      content: msg.content,
      createdAt: msg.createdAt,
      rawContent: msg.content,
      attachmentIds: Array.isArray(msg.attachments)
        ? msg.attachments
        : [],
    };

    if (msg.sender === "AI") {
      return baseMsg;
    }

    const prompt = extractPromptFromContent(
      msg.content
    );

    const attachedContext =
      extractAttachedContextPreview(msg.content);

    return {
      ...baseMsg,
      content: prompt,
      attachedContext:
        attachedContext.length > 0
          ? attachedContext
          : undefined,
    };
  };







  //Convo history loader
  useEffect(() => {
    const fetchHistory = async (convoId: string) => {
      setIsFetching(true);

      setConnectionError(null);

      setMessages([]);

      setCursor(null);

      setHasMore(true);

      try {
        const res = await fetch(
          `${server_url}/api/AI/convo-history/${convoId}`,
          {
            credentials: "include",
          }
        );

        if (!res.ok) {
          throw new Error("Failed to load history");
        }

        const data = await res.json();

        const parsed = data.messages.map((m: any) =>
          parseMessageWithContext(m)
        );

        setMessages(parsed);

        setHasMore(false);
      } catch (err) {
        console.error(err);

        setConnectionError("Could not load history");
      } finally {
        setIsFetching(false);
      }
    };

    if (currentConvoId && currentConvoId !== "new") {
      fetchHistory(currentConvoId);
    } else {
      setMessages([]);
    }
  }, [currentConvoId]);







  //web socket connector and websocket message incoming from server handler
  useEffect(() => {
    setSocketReady(false);

    setConnectionError(null);

    let isMounted = true;

    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connectWebSocket = () => {
      if (socketRef.current) {
        socketRef.current.close();

        socketRef.current = null;
      }

      const serverHost =
        server_url?.replace(/^https?:\/\//, "") ||
        "localhost:3001";

      const wsProtocol = server_url?.startsWith(
        "https://"
      )
        ? "wss://"
        : "ws://";

      const wsUrl =
        currentConvoId === null
          ? `${wsProtocol}${serverHost}/ws/ai-counsel-chat`
          : `${wsProtocol}${serverHost}/ws/ai-counsel-chat?convo_id=${currentConvoId}`;

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
          const payload = JSON.parse(event.data);

          if (payload.type === "ai_message") {
            setMessages((prev) => [
              ...prev,
              {
                sender: "AI",
                content: payload.content,
                discovered_laws: payload.discovered_laws ?? [],
              },
            ]);

            setIsProcessing(false);
          }
        } catch (error) {
          console.log(error);
        }
      };





      socket.onerror = () => {
        if (isMounted) {
          setConnectionError("Connection error.");

          setSocketReady(false);
        }
      };





      socket.onclose = (event) => {
        if (!isMounted) return;

        setSocketReady(false);

        if (event.code !== 1000) {
          reconnectTimeout = setTimeout(() => {
            if (isMounted) {
              connectWebSocket();
            }
          }, 3000);
        }
        else{
          



  console.log("WS CLOSED", event.code, event.reason);


        }
      };



    };



    connectWebSocket();



    return () => {
      isMounted = false;

      clearTimeout(reconnectTimeout);

      if (socketRef.current) {
        socketRef.current.close(
          1000,
          "Cleanup"
        );

        socketRef.current = null;
      }
    };
  }, [currentConvoId, socketVersion]);








  //scroll to bottom of chat on new message 
  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);








  //fetch more historic messages in conversation on scroll to top
  const handleScroll = async () => {
    if (
      !chatAreaRef.current ||
      isFetching ||
      !hasMore ||
      !cursor ||
      !currentConvoId ||
      chatAreaRef.current.scrollTop > 50
    ) {
      return;
    }

    setIsFetching(true);

    try {
      const res = await fetch(
        `${server_url}/api/AI/convo-history/${currentConvoId}?cursor=${cursor}`,
        {
          credentials: "include",
        }
      );

      if (!res.ok) {
        setIsFetching(false);

        return;
      }

      const data = await res.json();

      const parsedMessages =
        data.messages.map(parseMessageWithContext);

      setMessages((prev) => [
        ...parsedMessages,
        ...prev,
      ]);

      setCursor(data.nextCursor);

      setHasMore(data.hasMore);

      setIsFetching(false);
    } catch (error) {
      console.log(error);

      setIsFetching(false);
    }
  };







  const sendToSocket = async ({
    content,
    attachmentIds = [],
  }: {
    content: string;
    attachmentIds?: string[];
  }) => {
    if (!socketRef.current || !socketReady) {
      return false;
    }

    const payload: any = {
      content,
      attachments: attachmentIds,
      chat_mode: chatMode,
      ...(chatMode === "reasoning_chat" && { reasoning_mode: reasoningMode }),
    };

    socketRef.current.send(JSON.stringify(payload));

    return true;
  };








  const sendMessage = async (text: string) => {
    if (
      !text.trim() ||
      !socketRef.current ||
      !socketReady ||
      isProcessing
    ) {
      return false;
    }

    const historyMessages: ChatHistoryMessage[] =
      messages
        .slice(-10)
        .map((msg) => ({
          sender: msg.sender,
          content: msg.content,
        }));

    const payloadResult = buildPayload(
      historyMessages
    );

    if (!payloadResult.ok) {
      setConnectionError(payloadResult.error);
      return false;
    }

    setConnectionError(null);
    setIsProcessing(true);

    const finalContent = composeSocketContent(
      text,
      payloadResult.context
    );

    setMessages((prev) => [
      ...prev,
      {
        sender: "User",
        content: text,
        attachedContext:
          payloadResult.attachedContextPreview
            .length > 0
            ? payloadResult.attachedContextPreview
            : undefined,
        rawContent: finalContent,
        contextPayload: payloadResult.context,
        attachmentIds: payloadResult.attachmentIds,
      },
    ]);

    const sent = await sendToSocket({
      content: finalContent,
      attachmentIds: payloadResult.attachmentIds,
    });

    if (!sent) {
      setIsProcessing(false);
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

    if (lastUserMsgIndex !== -1) {
      const lastUserMsg =
        messages[lastUserMsgIndex];

      setMessages((prev) =>
        prev.slice(0, lastUserMsgIndex + 1)
      );

      const sent = await sendToSocket({
        content:
          lastUserMsg.rawContent ||
          lastUserMsg.content,
        attachmentIds:
          lastUserMsg.attachmentIds || [],
      });

      if (!sent) {
        setIsProcessing(false);
      } else {
        setIsProcessing(true);
      }
    }
  };







  const handleShare = () => {
    navigator.clipboard.writeText(
      window.location.href
    );

    setShowShareToast(true);

    setTimeout(() => {
      setShowShareToast(false);
    }, 2000);
  };




//stop response generation
  const handleStop = () => {
    if (socketRef.current) {
      socketRef.current.close(
        1000,
        "User stopped generation"
      );
    }

    setIsProcessing(false);

    setSocketVersion((v) => v + 1);
  };




  
  






  return (
    <main className={styles.main}>
      {showShareToast && (
        <div className={styles.toast}>
          Link copied to clipboard
        </div>
      )}

      <section className={styles.chatInterface}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <button
              className={styles.iconButton}
              onClick={toggleSidebar}
              title="Toggle sidebar"
            >
              <PanelLeft size={18} />
            </button>
          </div>

          <div className={styles.headerCenter}>
            <h1 className={styles.title}>Lexpal AI</h1>
            <span className={styles.headerSubtext}>AI Legal Counsel</span>
          </div>

          <div className={styles.headerRight} />
        </div>

        <div
          className={styles.chatArea}
          ref={chatAreaRef}
          onScroll={handleScroll}
        >
          <div className={styles.messageWrapper}>
            {connectionError && (
              <div className={styles.errorMessage}>
                {connectionError}
              </div>
            )}

            {messages.length === 0 &&
              !isFetching && (
                <div
                  className={styles.aiMessage}
                  style={{
                    alignSelf: "center",
                    textAlign: "center",
                    background: "transparent",
                    color:
                      "var(--text-secondary)",
                    boxShadow: "none",
                  }}
                >
                  <div
                    style={{
                      marginBottom: 16,
                    }}
                  >
                    <Sparkles
                      size={48}
                      strokeWidth={1}
                      style={{
                        opacity: 0.2,
                      }}
                    />
                  </div>

                  <p>Hello! I am Lexpal AI.</p>

                  <p
                    style={{
                      fontSize: "0.9em",
                      opacity: 0.8,
                    }}
                  >
                    Select context or start typing
                    to begin.
                  </p>
                </div>
              )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={
                  msg.sender === "User"
                    ? styles.userMessageWrapper
                    : styles.aiMessage
                }
              >
                {msg.sender === "AI" ? (
                  <div className={styles.markdownContent}>
                    <ReactMarkdown>{msg.content}</ReactMarkdown>

                    {/* Discovered laws from server */}
                    {msg.discovered_laws && msg.discovered_laws.length > 0 && (
                      <LawCards laws={msg.discovered_laws} />
                    )}

                    <div className={styles.actionToolbar}>
                      <button
                        className={
                          styles.actionToolbarBtn
                        }
                        onClick={() =>
                          navigator.clipboard.writeText(
                            msg.content
                          )
                        }
                      >
                        <Copy size={18} />
                      </button>

                      <button
                        className={
                          styles.actionToolbarBtn
                        }
                        onClick={
                          handleRegenerate
                        }
                      >
                        <RotateCw size={18} />
                      </button>

                      <button
                        className={
                          styles.actionToolbarBtn
                        }
                        onClick={handleShare}
                      >
                        <Share size={18} />
                      </button>

                      <button
                        className={
                          styles.actionToolbarBtn
                        }
                        onClick={() =>
                          setActiveMoreMenuIndex(
                            activeMoreMenuIndex ===
                              i
                              ? null
                              : i
                          )
                        }
                      >
                        <MoreHorizontal
                          size={18}
                        />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className={
                      styles.userMessageBubble
                    }
                  >
                    {msg.content}
                  </div>
                )}
              </div>
            ))}

            {isProcessing && (
              <div className={styles.aiMessage}>
                <TextShimmer duration={1}>
                  Thinking...
                </TextShimmer>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        <div className={styles.inputArea}>
          {/* Reasoning depth selector — visible only when reasoning is on */}
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
