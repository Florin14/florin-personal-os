import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface WorkspaceState {
  currentWorkspaceId: string | null;
  setCurrentWorkspaceId: (id: string | null) => void;
}

/** The workspace (personal or business) the user is currently working in. */
export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      currentWorkspaceId: null,
      setCurrentWorkspaceId: (currentWorkspaceId) => set({ currentWorkspaceId }),
    }),
    { name: 'pos-workspace', storage: createJSONStorage(() => localStorage) },
  ),
);
