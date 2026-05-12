import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle } from '@tiptap/extension-text-style'
import FontFamily from '@tiptap/extension-font-family'
import TextAlign from '@tiptap/extension-text-align'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'

import { PageBreak } from './PageBreakExtension'
import { FontSize } from './FontSizeExtension'
import { OrderedListStyled } from './OrderedListStyled'
import { BlockId } from './editor/blockIdPlugin'
import { blockTreeToProseMirror } from './editor/blockToProseMirror'
import { proseMirrorToBlocks } from './editor/proseMirrorToBlocks'

import { useDocumentStore } from './store/documentStore'
import { useDraftStore } from './store/draftStore'
import { useDraftspace } from './Draftspace.context'

import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import MenuBar from './MenuBar'
import styles from './Editor.module.css'
import './EditorBlockHighlight.css'

const Tiptap = () => {

  const { margins } = useDraftspace()

  const setEditor = useDocumentStore(state => state.setEditor)
  
  const setActiveBlockId = useDocumentStore(state => state.setActiveBlockId)

  // Page width (A4 at 96dpi)
  const PAGE_WIDTH = 794 // px

  const blockTree = useDraftStore(state => state.drafts["default-draft"]?.blockTree ?? null);
  const updateDraft = useDraftStore(state => state.updateDraft);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ orderedList: false }),
      OrderedListStyled,
      Table,
      TableRow,
      TableCell,
      TableHeader,
      TextStyle,
      FontFamily,
      FontSize,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      PageBreak,
      BlockId,
    ],

    content: blockTree ? blockTreeToProseMirror(blockTree) : '<p>Hello World!</p>',

    onUpdate: ({ editor }) => {
      const json = editor.getJSON() as any;
      const newTree = proseMirrorToBlocks(json);
      
      // Update the persistent store
      updateDraft("default-draft", { blockTree: newTree });
    },

    onSelectionUpdate: ({ editor }) => {
      const { $from } = editor.state.selection

      let foundId: string | null = null

      for (let depth = $from.depth; depth >= 0; depth--) {
        const node = $from.node(depth)

        if (node.attrs?.blockId) {
          foundId = node.attrs.blockId
          break
        }
      }

      setActiveBlockId(foundId)
    },
  })


  

  // ✅ SINGLE SOURCE OF TRUTH → ZUSTAND ONLY
  useEffect(() => {
    setEditor(editor)

    return () => {
      setEditor(null)
    }
  }, [editor, setEditor])



  // mm → px
  const mmToPx = (mm: number) => `${(mm * 3.7795).toFixed(1)}px`

  const pageStyle = {
    '--margin-top': mmToPx(margins.top),
    '--margin-bottom': mmToPx(margins.bottom),
    '--margin-left': mmToPx(margins.left),
    '--margin-right': mmToPx(margins.right),
    '--page-width': `${PAGE_WIDTH}px`,
  } as CSSProperties




  return (
    <div className={styles.editorRoot}>
      <MenuBar editor={editor} />
      <div className={styles.desk} style={pageStyle}>
        <div id="draft-page-wrapper" className={styles.pageWrapper}>
          <div className={styles.editorSurface}>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default Tiptap
