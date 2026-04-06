import { useState } from 'react';
import styles from './MenuBar.module.css';
import { useDraftspace } from './Draftspace.context';

import {
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  Heading,
  Type,
  Table as TableIcon,
  Scissors,
  Maximize2,
  Download,
  ChevronDown,
} from 'lucide-react';
import { exportToPDF, exportToDocx, exportToTxt, exportToHtml } from './utils/exportUtils';

export default function MenuBar({ editor }: { editor: any }) {
  const { margins, setMargins } = useDraftspace();
  const [showMargins, setShowMargins] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  if (!editor) return null;

  return (
    <div className={styles.toolbarWrapper}>
      <div className={styles.toolbar}>

        {/* Heading Dropdown */}
        <div className={styles.group}>
          <Heading size={16} />
          <select
            className={styles.select}
            onChange={(e) => {
              const level = Number(e.target.value);
              if (level === 0) {
                editor.chain().focus().setParagraph().run();
              } else {
                editor.chain().focus().setHeading({ level }).run();
              }
            }}
          >
            <option value={0}>P</option>
            <option value={1}>H1</option>
            <option value={2}>H2</option>
            <option value={3}>H3</option>
            <option value={4}>H4</option>
            <option value={5}>H5</option>
            <option value={6}>H6</option>
          </select>
        </div>

        <div className={styles.divider} />

        {/* Bold */}
        <button
          className={`${styles.iconButton} ${editor.isActive('bold') ? styles.active : ''}`}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold size={16} />
        </button>

        {/* Italic */}
        <button
          className={`${styles.iconButton} ${editor.isActive('italic') ? styles.active : ''}`}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic size={16} />
        </button>

        {/* Underline */}
        <button
          className={`${styles.iconButton} ${editor.isActive('underline') ? styles.active : ''}`}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <Underline size={16} />
        </button>

        <div className={styles.divider} />

        {/* Font Family */}
        <div className={styles.group}>
          <Type size={16} />
          <select
            className={styles.select}
            onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}
          >
            <option value="Times New Roman">Times</option>
            <option value="Arial">Arial</option>
            <option value="Georgia">Georgia</option>
            <option value="Courier New">Courier</option>
          </select>
        </div>

        {/* Font Size */}
        <div className={styles.group}>
          <Type size={14} />
          <select
            className={`${styles.select} ${styles.selectSmall}`}
            onChange={(e) => editor.chain().focus().setFontSize(e.target.value).run()}
          >
            <option value="12px">12</option>
            <option value="14px">14</option>
            <option value="16px">16</option>
            <option value="18px">18</option>
            <option value="24px">24</option>
            <option value="32px">32</option>
          </select>
        </div>

        <div className={styles.divider} />

        {/* Alignment */}
        <button
          className={`${styles.iconButton} ${editor.isActive({ textAlign: 'left' }) ? styles.active : ''}`}
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
        >
          <AlignLeft size={16} />
        </button>
        <button
          className={`${styles.iconButton} ${editor.isActive({ textAlign: 'center' }) ? styles.active : ''}`}
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
        >
          <AlignCenter size={16} />
        </button>
        <button
          className={`${styles.iconButton} ${editor.isActive({ textAlign: 'right' }) ? styles.active : ''}`}
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
        >
          <AlignRight size={16} />
        </button>

        <div className={styles.divider} />

        {/* Bullet List */}
        <button
          className={`${styles.iconButton} ${editor.isActive('bulletList') ? styles.active : ''}`}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List size={16} />
        </button>

        {/* Ordered List */}
        <button
          className={`${styles.iconButton} ${editor.isActive('orderedList') ? styles.active : ''}`}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Ordered list"
        >
          <ListOrdered size={16} />
        </button>
        <select
          className={styles.select}
          defaultValue="1"
          title="List style"
          onChange={(e) => {
            const val = e.target.value as '1' | 'a' | 'i';
            if (!editor.isActive('orderedList')) {
              editor.chain().focus().toggleOrderedList().run();
            }
            editor.chain().focus().setOrderedListType(val).run();
          }}
        >
          <option value="1">1.</option>
          <option value="a">a.</option>
          <option value="i">i.</option>
        </select>

        <div className={styles.divider} />

        {/* Insert Table */}
        <button
          className={styles.iconButton}
          onClick={() =>
            editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        >
          <TableIcon size={16} />
        </button>

        <div className={styles.divider} />

        {/* Page Break */}
        <button
          className={styles.iconButton}
          title="Insert Page Break (Cmd+Enter)"
          onClick={() => editor.chain().focus().setPageBreak().run()}
        >
          <Scissors size={16} />
        </button>

        {/* Margins */}
        <div className={styles.marginsWrapper}>
          <button
            className={`${styles.iconButton} ${showMargins ? styles.active : ''}`}
            title="Page Margins"
            onClick={() => setShowMargins(v => !v)}
          >
            <Maximize2 size={16} />
          </button>

          {showMargins && (
            <div className={styles.marginsPopover}>
              <div className={styles.marginsTitle}>Page Margins (mm)</div>
              <div className={styles.marginsGrid}>
                {(['top', 'bottom', 'left', 'right'] as const).map(side => (
                  <label key={side} className={styles.marginLabel}>
                    <span>{side.charAt(0).toUpperCase() + side.slice(1)}</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={margins[side]}
                      className={styles.marginInput}
                      onChange={e => setMargins({ [side]: Number(e.target.value) })}
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={styles.divider} />

        {/* Export Button with Dropdown */}
        <div className={styles.exportWrapper}>
          <button
            className={`${styles.iconButton} ${styles.exportButton} ${showExportMenu ? styles.active : ''}`}
            title="Download options"
            onClick={() => setShowExportMenu(v => !v)}
          >
            <Download size={16} />
            <span className={styles.exportText}>Download</span>
            <ChevronDown size={14} className={styles.chevron} />
          </button>

          {showExportMenu && (
            <div className={styles.exportMenu}>
              <button 
                className={styles.menuItem} 
                onClick={() => { exportToPDF(); setShowExportMenu(false); }}
              >
                PDF Document (.pdf)
              </button>
              <button 
                className={styles.menuItem} 
                onClick={() => { exportToDocx(editor.getHTML()); setShowExportMenu(false); }}
              >
                Microsoft Word (.docx)
              </button>
              <button 
                className={styles.menuItem} 
                onClick={() => { exportToTxt(editor.getText()); setShowExportMenu(false); }}
              >
                Plain Text (.txt)
              </button>
              <button 
                className={styles.menuItem} 
                onClick={() => { exportToHtml(editor.getHTML()); setShowExportMenu(false); }}
              >
                Web Page (.html)
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}