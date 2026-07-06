import { useState, useEffect } from "react"
import { useDocumentStore } from "../store/documentStore"
import styles from "./Placeholders.module.css"
import type { ProseMirrorJsonNode } from "../store/draftStore"

interface PlaceholderEntry {
  key: string
  value: string
}

/**
 * Extract placeholders directly from ProseMirror JSON
 */
function extractPlaceholdersFromNode(node: ProseMirrorJsonNode | null | undefined, found: Set<string>) {
  if (!node) return

  if (typeof node.text === "string") {
    const regex = /{{(.*?)}}/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(node.text)) !== null) {
      const key = match[1]?.trim()
      if (key) found.add(key)
    }
  }

  if (Array.isArray(node.content)) {
    node.content.forEach((child) => extractPlaceholdersFromNode(child, found))
  }
}

function extractPlaceholders(doc: ProseMirrorJsonNode | null | undefined): string[] {
  const found = new Set<string>()
  extractPlaceholdersFromNode(doc, found)

  return Array.from(found)
}

import { useDraftStore } from "../store/draftStore"

export default function Placeholders() {
  const draftId = useDraftStore(state => state.activeDraftId)
  const draft = useDraftStore(state => state.drafts[draftId])
  const updateDraft = useDraftStore(state => state.updateDraft)
  const editor = useDocumentStore(state => state.editor)

  const [entries, setEntries] = useState<PlaceholderEntry[]>([])
  const [applied, setApplied] = useState(false)

  const detectPlaceholders = (doc: ProseMirrorJsonNode | null | undefined) => {
    const keys = extractPlaceholders(doc)

    setEntries(prev => {
      const existingMap = new Map(prev.map(e => [e.key, e.value]))

      return keys.map(k => ({
        key: k,
        value: existingMap.get(k) ?? ""
      }))
    })

    setApplied(false)
  }

  /**
   * Detect placeholders from editor content continuously
   */
  useEffect(() => {
    detectPlaceholders((editor?.getJSON() as ProseMirrorJsonNode | undefined) ?? draft?.prosemirrorJson)

    if (!editor) return

    const onEditorUpdate = () => {
      detectPlaceholders(editor.getJSON() as ProseMirrorJsonNode)
    }

    editor.on('update', onEditorUpdate)

    return () => {
      editor.off('update', onEditorUpdate)
    }
  }, [editor, draft?.prosemirrorJson])

  const updateValue = (key: string, value: string) => {
    setEntries(prev =>
      prev.map(e => e.key === key ? { ...e, value } : e)
    )
    setApplied(false)
  }

  /**
   * Apply placeholder values across entire ProseMirror tree.
   * No DOM mutation; editor state remains source of truth.
   */
  const handleApply = () => {
    const currentDoc = (editor?.getJSON() as ProseMirrorJsonNode | undefined) ?? draft?.prosemirrorJson
    if (!currentDoc) return

    const nextDoc = structuredClone(currentDoc)

    const replaceInNode = (node: ProseMirrorJsonNode) => {
      if (typeof node.text === "string") {
        let updatedText = node.text

        for (const { key, value } of entries) {
          if (!value.trim()) continue

          const pattern = new RegExp(
            `\\{\\{\\s*${key.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")}\\s*\\}\\}`,
            "g"
          )

          updatedText = updatedText.replace(pattern, value)
        }

        node.text = updatedText
      }

      if (Array.isArray(node.content)) {
        node.content.forEach(replaceInNode)
      }
    }

    replaceInNode(nextDoc)

    updateDraft(draftId, { prosemirrorJson: nextDoc })

    if (editor) {
      editor.commands.setContent(nextDoc, { emitUpdate: false })
    }

    setApplied(true)
  }

  const isEmpty = entries.length === 0

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <p className={styles.description}>
          Detected <code className={styles.code}>{"{{placeholders}}"}</code> from your document.
        </p>
      </div>

      {isEmpty ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>⬚</div>
          <p className={styles.emptyText}>No placeholders found.</p>
          <p className={styles.emptyHint}>
            Add <code className={styles.code}>{"{{your_field}}"}</code> in your draft.
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {entries.map(({ key, value }) => (
            <div key={key} className={styles.row}>
              <div className={styles.keyChip}>
                <span className={styles.braces}>{"{{ "}</span>
                <span className={styles.keyText}>{key}</span>
                <span className={styles.braces}>{" }}"}</span>
              </div>

              <input
                className={styles.valueInput}
                type="text"
                placeholder={`Value for ${key}…`}
                value={value}
                onChange={e => updateValue(key, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}

      {!isEmpty && (
        <div className={styles.footer}>
          <button
            className={`${styles.applyBtn} ${applied ? styles.applyBtnSuccess : ""}`}
            onClick={handleApply}
            disabled={!editor || applied}
          >
            {applied ? "✓ Applied" : "Apply to Document"}
          </button>
        </div>
      )}
    </div>
  )
}
