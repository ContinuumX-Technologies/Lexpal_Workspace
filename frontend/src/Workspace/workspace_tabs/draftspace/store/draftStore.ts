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

export interface DraftState {
  title: string;
  updatedAt: string;
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
  activeDraftId: string;
  
  // Actions
  setActiveDraftId: (id: string) => void;
  createNewDraft: (title?: string) => string;
  deleteDraft: (draftId: string) => void;
  updateDraft: (draftId: string, updates: Partial<DraftState>) => void;
  getDraft: (draftId: string) => DraftState;
}

const DEFAULT_MARGINS: Margins = { top: 25.4, bottom: 25.4, left: 25.4, right: 25.4 };

export const DEFAULT_DRAFT_STATE: DraftState = {
  title: "Untitled Draft",
  updatedAt: new Date().toISOString(),
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
      drafts: {
        "default-draft": { ...DEFAULT_DRAFT_STATE, title: "Welcome Draft" }
      },
      activeDraftId: "default-draft",

      setActiveDraftId: (id) => set({ activeDraftId: id }),

      createNewDraft: (title = "Untitled Draft") => {
        const id = crypto.randomUUID();
        set((state) => ({
          drafts: {
            ...state.drafts,
            [id]: { ...DEFAULT_DRAFT_STATE, title, updatedAt: new Date().toISOString() }
          },
          activeDraftId: id,
        }));
        return id;
      },

      deleteDraft: (draftId) => {
        set((state) => {
          const newDrafts = { ...state.drafts };
          delete newDrafts[draftId];
          
          let newActiveId = state.activeDraftId;
          if (newActiveId === draftId) {
            const remainingIds = Object.keys(newDrafts);
            if (remainingIds.length > 0) {
              newActiveId = remainingIds[0];
            } else {
              // Create a default if all are deleted
              const id = "default-draft";
              newDrafts[id] = { ...DEFAULT_DRAFT_STATE, title: "Welcome Draft" };
              newActiveId = id;
            }
          }

          return {
            drafts: newDrafts,
            activeDraftId: newActiveId
          };
        });
      },

      updateDraft: (draftId, updates) =>
        set((state) => {
          const current = state.drafts[draftId] || { ...DEFAULT_DRAFT_STATE };
          return {
            drafts: {
              ...state.drafts,
              [draftId]: { ...current, ...updates, updatedAt: new Date().toISOString() }
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
