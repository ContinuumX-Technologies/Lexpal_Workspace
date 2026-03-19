import { useState, useEffect } from "react"
import { useDocumentStore } from "../store/documentStore"
import type { BlockNode } from "../store/documentTypes"
import styles from "./Placeholders.module.css"
import { blockTreeToProseMirror } from "../editor/blockToProseMirror"

interface PlaceholderEntry {
  key: string
  value: string
}

/**
 * Extract placeholders from BlockTree
 */
function extractPlaceholders(tree: BlockNode | null): string[] {
  if (!tree) return []

  const regex = /\{\{(\s*[\w\s-]+?\s*)\}\}/g
  const found = new Set<string>()

  function traverse(node: BlockNode) {
    if (node.content) {
      for (const span of node.content) {
        let match: RegExpExecArray | null
        while ((match = regex.exec(span.text)) !== null) {
          found.add(match[1].trim())
        }
      }
    }

    if (node.children) {
      node.children.forEach(traverse)
    }
  }

  traverse(tree)
  return Array.from(found)
}

export default function Placeholders() {

  const blockTree = useDocumentStore(state => state.blockTree)
  const setBlockTree = useDocumentStore(state => state.setBlockTree)
  const editor = useDocumentStore(state => state.editor)

  const [entries, setEntries] = useState<PlaceholderEntry[]>([])
  const [applied, setApplied] = useState(false)

  /**
   * Detect placeholders from BlockTree
   */
  useEffect(() => {
    const keys = extractPlaceholders(blockTree)

    setEntries(prev => {
      const existingMap = new Map(prev.map(e => [e.key, e.value]))

      return keys.map(k => ({
        key: k,
        value: existingMap.get(k) ?? ""
      }))
    })

    setApplied(false)
  }, [blockTree])

  const updateValue = (key: string, value: string) => {
    setEntries(prev =>
      prev.map(e => e.key === key ? { ...e, value } : e)
    )
    setApplied(false)
  }

  /**
   * Apply placeholders directly to BlockTree
   */
  const handleApply = () => {
    if (!blockTree || !editor) return

    const newTree = structuredClone(blockTree)

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

    // ✅ Update store
    setBlockTree(newTree)

    // ✅ Update editor
    
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