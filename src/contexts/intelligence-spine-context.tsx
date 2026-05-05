"use client";

// ── IntelligenceSpineContext ───────────────────────────────────────
//
// Surfaces the `useIntelligenceSpine` payload to every Intelligence
// drawer tab without forcing each one to re-fetch. Provider mounts
// inside the drawer body (so the spine isn't fetched while the drawer
// is closed); consumers tolerate `null` because some surfaces (the
// Convergence tab during early synthesis, etc.) may render before the
// first fetch lands.

import { createContext, useContext, type ReactNode } from "react";
import type { IntelligenceSpine } from "@/types/intelligence-spine";

export interface IntelligenceSpineContextValue {
  spine: IntelligenceSpine | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const IntelligenceSpineContext =
  createContext<IntelligenceSpineContextValue | null>(null);

export function IntelligenceSpineProvider({
  value,
  children,
}: {
  value: IntelligenceSpineContextValue;
  children: ReactNode;
}) {
  return (
    <IntelligenceSpineContext.Provider value={value}>
      {children}
    </IntelligenceSpineContext.Provider>
  );
}

/**
 * Read the active spine. Returns `null` when called outside the
 * provider — callers should treat that as "spine not available, fall
 * back to legacy data path." Doing it this way (rather than throwing)
 * keeps consumer surfaces usable from non-drawer routes (e.g. the
 * standalone /agents page) without needing a parallel provider.
 */
export function useIntelligenceSpineContext(): IntelligenceSpineContextValue | null {
  return useContext(IntelligenceSpineContext);
}
