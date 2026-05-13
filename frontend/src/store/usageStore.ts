import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface UsageStore {
  tokensUsed: number;
  tokenLimit: number;
  
  // Actions
  addUsage: (tokens: number) => void;
  resetUsage: () => void;
  setLimit: (limit: number) => void;
}

export const useUsageStore = create<UsageStore>()(
  persist(
    (set) => ({
      tokensUsed: 0,
      tokenLimit: 10000,

      addUsage: (tokens) => 
        set((state) => ({ 
          tokensUsed: Math.min(state.tokensUsed + tokens, state.tokenLimit) 
        })),

      resetUsage: () => set({ tokensUsed: 0 }),
      
      setLimit: (limit) => set({ tokenLimit: limit }),
    }),
    {
      name: 'lexpal-usage-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);

/**
 * Estimates token usage for a given string.
 * OpenAI rule of thumb: ~4 characters per token.
 */
export const estimateTokens = (text: string): number => {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
};
