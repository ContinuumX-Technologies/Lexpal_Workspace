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

export interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  timestamp: string;
}

export interface Activity {
  id: string;
  userId: string;
  userName: string;
  type: 'edit' | 'comment' | 'assign' | 'create';
  description: string;
  details?: string; // optional short summary of what changed
  timestamp: string;
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
  assignedTo?: string; // User ID
  comments: Comment[];
  activityLog: Activity[];
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
  assignDraft: (draftId: string, userId: string, userName: string, adminName: string, adminId: string) => void;
  addComment: (draftId: string, comment: Omit<Comment, 'id' | 'timestamp'>) => void;
  addActivity: (draftId: string, activity: Omit<Activity, 'id' | 'timestamp'>) => void;
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
  comments: [],
  activityLog: [],
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

      assignDraft: (draftId, userId, userName, adminName, adminId) => 
        set((state) => {
          const current = state.drafts[draftId];
          if (!current) return state;

          const newActivity: Activity = {
            id: crypto.randomUUID(),
            userId: adminId,
            userName: adminName,
            type: 'assign',
            description: `Assigned draft to ${userName}`,
            timestamp: new Date().toISOString()
          };

          return {
            drafts: {
              ...state.drafts,
              [draftId]: { 
                ...current, 
                assignedTo: userId, 
                activityLog: [newActivity, ...(current.activityLog || [])].slice(0, 50),
                updatedAt: new Date().toISOString() 
              }
            }
          };
        }),

      addComment: (draftId, comment) =>
        set((state) => {
          const current = state.drafts[draftId];
          if (!current) return state;
          const newComment: Comment = {
            ...comment,
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString()
          };
          return {
            drafts: {
              ...state.drafts,
              [draftId]: {
                ...current,
                comments: [...(current.comments || []), newComment],
                activityLog: [{
                  id: crypto.randomUUID(),
                  userId: comment.authorId,
                  userName: comment.authorName,
                  type: 'comment' as const,
                  description: `Added a comment: "${comment.text.substring(0, 30)}${comment.text.length > 30 ? '...' : ''}"`,
                  timestamp: new Date().toISOString()
                } as Activity, ...(current.activityLog || [])].slice(0, 50),
                updatedAt: new Date().toISOString()
              }
            }
          };
        }),

      addActivity: (draftId, activity) =>
        set((state) => {
          const current = state.drafts[draftId];
          if (!current) return state;
          
          const newActivity: Activity = {
            id: crypto.randomUUID(),
            userId: activity.userId,
            userName: activity.userName,
            type: activity.type as any, // Cast to any to satisfy the union if coming from partial
            description: activity.description,
            details: (activity as any).details,
            timestamp: new Date().toISOString()
          };

          // Limit log to last 50 items to keep storage clean
          const newLog = [newActivity, ...(current.activityLog || [])].slice(0, 50);

          return {
            drafts: {
              ...state.drafts,
              [draftId]: {
                ...current,
                activityLog: newLog
              }
            }
          };
        }),
    }),
    {
      name: 'lexpal-draftspace-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
