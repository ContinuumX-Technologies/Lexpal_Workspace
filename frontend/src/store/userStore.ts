import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface User {
  id: string;
  name: string;
  role: 'Senior Advocate' | 'Junior Advocate';
  avatar?: string;
}

interface UserStore {
  currentUser: User;
  availableUsers: User[];
  setCurrentUser: (id: string) => void;
}

export const USERS: User[] = [
  {
    id: 'user-senior',
    name: 'Adv. Yash Mishra',
    role: 'Senior Advocate',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Yash'
  },
  {
    id: 'user-junior',
    name: 'Junior Sarat',
    role: 'Junior Advocate',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarat'
  }
];

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      currentUser: USERS[0],
      availableUsers: USERS,
      setCurrentUser: (id) => {
        const user = USERS.find(u => u.id === id);
        if (user) set({ currentUser: user });
      }
    }),
    {
      name: 'lexpal-user-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
