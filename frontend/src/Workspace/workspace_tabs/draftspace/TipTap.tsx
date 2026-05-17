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
import { useUserStore, USERS } from '@/store/userStore'
import { useRef, useEffect } from 'react'
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
  const currentDraft = useDraftStore(state => state.drafts[draftId]);
  const blockTree = currentDraft?.blockTree ?? null;
  const updateDraft = useDraftStore(state => state.updateDraft);
  const addActivity = useDraftStore(state => state.addActivity);
  const { currentUser } = useUserStore();
  const baselineTreeRef = useRef<any>(null);
  const debounceTimerRef = useRef<any>(null);

  const isSenior = currentUser.role === "Senior Advocate";
  const isAssigned = currentDraft?.assignedTo === currentUser.id;
  const canEdit = isSenior || isAssigned;

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

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
      
      // Update the persistent store immediately for real-time sync
      updateDraft(draftId, { blockTree: newTree });

      // If we don't have a baseline for this typing session, set it now
      if (!baselineTreeRef.current) {
        baselineTreeRef.current = useDraftStore.getState().drafts[draftId]?.blockTree ?? null;
      }

      const summarizeChange = (oldTree: any, newTree: any) => {
        const extractAllText = (node: any): string => {
          if (!node) return '';
          let text = '';
          
          if (node.content && Array.isArray(node.content)) {
            for (const span of node.content) {
              if (span.text) text += span.text;
            }
          }
          
          if (node.children && Array.isArray(node.children)) {
            for (const child of node.children) {
              text += '\n' + extractAllText(child);
            }
          }
          
          return text;
        };

        const oldText = extractAllText(oldTree).trim();
        const newText = extractAllText(newTree).trim();

        if (oldText === newText) return '';

        if (!oldText && newText) {
          const preview = newText.split('\n')[0].slice(0, 100);
          return `Started draft: "${preview}${newText.length > 100 ? '…' : ''}"`;
        }

        if (oldText && !newText) return `Cleared all content`;

        const newLines = newText.split('\n').filter(l => l.trim());
        const oldWords = oldText.split(/\s+/).length;
        const newWords = newText.split(/\s+/).length;
        
        if (newWords > oldWords) {
          const added = newWords - oldWords;
          const newSnippet = newLines[newLines.length - 1]?.slice(0, 80) || newText.slice(-80);
          return `Added ~${added} words: "${newSnippet}${newSnippet.length >= 80 ? '…' : ''}"`;
        } else if (newWords < oldWords) {
          const deleted = oldWords - newWords;
          return `Deleted ~${deleted} words`;
        }

        const findDifference = (s1: string, s2: string) => {
          let i = 0;
          while (i < s1.length && i < s2.length && s1[i] === s2[i]) i++;
          
          let j = 0;
          while (j < (s1.length - i) && j < (s2.length - i) && s1[s1.length - 1 - j] === s2[s2.length - 1 - j]) j++;
          
          const context = 20;
          const start = Math.max(0, i - context);
          const end1 = s1.length - j + context;
          const end2 = s2.length - j + context;
          
          let oldPart = s1.slice(start, end1);
          let newPart = s2.slice(start, end2);
          
          if (start > 0) {
            oldPart = '…' + oldPart;
            newPart = '…' + newPart;
          }
          if (j > context) {
            oldPart += '…';
            newPart += '…';
          }
          
          return { oldPart, newPart };
        };

        const { oldPart, newPart } = findDifference(oldText, newText);
        return `Diff: [-${oldPart}][+${newPart}]`;
      };

      // Debounce activity logging
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      
      debounceTimerRef.current = setTimeout(() => {
        const currentBaseline = baselineTreeRef.current;
        const latestTree = useDraftStore.getState().drafts[draftId]?.blockTree ?? null;
        
        const summary = summarizeChange(currentBaseline, latestTree);
        
        if (summary) {
          addActivity(draftId, {
            userId: currentUser.id,
            userName: currentUser.name,
            type: 'edit' as const,
            description: 'Updated document content',
            details: summary
          });
          
          // After logging, the current state becomes the new baseline
          baselineTreeRef.current = latestTree;
        }
      }, 3000); // Wait for 3 seconds of inactivity
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

  // Sync editable state
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(canEdit);
  }, [editor, canEdit]);

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
            {!canEdit && (
              <div className={styles.readOnlyBadge}>
                <span className="material-symbols-outlined">lock</span>
                <span>
                  Read-only: Assigned to <b>{USERS.find(u => u.id === currentDraft?.assignedTo)?.name || 'another team member'}</b>
                </span>
              </div>
            )}
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default Tiptap
