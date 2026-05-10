import { useState, useEffect } from "react"
import { useDocumentStore } from "../store/documentStore"
import type { BlockNode } from "../store/documentTypes"
import styles from "./Placeholders.module.css"
import { blockTreeToProseMirror } from "../editor/blockToProseMirror"
import { proseMirrorToBlocks } from "../editor/proseMirrorToBlocks"

interface PlaceholderEntry {
  key: string
  value: string
}

/**
 * Extract placeholders from raw text
 */
function extractPlaceholders(text: string): string[] {
  if (!text) return []

  const regex = /\{\{(\s*[\w\s-]+?\s*)\}\}/g
  const found = new Set<string>()
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    found.add(match[1].trim())
  }

  return Array.from(found)
}

export default function Placeholders() {

  const setBlockTree = useDocumentStore(state => state.setBlockTree)
  const editor = useDocumentStore(state => state.editor)

  const [entries, setEntries] = useState<PlaceholderEntry[]>([])
  const [applied, setApplied] = useState(false)

  const detectPlaceholders = () => {
    if (!editor) return
    const text = editor.getText()
    const keys = extractPlaceholders(text)

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
    if (!editor) return

    detectPlaceholders()

    editor.on('update', detectPlaceholders)

    return () => {
      editor.off('update', detectPlaceholders)
    }
  }, [editor])

  const updateValue = (key: string, value: string) => {
    setEntries(prev =>
      prev.map(e => e.key === key ? { ...e, value } : e)
    )
    setApplied(false)
  }

  /**
   * Apply placeholders directly to Editor state, preserving user edits
   */
  const handleApply = () => {
    if (!editor) return

    // 1. Sync current editor state to blocks to preserve all user edits
    const currentTree = proseMirrorToBlocks(editor.getJSON() as any)
    const newTree = structuredClone(currentTree)

    // 2. Replace placeholders within the blocks
    function replaceInNode(node: BlockNode) {
      if (node.content) {
        node.content = node.content.map(span => {
          let text = span.text

          for (const { key, value } of entries) {
            if (!value) continue

            const pattern = new RegExp(
              `\\{\\{\\s*${key.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")}\\s*\\}\\}`,
              "g"
            )

            text = text.replace(pattern, value)
          }

          return { ...span, text }
        })
      }

      if (node.children) {
        node.children.forEach(replaceInNode)
      }
    }

    replaceInNode(newTree)

    // 3. Update store
    setBlockTree(newTree)

    // 4. Update editor with the new content
    const pmDoc = blockTreeToProseMirror(newTree)
    editor.commands.setContent(pmDoc)

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