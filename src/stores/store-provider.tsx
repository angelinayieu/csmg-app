"use client";

import { createContext, useContext, useRef, type ReactNode } from "react";
import { useStore } from "zustand";
import {
  createAppStore,
  type AppState,
  type AppStore,
} from "@/stores/app-store";

type AppStoreApi = ReturnType<typeof createAppStore>;

const AppStoreContext = createContext<AppStoreApi | undefined>(undefined);

export function AppStoreProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: Partial<AppState>;
}) {
  const storeRef = useRef<AppStoreApi>(undefined);
  if (!storeRef.current) {
    storeRef.current = createAppStore({
      user: initialState?.user ?? null,
      spaces: initialState?.spaces ?? [],
      sidebarOpen: initialState?.sidebarOpen ?? true,
    });
  }

  return (
    <AppStoreContext.Provider value={storeRef.current}>
      {children}
    </AppStoreContext.Provider>
  );
}

export function useAppStore<T>(selector: (store: AppStore) => T): T {
  const storeContext = useContext(AppStoreContext);
  if (!storeContext) {
    throw new Error("useAppStore must be used within AppStoreProvider");
  }
  return useStore(storeContext, selector);
}
