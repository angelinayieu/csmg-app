import { createStore } from "zustand/vanilla";
import type { Profile, Space } from "@/types";

export interface AppState {
  user: Profile | null;
  spaces: Space[];
  sidebarOpen: boolean;
}

export interface AppActions {
  setUser: (user: Profile | null) => void;
  setSpaces: (spaces: Space[]) => void;
  addSpace: (space: Space) => void;
  toggleSidebar: () => void;
}

export type AppStore = AppState & AppActions;

export const defaultInitState: AppState = {
  user: null,
  spaces: [],
  sidebarOpen: true,
};

export function createAppStore(initState: AppState = defaultInitState) {
  return createStore<AppStore>()((set) => ({
    ...initState,
    setUser: (user) => set({ user }),
    setSpaces: (spaces) => set({ spaces }),
    addSpace: (space) =>
      set((state) => ({ spaces: [space, ...state.spaces] })),
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  }));
}
