import { createStore } from "zustand/vanilla";
import type { Profile, Space } from "@/types";
import { type ThemeId, DEFAULT_THEME, THEME_STORAGE_KEY } from "@/lib/themes";

export interface AppState {
  user: Profile | null;
  spaces: Space[];
  sidebarOpen: boolean;
  colorScheme: ThemeId;
}

export interface AppActions {
  setUser: (user: Profile | null) => void;
  setSpaces: (spaces: Space[]) => void;
  addSpace: (space: Space) => void;
  toggleSidebar: () => void;
  setColorScheme: (scheme: ThemeId) => void;
}

export type AppStore = AppState & AppActions;

export const defaultInitState: AppState = {
  user: null,
  spaces: [],
  sidebarOpen: true,
  colorScheme: DEFAULT_THEME,
};

export function createAppStore(initState: AppState = defaultInitState) {
  return createStore<AppStore>()((set) => ({
    ...initState,
    setUser: (user) => set({ user }),
    setSpaces: (spaces) => set({ spaces }),
    addSpace: (space) =>
      set((state) => ({ spaces: [space, ...state.spaces] })),
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    setColorScheme: (scheme) => {
      if (typeof window !== "undefined") {
        localStorage.setItem(THEME_STORAGE_KEY, scheme);
      }
      set({ colorScheme: scheme });
    },
  }));
}
