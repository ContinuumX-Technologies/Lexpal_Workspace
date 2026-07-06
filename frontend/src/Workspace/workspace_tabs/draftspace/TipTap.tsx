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

import { DraftMetadataExtension } from './editor_extensions/draftMetadata'

import { useDocumentStore } from './store/documentStore'
import { useDraftStore } from './store/draftStore'
import type { ProseMirrorJsonNode } from './store/draftStore'
import { useDraftspace } from './Draftspace.context'
import { useUserStore, USERS } from '@/store/userStore'
import { useRef, useEffect } from 'react'
import type { CSSProperties } from 'react'
import MenuBar from './MenuBar'
import styles from './Editor.module.css'
import './EditorBlockHighlight.css'

const EMPTY_DOC: ProseMirrorJsonNode = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

const extractAllTextFromProseMirror = (node: ProseMirrorJsonNode | null | undefined): string => {
  if (!node) return ''

  if (typeof node.text === 'string') {
    return node.text
  }

  if (!Array.isArray(node.content)) {
    return ''
  }

  return node.content.map(extractAllTextFromProseMirror).join('\n')
}

const Tiptap = () => {

  const { margins, typography } = useDraftspace()

  const setEditor = useDocumentStore(state => state.setEditor)
  
  const setActiveBlockId = useDocumentStore(state => state.setActiveBlockId)

  // Page width (A4 at 96dpi)
  const PAGE_WIDTH = 794 // px

  const draftId = useDraftStore(state => state.activeDraftId);
  const currentDraft = useDraftStore(state => state.drafts[draftId]);
  const prosemirrorJson = currentDraft?.prosemirrorJson ?? null;
  const updateDraft = useDraftStore(state => state.updateDraft);
  const addActivity = useDraftStore(state => state.addActivity);
  const { currentUser } = useUserStore();
  const baselineDocRef = useRef<ProseMirrorJsonNode | null>(null);
  const debounceTimerRef = useRef<any>(null);
  const draftIdRef = useRef(draftId);
  const userRef = useRef(currentUser);

  const isSenior = currentUser.role === "Senior Advocate";
  const isAssigned = currentDraft?.assignedTo === currentUser.id;
  const canEdit = isSenior || isAssigned;

  useEffect(() => {
    draftIdRef.current = draftId;
    userRef.current = currentUser;
  }, [draftId, currentUser]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  console.log("Initial PM JSON:", prosemirrorJson);// dev log to get initial draft pm json object

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
      
      DraftMetadataExtension
    ],

    content: prosemirrorJson ?? EMPTY_DOC,

    onUpdate: ({ editor }) => {
      const json = editor.getJSON() as ProseMirrorJsonNode;
      const activeDraftId = draftIdRef.current;

      // Persist ProseMirror JSON as source of truth
      updateDraft(activeDraftId, { prosemirrorJson: json });

      // If we don't have a baseline for this typing session, set it now
      if (!baselineDocRef.current) {
        baselineDocRef.current = useDraftStore.getState().drafts[activeDraftId]?.prosemirrorJson ?? null;
      }

      const summarizeChange = (oldDoc: ProseMirrorJsonNode | null, newDoc: ProseMirrorJsonNode | null) => {
        const oldText = extractAllTextFromProseMirror(oldDoc).trim();
        const newText = extractAllTextFromProseMirror(newDoc).trim();

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
        const activeDraftId = draftIdRef.current;
        const currentBaseline = baselineDocRef.current;
        const latestDoc = useDraftStore.getState().drafts[activeDraftId]?.prosemirrorJson ?? null;
        
        const summary = summarizeChange(currentBaseline, latestDoc);
        
        if (summary) {
          addActivity(activeDraftId, {
            userId: userRef.current.id,
            userName: userRef.current.name,
            type: 'edit' as const,
            description: 'Updated document content',
            details: summary
          });
          
          // After logging, the current state becomes the new baseline
          baselineDocRef.current = latestDoc;
        }
      }, 3000); // Wait for 3 seconds of inactivity
    },

    onSelectionUpdate: ({ editor }) => {
      const { $from } = editor.state.selection

      let foundId: string | null = null

      for (let depth = $from.depth; depth >= 0; depth--) {
        const node = $from.node(depth)

        if (node.attrs?.lexpalId) {
          foundId = node.attrs.lexpalId
          break
        }

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

    const content = useDraftStore.getState().drafts[draftId]?.prosemirrorJson ?? EMPTY_DOC;
    editor.commands.setContent(content, { emitUpdate: false });
    baselineDocRef.current = content;
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
