import { useState, useRef, useEffect } from "react";
import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import {
  ChatBubble,
  ChatBubbleAvatar,
  ChatBubbleMessage,
} from "@/components/ui/chat-bubble";
import { TextShimmerWave } from "@/components/ui/text-shimmer-wave";

type MessageRole = "user" | "ai";
type MessageType = "text" | "thinking";

interface Message {
  id: string;
  role: MessageRole;
  type: MessageType;
  text?: string;
  timestamp: Date;
}

interface ChatHistoryItem {
  role: "user" | "assistant";
  content: string;
}

interface Props {
  judgementText: string;
}

export default function JudgementAiChat({ judgementText }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "ai",
      type: "text",
      text: "Hello! I've analysed this judgement. Ask me anything about it — facts, issues, court reasoning, or any legal questions you have.",
      timestamp: new Date(),
    },
  ]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const buildHistory = (): ChatHistoryItem[] =>
    messages
      .filter((m) => m.type === "text")
      .map((m) => ({
        role: m.role === "ai" ? "assistant" : "user",
        content: m.text || "",
      }));

  const handleSend = async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      type: "text",
      text: trimmed,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);

    const thinkingId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: thinkingId, role: "ai", type: "thinking", timestamp: new Date() },
    ]);
    setLoading(true);

    try {
      const history = buildHistory();
      const response = await fetch("/api/documents/judgement-analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          judgementText,
          query: trimmed,
          history,
        }),
      });
      const data = await response.json();

      setMessages((prev) => prev.filter((m) => m.id !== thinkingId));

      if (data.result) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "ai",
            type: "text",
            text: data.result,
            timestamp: new Date(),
          },
        ]);
      }
    } catch (err) {
      console.error("Chat failed:", err);
      setMessages((prev) => prev.filter((m) => m.id !== thinkingId));
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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
          scrollbarWidth: "thin" as const,
        }}
      >
        {messages.map((msg) => {
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
