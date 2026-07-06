import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  MinimalNode,
  SeqNodeMap,
  LexpalToSequentialMap,
  DependencyGraph,
  NodeMetadata,
} from '../AI_draft_editing/draftIndexer';

// Re-export so consumers can import from one place
export type { MinimalNode };
export type { DependencyGraph };

export interface DraftRuntimeMetadata {
  title: string;
  margins: Margins;
  typography: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
  };
}

export type DraftTaskStatus =
  | "pending"
  | "thinking"
  | "clarification_required"
  | "draft_completed"
  | "error";

export type EditTaskStatus =
  | "thinking"
  | "clarification_required"
  | "edit_completed"
  | "error";

export interface EditTask {
  id: string;
  prompt: string;
  status: EditTaskStatus;
  clarificationHistory: ClarificationPair[];
  currentClarificationQuestion?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface DraftEnrichment {
  artifactVersion: number;
  generatedAt?: string;
  derivedFromDocHash?: string;
  derivedFromStructureHash?: string;
  indexed: boolean;
  memosGenerated: boolean;
  minimalTreeGenerated: boolean;
  dependencyGraphGenerated: boolean;
  sequentialMapsGenerated: boolean;
  minimalTree?: MinimalNode;
  dependencyGraph?: DependencyGraph;
  sequentialToLexpalMap?: SeqNodeMap;
  lexpalToSequentialMap?: LexpalToSequentialMap;
  nodeMetadata?: Record<string, NodeMetadata>;

  /** @deprecated legacy key kept for storage compatibility */
  seqNodeMapGenerated?: boolean;
  /** @deprecated legacy key kept for storage compatibility */
  seqNodeMap?: SeqNodeMap;
}

export interface ClarificationPair {
  question: string;
  answer: string;
}

export type ProseMirrorJsonNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: ProseMirrorJsonNode[];
};

