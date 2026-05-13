import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface Highlight {
  id: string;
  text: string;
  color: string;
  paraKey: string;
  offset: number;
}

export interface Pin {
  id: string;
  text: string;
  fullText: string;
  paraKey?: string;
}

export interface Message {
  id: string;
  role: "user" | "ai";
  type: "text" | "thinking";
  text?: string;
  timestamp: string;
}

interface CaseState {
  highlights: Highlight[];
  pins: Pin[];
  messages: Message[];
}

interface AnalysisStore {
  cases: Record<string, CaseState>;
  
  // Actions
  updateCase: (caseId: string, updates: Partial<CaseState>) => void;
  getHighlights: (caseId: string) => Highlight[];
  getPins: (caseId: string) => Pin[];
  getMessages: (caseId: string) => Message[];
}

const DEFAULT_CASE_STATE: CaseState = {
  highlights: [],
  pins: [],
  messages: [],
};

export const useAnalysisStore = create<AnalysisStore>()(
  persist(
    (set, get) => ({
      cases: {},

      updateCase: (caseId, updates) => 
        set((state) => {
          const current = state.cases[caseId] || { ...DEFAULT_CASE_STATE };
          return {
            cases: {
              ...state.cases,
              [caseId]: { ...current, ...updates }
            }
          };
        }),

      getHighlights: (caseId) => get().cases[caseId]?.highlights || [],
      getPins: (caseId) => get().cases[caseId]?.pins || [],
      getMessages: (caseId) => get().cases[caseId]?.messages || [],
    }),
    {
      name: 'judgement-analysis-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
