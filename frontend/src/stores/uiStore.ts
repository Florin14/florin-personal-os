import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemePreference = 'dark' | 'light' | 'system';

interface UiState {
  themePreference: ThemePreference;
  mobileNavOpen: boolean;
  setThemePreference: (preference: ThemePreference) => void;
  setMobileNavOpen: (open: boolean) => void;
}

/** Shared UI preferences. Only the theme preference is persisted. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      themePreference: 'dark',
      mobileNavOpen: false,
      setThemePreference: (themePreference) => set({ themePreference }),
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
    }),
    {
      name: 'pos-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ themePreference: state.themePreference }),
    },
  ),
);
