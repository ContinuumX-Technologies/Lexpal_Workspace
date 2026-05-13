import { useState } from "react"
import DocumentTree from "../tree/DocumentTree"
import { useDraftspace } from "../Draftspace.context"
import styles from "./FormatBuilderTab.module.css"

export default function FormatBuilderTab() {
  const [mode, setMode] = useState<"structure" | "layout">("structure")
  
  const draftCtx = useDraftspace();
  if (!draftCtx) return null;
  const { margins, setMargins, typography, setTypography } = draftCtx;

  return (
    <div className={styles.panel}>
      <div className={styles.tabHeader}>
        <div className={styles.segmentedControl}>
          <button 
            className={`${styles.tabBtn} ${mode === "structure" ? styles.tabBtnActive : ""}`}
            onClick={() => setMode("structure")}
          >
            Structure
          </button>
          <button 
            className={`${styles.tabBtn} ${mode === "layout" ? styles.tabBtnActive : ""}`}
            onClick={() => setMode("layout")}
          >
            Layout
          </button>
        </div>
        <p className={styles.description}>
          {mode === "structure" 
            ? "Visual overview of document hierarchy." 
            : "Configure page dimensions and margins."}
        </p>
      </div>

      <div className={styles.content}>
        {mode === "structure" ? (
          <DocumentTree />
        ) : (
          <div className={styles.layoutGrid}>
            <div className={styles.section}>
              <h4 className={styles.sectionTitle}>Page Margins (mm)</h4>
              <div className={styles.marginGroup}>
                <div className={styles.inputField}>
                  <label>Top</label>
                  <input 
                    type="number" 
                    value={margins.top} 
                    onChange={(e) => setMargins({ ...margins, top: Number(e.target.value) })}
                  />
                </div>
                <div className={styles.inputField}>
                  <label>Bottom</label>
                  <input 
                    type="number" 
                    value={margins.bottom} 
                    onChange={(e) => setMargins({ ...margins, bottom: Number(e.target.value) })}
                  />
                </div>
                <div className={styles.inputField}>
                  <label>Left</label>
                  <input 
                    type="number" 
                    value={margins.left} 
                    onChange={(e) => setMargins({ ...margins, left: Number(e.target.value) })}
                  />
                </div>
                <div className={styles.inputField}>
                  <label>Right</label>
                  <input 
                    type="number" 
                    value={margins.right} 
                    onChange={(e) => setMargins({ ...margins, right: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>

            <div className={styles.dropdownDivider} style={{ height: '1px', background: '#f3f4f6', margin: '8px 0' }}></div>

            <div className={styles.section}>
              <h4 className={styles.sectionTitle}>Typography</h4>
              <p className={styles.description}>Global font settings for legal drafting.</p>
              <div className={styles.marginGroup} style={{ marginTop: '12px' }}>
                <div className={styles.inputField}>
                  <label>Font Size (px)</label>
                  <input 
                    type="number" 
                    value={typography.fontSize} 
                    onChange={(e) => setTypography({ ...typography, fontSize: Number(e.target.value) })}
                  />
                </div>
                <div className={styles.inputField}>
                  <label>Font Family</label>
                  <select 
                    className={styles.selectField}
                    style={{ 
                      width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', 
                      borderRadius: '8px', fontSize: '14px', background: '#f9fafb' 
                    }}
                    value={typography.fontFamily}
                    onChange={(e) => setTypography({ ...typography, fontFamily: e.target.value })}
                  >
                    <option value="Inter, sans-serif">Inter (Modern)</option>
                    <option value="'Times New Roman', Times, serif">Times New Roman (Formal)</option>
                    <option value="'Courier New', Courier, monospace">Courier (Drafting)</option>
                  </select>
                </div>
                <div className={styles.inputField}>
                  <label>Line Height</label>
                  <input 
                    type="number" 
                    step="0.1"
                    value={typography.lineHeight} 
                    onChange={(e) => setTypography({ ...typography, lineHeight: Number(e.target.value) })}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}