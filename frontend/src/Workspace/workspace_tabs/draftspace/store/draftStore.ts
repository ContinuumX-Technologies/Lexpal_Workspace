import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { BlockNode } from '../store/documentTypes';

export interface Choice {
  label: string;
  value: string;
}

export interface Message {
  id: string;
  role: "user" | "ai";
  type: "text" | "thinking" | "choices" | "task_complete";
  text?: string;
  choices?: Choice[];
  timestamp: string; // ISO string for persistence
}

export interface Margins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface DraftState {
  blockTree: BlockNode | null;
  messages: Message[];
  margins: Margins;
  typography: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
  };
  activeTab: string;
}

interface DraftStore {
  drafts: Record<string, DraftState>;
  
  // Actions
  updateDraft: (draftId: string, updates: Partial<DraftState>) => void;
  getDraft: (draftId: string) => DraftState;
}

const DEFAULT_MARGINS: Margins = { top: 25.4, bottom: 25.4, left: 25.4, right: 25.4 };

export const DEFAULT_DRAFT_STATE: DraftState = {
  blockTree: null,
  messages: [
    {
      id: "welcome",
      role: "ai",
      type: "text",
      text: "Hello! I'm your document assistant. You can ask me questions about your document, or ask me to draft a new legal document for you.",
      timestamp: new Date().toISOString()
    }
  ],
  margins: DEFAULT_MARGINS,
  typography: {
    fontFamily: 'Inter, sans-serif',
    fontSize: 14,
    lineHeight: 1.6,
  },
  activeTab: "format-builder",
};

export const useDraftStore = create<DraftStore>()(
  persist(
    (set, get) => ({
      drafts: {},

      updateDraft: (draftId, updates) =>
        set((state) => {
          const current = state.drafts[draftId] || { ...DEFAULT_DRAFT_STATE };
          return {
            drafts: {
              ...state.drafts,
              [draftId]: { ...current, ...updates }
            }
          };
        }),

      getDraft: (draftId) => get().drafts[draftId] || DEFAULT_DRAFT_STATE,
    }),
    {
      name: 'lexpal-draftspace-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