export interface DraftTask {
  id: string;
  prompt: string;
  status: DraftTaskStatus;
  clarificationHistory: ClarificationPair[];
  currentClarificationQuestion?: string;
  draftAnalysis?: string;
  prosemirrorJson?: ProseMirrorJsonNode;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ChatMessage {
  id: string;
  role: "user";
  text: string;
  timestamp: string;
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
  prosemirrorJson: ProseMirrorJsonNode | null;
  messages: ChatMessage[];
  tasks: DraftTask[];
  activeTaskId?: string;
  editTasks: EditTask[];
  enrichment: DraftEnrichment;
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
  appendUserMessage: (draftId: string, text: string) => string;
  createTask: (draftId: string, prompt: string, taskId?: string) => string;
  updateTask: (
    draftId: string,
    taskId: string,
    updater: (task: DraftTask) => DraftTask
  ) => void;
  retryTask: (draftId: string, taskId: string) => void;
  // Edit task actions
  createEditTask: (draftId: string, prompt: string) => string;
  updateEditTask: (
    draftId: string,
    taskId: string,
    updater: (task: EditTask) => EditTask
  ) => void;
  retryEditTask: (draftId: string, taskId: string) => void;
  // Enrichment actions
  setEnrichment: (draftId: string, enrichment: Partial<DraftEnrichment>) => void;
  assignDraft: (draftId: string, userId: string, userName: string, adminName: string, adminId: string) => void;
  addComment: (draftId: string, comment: Omit<Comment, 'id' | 'timestamp'>) => void;
  addActivity: (draftId: string, activity: Omit<Activity, 'id' | 'timestamp'>) => void;
}

const DEFAULT_MARGINS: Margins = { top: 25.4, bottom: 25.4, left: 25.4, right: 25.4 };

export const DEFAULT_ENRICHMENT: DraftEnrichment = {
  artifactVersion: 1,
  indexed: false,
  memosGenerated: false,
  minimalTreeGenerated: false,
  dependencyGraphGenerated: false,
  sequentialMapsGenerated: false,
  seqNodeMapGenerated: false,
};

export const DEFAULT_DRAFT_STATE: DraftState = {
  title: "Untitled Draft",
  updatedAt: new Date().toISOString(),
  prosemirrorJson: null,
  messages: [],
  tasks: [],
  activeTaskId: undefined,
  editTasks: [],
  enrichment: { ...DEFAULT_ENRICHMENT },
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

      appendUserMessage: (draftId, text) => {
        const id = crypto.randomUUID();
        set((state) => {
          const current = state.drafts[draftId] || { ...DEFAULT_DRAFT_STATE };
          return {
            drafts: {
              ...state.drafts,
              [draftId]: {
                ...current,
                messages: [
                  ...(current.messages || []),
                  {
                    id,
                    role: "user",
                    text,
                    timestamp: new Date().toISOString(),
                  },
                ],
                updatedAt: new Date().toISOString(),
              },
            },
          };
        });
        return id;
      },

      createTask: (draftId, prompt, taskId) => {
        const id = taskId ?? crypto.randomUUID();
        const now = new Date().toISOString();

        set((state) => {
          const current = state.drafts[draftId] || { ...DEFAULT_DRAFT_STATE };
          const nextTask: DraftTask = {
            id,
            prompt,
            status: "thinking",
            clarificationHistory: [],
            createdAt: now,
            updatedAt: now,
          };

          return {
            drafts: {
              ...state.drafts,
              [draftId]: {
                ...current,
                tasks: [...(current.tasks || []), nextTask],
                activeTaskId: id,
                updatedAt: now,
              },
            },
          };
        });

        return id;
      },

      updateTask: (draftId, taskId, updater) => {
        set((state) => {
          const current = state.drafts[draftId];
          if (!current) return state;

          const tasks = (current.tasks || []).map((task) => {
            if (task.id !== taskId) return task;
            const updated = updater(task);
            return {
              ...updated,
              updatedAt: new Date().toISOString(),
            };
          });

          return {
            drafts: {
              ...state.drafts,
              [draftId]: {
                ...current,
                tasks,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        });
      },

      retryTask: (draftId, taskId) => {
        set((state) => {
          const current = state.drafts[draftId];
          if (!current) return state;

          const tasks = (current.tasks || []).map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  status: "thinking" as const,
                  errorMessage: undefined,
                  updatedAt: new Date().toISOString(),
                }
              : task
          );

          return {
            drafts: {
              ...state.drafts,
              [draftId]: {
                ...current,
                tasks,
                activeTaskId: taskId,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        });
      },









      createEditTask: (draftId, prompt) => {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();


        set((state) => {
          const current = state.drafts[draftId] || { ...DEFAULT_DRAFT_STATE };
          const nextTask: EditTask = {
            id,
            prompt,
            status: "thinking",
            clarificationHistory: [],
            createdAt: now,
            updatedAt: now,
          };
          return {
            drafts: {
              ...state.drafts,
              [draftId]: {
                ...current,
                editTasks: [...(current.editTasks || []), nextTask],
                updatedAt: now,
              },
            },
          };
        });


        return id;
      },









      updateEditTask: (draftId, taskId, updater) => {
        set((state) => {
          const current = state.drafts[draftId];
          if (!current) return state;
          const editTasks = (current.editTasks || []).map((task) => {
            if (task.id !== taskId) return task;
            const updated = updater(task);
            return { ...updated, updatedAt: new Date().toISOString() };
          });
          return {
            drafts: {
              ...state.drafts,
              [draftId]: { ...current, editTasks, updatedAt: new Date().toISOString() },
            },
          };
        });
      },








      retryEditTask: (draftId, taskId) => {
        set((state) => {
          const current = state.drafts[draftId];
          if (!current) return state;
          const editTasks = (current.editTasks || []).map((task) =>
            task.id === taskId
              ? { ...task, status: "thinking" as const, errorMessage: undefined, updatedAt: new Date().toISOString() }
              : task
          );
          return {
            drafts: {
              ...state.drafts,
              [draftId]: { ...current, editTasks, updatedAt: new Date().toISOString() },
            },
          };
        });
      },







      setEnrichment: (draftId, enrichment) => {
        set((state) => {
          const current = state.drafts[draftId];
          if (!current) return state;
          return {
            drafts: {
              ...state.drafts,
              [draftId]: {
                ...current,
                enrichment: { ...current.enrichment, ...enrichment },
                updatedAt: new Date().toISOString(),
              },
            },
          };
        });
      },






      
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
