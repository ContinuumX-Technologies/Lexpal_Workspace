import { create } from 'zustand';
import type { BlockNode } from './documentTypes';
import type { Editor } from '@tiptap/react';

interface DocumentStore {
  blockTree: BlockNode | null;
  activeBlockId: string | null;
  hoveredBlockId: string | null;
  editor: Editor | null;

  setBlockTree: (tree: BlockNode) => void;
  setActiveBlockId: (id: string | null) => void;
  setHoveredBlockId: (id: string | null) => void;
  setEditor: (editor: Editor | null) => void;
}

export const useDocumentStore = create<DocumentStore>((set) => ({
  blockTree: null,
  activeBlockId: null,
  hoveredBlockId: null,
  editor: null,

  setBlockTree: (tree) => set({ blockTree: tree }),
  setActiveBlockId: (id) => set({ activeBlockId: id }),
  setHoveredBlockId: (id) => set({ hoveredBlockId: id }),
  setEditor: (editor) => set({ editor }),
}));