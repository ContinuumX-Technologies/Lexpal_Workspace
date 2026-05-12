import { createContext, useContext, useState } from "react"
import { useDocumentStore } from "./store/documentStore"
import { blockTreeToProseMirror } from "./editor/blockToProseMirror"
import type { BlockNode, Span } from "./store/documentTypes"
export type RightPanelTab = "ai-chat" | "placeholders" | "format-builder";
import type { ChatHistoryItem } from "./tabs/AiChat"
import { useUsageStore, estimateTokens } from "@/store/usageStore"


export interface Margins {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

interface DraftspaceContextType {
  sendAIMessage: (message: string, history: ChatHistoryItem[], templateChoice: string|null) => Promise<any>
  loading: boolean
   activeTab: RightPanelTab;
    setActiveTab: (tab: RightPanelTab) => void;
    margins: Margins;
    setMargins: (m: Partial<Margins>) => void;
    typography: { fontFamily: string; fontSize: number; lineHeight: number };
    setTypography: (t: Partial<{ fontFamily: string; fontSize: number; lineHeight: number }>) => void;
}
// ─── Defaults ─────────────────────────────────────────────────────────────────

const DraftspaceContext = createContext<DraftspaceContextType | null>(null)

import { useDraftStore, DEFAULT_DRAFT_STATE } from "./store/draftStore"

export function DraftspaceProvider({ children }: { children: React.ReactNode }) {
  const draftId = "default-draft";
  const { updateDraft, drafts } = useDraftStore();
  const { addUsage } = useUsageStore();
  const rawDraft = drafts[draftId] || DEFAULT_DRAFT_STATE;
  
  // Deep merge to handle cases where localStorage has old data missing new fields
  const currentDraft = {
    ...DEFAULT_DRAFT_STATE,
    ...rawDraft,
    margins: { ...DEFAULT_DRAFT_STATE.margins, ...rawDraft.margins },
    typography: { ...DEFAULT_DRAFT_STATE.typography, ...rawDraft.typography },
  };

  const editor = useDocumentStore(state => state.editor)
  const blockTree = currentDraft.blockTree as BlockNode | null;
  const setBlockTree = (tree: BlockNode) => updateDraft(draftId, { blockTree: tree });

  const [loading, setLoading] = useState(false)
  
  const activeTab = currentDraft.activeTab as RightPanelTab;
  const setActiveTab = (tab: RightPanelTab) => updateDraft(draftId, { activeTab: tab });

  const margins = currentDraft.margins;
  const setMargins = (m: Partial<Margins>) => 
    updateDraft(draftId, { margins: { ...margins, ...m } });

  const typography = currentDraft.typography;
  const setTypography = (t: Partial<{ fontFamily: string; fontSize: number; lineHeight: number }>) =>
    updateDraft(draftId, { typography: { ...typography, ...t } });

  const sendAIMessage = async (message: string, history: ChatHistoryItem[], templateChoice: string|null) => {

    if (!editor) return

    try {
      setLoading(true)

      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/documents/draftspace-ai`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message,
          history,
          blockTree,
          templateChoice
        })
      })

      const data = await response.json()

      // Track usage
      const queryUsage = estimateTokens(message);
      const dataStr = JSON.stringify(data);
      const responseUsage = estimateTokens(dataStr);
      addUsage(queryUsage + responseUsage);

      /**
       * ✅ CREATE NEW DOCUMENT
       */
      if (data.intent === "create_document") {

        const blocks: BlockNode[] = data.blocks
        if (!blocks) return

        const newTree: BlockNode = {
          id: "document",
          type: "document",
          children: blocks
        }

        setBlockTree(newTree)

        const pmDoc = blockTreeToProseMirror(newTree)

        editor.commands.setContent(pmDoc)

        return
      }

      /**
       * ✅ EDIT EXISTING DOCUMENT
       */
      if (data.intent === "edit_document") {

        const operations = data.operations
        if (!operations || !blockTree) return

        const updatedTree = applyOperations(blockTree, operations)

        setBlockTree(updatedTree)

        const pmDoc = blockTreeToProseMirror(updatedTree)

        editor.commands.setContent(pmDoc)

        return
      }

      /**
       * ✅ CHAT RESPONSE (Q&A)
       */
      if (data.intent === "chat_response") {
        return data
      }

      /**
       * ✅ CLARIFICATION FLOW
       */
      if (data.intent === "clarify") {
        return data
      }

    } catch (err) {
      console.error("Draftspace AI Error:", err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <DraftspaceContext.Provider
      value={{
        sendAIMessage,
        loading,
         activeTab,
                setActiveTab,
                 margins,
                 setMargins,
                 typography,
                 setTypography
      }}
    >
      {children}
    </DraftspaceContext.Provider>
  )
}

export function useDraftspace() {
  const ctx = useContext(DraftspaceContext)
  if (!ctx) {
    throw new Error("useDraftspace must be used inside DraftspaceProvider")
  }
  return ctx
}


type Operation =
  | { type: "rewrite"; blockId: string; spans: Span[] }
  | { type: "insert"; parentId: string; block: BlockNode }
  | { type: "delete"; blockId: string }

function applyOperations(tree: BlockNode, operations: Operation[]): BlockNode {

  const newTree: BlockNode = structuredClone(tree)

  for (const op of operations) {

    if (op.type === "rewrite") {
      const node = findNode(newTree, op.blockId)
      if (node) node.content = op.spans   // ✅ FIXED (content not spans)
    }

    if (op.type === "insert") {
      const parent = findNode(newTree, op.parentId)
      if (parent) {
        if (!parent.children) parent.children = []
        parent.children.push(op.block)
      }
    }

    if (op.type === "delete") {
      removeNode(newTree, op.blockId)
    }
  }

  return newTree
}

function findNode(tree: BlockNode, id: string): BlockNode | null {

  if (tree.id === id) return tree

  if (!tree.children) return null

  for (const child of tree.children) {
    const found = findNode(child, id)
    if (found) return found
  }

  return null
}

function removeNode(tree: BlockNode, id: string): void {

  if (!tree.children) return

  tree.children = tree.children.filter(child => child.id !== id)

  for (const child of tree.children) {
    removeNode(child, id)
  }
}