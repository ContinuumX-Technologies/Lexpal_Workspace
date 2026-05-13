import { useRef, useEffect } from "react"
import { useDraftspace } from "../Draftspace.context"
import { PromptInputBox } from "@/components/ui/ai-prompt-box"
import {
  ChatBubble,
  ChatBubbleAvatar,
  ChatBubbleMessage,
} from "@/components/ui/chat-bubble"
import { TextShimmerWave } from "@/components/ui/text-shimmer-wave"

import { useDraftStore } from "../store/draftStore"
import type { Message as StoreMessage, Choice } from "../store/draftStore"

export interface ChatHistoryItem {
  role: "user" | "assistant"
  content: string
}


export default function AiChat() {
  const draftId = useDraftStore(state => state.activeDraftId);
  const { updateDraft, drafts } = useDraftStore();
  const messages = (drafts[draftId]?.messages || []) as StoreMessage[];

  const setMessages = (updater: StoreMessage[] | ((prev: StoreMessage[]) => StoreMessage[])) => {
    // Use getState() to ensure we have the most recent messages, avoiding race conditions
    const currentMessages = useDraftStore.getState().drafts[draftId]?.messages || [];
    const nextMessages = typeof updater === "function" ? updater(currentMessages) : updater;
    updateDraft(draftId, { messages: nextMessages });
  };

  const { sendAIMessage, loading } = useDraftspace()

  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, loading])

  /**
   * BUILD HISTORY
   */
  const buildHistory = (): ChatHistoryItem[] => {
    return messages
      .filter(m => m.type === "text" || m.type === "task_complete")
      .map(m => ({
        role: m.role === "ai" ? "assistant" : "user",
        content: m.text || ""
      }))
  }

  /**
   * MAIN AI FLOW
   */
  const handleAIResponse = async (
    userText: string,
    templateChoice: string | null
  ) => {
    const thinkingId = crypto.randomUUID()

    setMessages(prev => [...prev, {
      id: thinkingId,
      role: "ai",
      type: "thinking",
      timestamp: new Date().toISOString()
    }])

    const history = buildHistory()
    const data = await sendAIMessage(userText, history, templateChoice)

    setMessages(prev => prev.filter(m => m.id !== thinkingId))
    if (!data) return

    // ── PHASE 0: direct chat answer ──
    if (data.intent === "chat_response") {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: "ai",
        type: "text",
        text: data.text ?? "I'm not sure how to answer that.",
        timestamp: new Date().toISOString()
      }])
      return
    }

    // ── PHASE 1: show template choices ──
    if (data.intent === "clarify") {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: "ai",
        type: "choices",
        text: data.text ?? "I found these templates. Which one fits your need?",
        choices: (data.draft_choices ?? []).map((d: string) => ({
          label: d,
          value: d
        })),
        timestamp: new Date().toISOString()
      }])
      return
    }

    // ── PHASE 2: document generated ──
    if (data.intent === "create_document") {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: "ai",
        type: "task_complete",
        text: `Draft created: ${data.template_name}`,
        timestamp: new Date().toISOString()
      }])
      return
    }
  }

  /**
   * SEND MESSAGE (called by PromptInputBox)
   */
  const handleSend = async (message: string) => {

    const trimmed = message.trim()
    if (!trimmed) return

    const userMessage: StoreMessage = {
      id: crypto.randomUUID(),
      role: "user",
      type: "text",
      text: trimmed,
      timestamp: new Date().toISOString()
    }

    setMessages(prev => [...prev, userMessage])

    await handleAIResponse(trimmed, null)
  }

  /**
   * HANDLE CHOICE CLICK
   */
  const handleChoice = async (choice: Choice) => {

    const userMessage: StoreMessage = {
      id: crypto.randomUUID(),
      role: "user",
      type: "text",
      text: choice.label,
      timestamp: new Date().toISOString()
    }

    setMessages(prev => [...prev, userMessage])

    await handleAIResponse(choice.label, choice.value)
  }

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

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
        {messages.map(msg => {
          const variant = msg.role === "user" ? "sent" : "received"

          return (
            <ChatBubble key={msg.id} variant={variant}>
              {/* Avatar for AI messages */}
              {msg.role === "ai" && (
                <ChatBubbleAvatar fallback="✦" />
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: "85%" }}>
                {/* Text message */}
                {msg.type === "text" && (
                  <ChatBubbleMessage variant={variant}>
                    <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{msg.text}</p>
                  </ChatBubbleMessage>
                )}

                {/* Thinking / Loading */}
                {msg.type === "thinking" && (
                  <ChatBubbleMessage variant="received">
                    <TextShimmerWave className="font-mono text-sm" duration={1}>
                      Thinking...
                    </TextShimmerWave>
                  </ChatBubbleMessage>
                )}

                {/* Task complete */}
                {msg.type === "task_complete" && (
                  <ChatBubbleMessage variant="received">
                    <p style={{ margin: 0 }}>✅ {msg.text}</p>
                  </ChatBubbleMessage>
                )}

                {/* Choices */}
                {msg.type === "choices" && (
                  <ChatBubbleMessage variant="received">
                    <p style={{ margin: 0, marginBottom: 8 }}>{msg.text}</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {msg.choices?.map(choice => (
                        <button
                          key={choice.value}
                          onClick={() => handleChoice(choice)}
                          className="border border-[#e5e7eb] px-3 py-1.5 rounded-lg bg-[#f9fafb] cursor-pointer text-sm hover:bg-[#f3f4f6] transition-colors text-left"
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                  </ChatBubbleMessage>
                )}

                {/* Timestamp */}
                <span style={{ fontSize: 10, color: "#9ca3af", margin: "0 4px" }}>
                  {formatTime(msg.timestamp)}
                </span>
              </div>
            </ChatBubble>
          )
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Premium AI Prompt Box */}
      <div className="p-4 bg-white">
        <PromptInputBox
          onSend={(message) => handleSend(message)}
          isLoading={loading}
          placeholder="Ask about your document…"
        />
      </div>

    </div>
  )
}