import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle } from '@tiptap/extension-text-style'
import FontFamily from '@tiptap/extension-font-family'
import Color from '@tiptap/extension-color'
import Image from '@tiptap/extension-image'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
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

  const { margins, typography } = useDraftspace()

  const setEditor = useDocumentStore(state => state.setEditor)
  
  const setActiveBlockId = useDocumentStore(state => state.setActiveBlockId)

  // Page width (A4 at 96dpi)
  const PAGE_WIDTH = 794 // px

  const draftId = useDraftStore(state => state.activeDraftId);
  const blockTree = useDraftStore(state => state.drafts[draftId]?.blockTree ?? null);
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
      Color,
      Highlight.configure({
        multicolor: true,
      }),
      Underline,
      Image.configure({
        inline: true,
      }),
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
      updateDraft(draftId, { blockTree: newTree });
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

  // Sync editor content when draftId changes
  useEffect(() => {
    if (!editor) return;
    
    // Check if the current editor content is different from the blockTree
    // A simple way is just to set content when draftId changes
    const content = blockTree ? blockTreeToProseMirror(blockTree) : '<p></p>';
    
    // We only want to replace content if we just switched drafts
    editor.commands.setContent(content);
  }, [draftId, editor]);



  // mm → px
  const mmToPx = (mm: number) => `${(mm * 3.7795).toFixed(1)}px`

  const pageStyle = {
    '--margin-top': mmToPx(margins.top),
    '--margin-bottom': mmToPx(margins.bottom),
    '--margin-left': mmToPx(margins.left),
    '--margin-right': mmToPx(margins.right),
    '--font-family': typography?.fontFamily || 'Inter, sans-serif',
    '--font-size': `${typography?.fontSize || 14}px`,
    '--line-height': typography?.lineHeight || 1.6,
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
