import { create } from 'zustand';
import type { Editor } from '@tiptap/react';

interface DocumentStore {
  activeBlockId: string | null;
  hoveredBlockId: string | null;
  editor: Editor | null;

  setActiveBlockId: (id: string | null) => void;
  setHoveredBlockId: (id: string | null) => void;
  setEditor: (editor: Editor | null) => void;
}

export const useDocumentStore = create<DocumentStore>((set) => ({
  activeBlockId: null,
  hoveredBlockId: null,
  editor: null,

  setActiveBlockId: (id) => set({ activeBlockId: id }),
  setHoveredBlockId: (id) => set({ hoveredBlockId: id }),
  setEditor: (editor) => set({ editor }),
}));