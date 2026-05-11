import { useState, useRef, useEffect, useCallback } from "react";
import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import {
  ChatBubble,
  ChatBubbleAvatar,
  ChatBubbleMessage,
} from "@/components/ui/chat-bubble";
import { TextShimmerWave } from "@/components/ui/text-shimmer-wave";
import { useAnalysisStore } from "./store/analysisStore";
import type { Message } from "./store/analysisStore";

interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  caseId: string;
  judgementText: string;
}

const WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "ai",
  type: "text",
  text: "Hello! I've analysed this judgement. Ask me anything about it — facts, issues, court reasoning, or any legal questions you have.",
  timestamp: new Date().toISOString(),
};

export default function JudgementAiChat({ caseId, judgementText }: Props) {
  const { updateCase, getMessages } = useAnalysisStore();
  const storedMessages = getMessages(caseId);

  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initialised = useRef(false);

  // Seed welcome message exactly once per caseId
  useEffect(() => {
    if (!initialised.current && storedMessages.length === 0) {
      initialised.current = true;
      updateCase(caseId, { messages: [WELCOME_MESSAGE] });
    } else if (storedMessages.length > 0) {
      initialised.current = true;
    }
  }, [caseId, storedMessages.length, updateCase]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [storedMessages, loading]);

  const buildHistory = useCallback((): ChatHistoryItem[] =>
    storedMessages
      .filter((m) => m.type === "text")
      .map((m) => ({
        role: m.role === "ai" ? "assistant" : "user",
        content: m.text ?? "",
      })),
    [storedMessages]
  );

  const handleSend = async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;

    const thinkingId = crypto.randomUUID();

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      type: "text",
      text: trimmed,
      timestamp: new Date().toISOString(),
    };

    const thinkingMsg: Message = {
      id: thinkingId,
      role: "ai",
      type: "thinking",
      timestamp: new Date().toISOString(),
    };

    // Snapshot current messages before going async
    const snapshot = getMessages(caseId);
    updateCase(caseId, { messages: [...snapshot, userMsg, thinkingMsg] });
    setLoading(true);

    try {
      const history = buildHistory();
      const response = await fetch("/api/documents/judgement-analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ judgementText, query: trimmed, history }),
      });
      const data = await response.json();

      // Use fresh snapshot after await to avoid stale closure
      const afterSnapshot = getMessages(caseId).filter(
        (m) => m.id !== thinkingId
      );

      if (data.result) {
        const aiMsg: Message = {
          id: crypto.randomUUID(),
          role: "ai",
          type: "text",
          text: data.result,
          timestamp: new Date().toISOString(),
        };
        updateCase(caseId, { messages: [...afterSnapshot, aiMsg] });
      } else {
        updateCase(caseId, { messages: afterSnapshot });
      }
    } catch (err) {
      console.error("Chat failed:", err);
      updateCase(caseId, {
        messages: getMessages(caseId).filter((m) => m.id !== thinkingId),
      });
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#fcfcfc" }}>
      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          scrollbarWidth: "thin",
        }}
      >
        {storedMessages.map((msg) => {
          const variant = msg.role === "user" ? "sent" : "received";

          return (
            <ChatBubble key={msg.id} variant={variant}>
              {msg.role === "ai" && <ChatBubbleAvatar fallback="✦" />}

              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: "85%" }}>
                {msg.type === "text" && (
                  <ChatBubbleMessage variant={variant}>
                    <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{msg.text}</p>
                  </ChatBubbleMessage>
                )}

                {msg.type === "thinking" && (
                  <ChatBubbleMessage variant="received">
                    <TextShimmerWave className="font-mono text-sm" duration={1}>
                      Thinking...
                    </TextShimmerWave>
                  </ChatBubbleMessage>
                )}

                <span style={{ fontSize: 10, color: "#9ca3af", margin: "0 4px" }}>
                  {formatTime(msg.timestamp)}
                </span>
              </div>
            </ChatBubble>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 bg-white">
        <PromptInputBox
          onSend={handleSend}
          isLoading={loading}
          placeholder="Ask about this judgement…"
        />
      </div>
    </div>
  );
}
