import { useState, useRef, useEffect } from "react"
import styles from "./AiChat.module.css"
import { Send } from "lucide-react"
import { useDraftspace } from "../Draftspace.context"

type MessageRole = "user" | "ai"

type MessageType =
  | "text"
  | "thinking"
  | "choices"
  | "task_complete"

interface Choice {
  label: string
  value: string
}

interface Message {
  id: string
  role: MessageRole
  type: MessageType
  text?: string
  choices?: Choice[]
  timestamp: Date
}

export interface ChatHistoryItem {
  role: "user" | "assistant"
  content: string
}

export default function AiChat() {

  const { sendAIMessage, loading } = useDraftspace()

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "ai",
      type: "text",
      text: "Hello! I'm your document assistant.",
      timestamp: new Date()
    }
  ])

  const [input, setInput] = useState("")

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
    timestamp: new Date()
  }])

  const history = buildHistory()
  const data = await sendAIMessage(userText, history, templateChoice)

  setMessages(prev => prev.filter(m => m.id !== thinkingId))
  if (!data) return

  // ── PHASE 1: show template choices ──
  if (data.intent === "clarify") {
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      role: "ai",
      type: "choices",
      text: data.text ?? "I found these templates. Which one fits your need?", // ✅ use backend text
      choices: (data.draft_choices ?? []).map((d: string) => ({
        label: d,
        value: d
      })),
      timestamp: new Date()
    }])
    return
  }

  // ── PHASE 2: document generated ──
  if (data.intent === "create_document") {
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      role: "ai",
      type: "task_complete",
      text: `Draft created: ${data.template_name}`, // ✅ show which template was used
      timestamp: new Date()
    }])
    // TODO: pass data.blocks to your editor context here
    return
  }
}

  /**
   * SEND MESSAGE
   */
  const handleSend = async () => {

    const trimmed = input.trim()
    if (!trimmed) return

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      type: "text",
      text: trimmed,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInput("")

    await handleAIResponse(trimmed, null)

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
  }

  /**
   * 🔥 HANDLE CHOICE CLICK (KEY FIX)
   */
  const handleChoice = async (choice: Choice) => {

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      type: "text",
      text: choice.label,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])

    // 🔥 PASS templateChoice HERE
    await handleAIResponse(choice.label, choice.value)
  }

  /**
   * KEYBOARD
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = "auto"
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
  }

  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

  return (
    <div className={styles.chat}>

      <div className={styles.messages}>

        {messages.map(msg => (
          <div
            key={msg.id}
            className={`${styles.messageRow} ${msg.role === "user" ? styles.userRow : styles.aiRow}`}
          >

            {msg.role === "ai" && (
              <div className={styles.avatar}>✦</div>
            )}

            <div className={styles.bubbleWrap}>

              <div className={`${styles.bubble} ${msg.role === "user" ? styles.userBubble : styles.aiBubble}`}>

                {msg.type === "text" && (
                  <p className={styles.bubbleText}>{msg.text}</p>
                )}

                {msg.type === "thinking" && (
                  <div className={styles.typingDots}>
                    <span /><span /><span />
                  </div>
                )}

                {msg.type === "task_complete" && (
                  <p className={styles.bubbleText}>✅ {msg.text}</p>
                )}

                {msg.type === "choices" && (
                  <div>
                    <p className={styles.bubbleText}>{msg.text}</p>

                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                      {msg.choices?.map(choice => (
                        <button
                          key={choice.value}
                          onClick={() => handleChoice(choice)}
                          style={{
                            border: "1px solid #e5e7eb",
                            padding: "6px 8px",
                            borderRadius: 6,
                            background: "#f9fafb",
                            cursor: "pointer"
                          }}
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              </div>

              <span className={styles.timestamp}>
                {formatTime(msg.timestamp)}
              </span>

            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />

      </div>

      <div className={styles.inputArea}>
        <div className={styles.inputBox}>

          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your document…"
            rows={1}
          />

          <button
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={!input.trim() || loading}
          >
            <Send size={14} />
          </button>

        </div>

        <p className={styles.hint}>
          ↵ Enter to send · Shift+↵ new line
        </p>

      </div>

    </div>
  )
}