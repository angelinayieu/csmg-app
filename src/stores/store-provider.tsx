"use client";

import { createContext, useContext, useRef, type ReactNode } from "react";
import { useStore } from "zustand";
import {
  createAppStore,
  defaultInitState,
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
    // Merge SSR-provided partial state onto the full defaults so fields
    // added later (e.g. colorScheme) stay populated even when callers pass
    // only a subset. Fixes TS "AppState missing colorScheme" error.
    storeRef.current = createAppStore({
      ...defaultInitState,
      ...(initialState ?? {}),
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
