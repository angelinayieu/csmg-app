"use client";

// ── BrainstormContext (Phase 2D) ──
//
// Minimal React Context that exposes the current brainstorm
// settings + the active space id to shape utils. Needed because
// tldraw renders shape `component()` methods inside its own React
// tree — they can't read props passed to the canvas root directly.
//
// Shapes that want to adapt to brainstorm state (e.g. sticky notes
// showing a Deep Search button when `deepSearch` is on) read via
// `useBrainstormContext()`. Returns null when outside a provider
// so shapes still render safely in contexts without brainstorm
// (exports, screenshots, etc.).

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { BrainstormSettings } from "@/lib/brainstorm/brainstorm-settings";

export interface BrainstormContextValue {
  settings: BrainstormSettings;
  spaceId: string;
}

const BrainstormContext = createContext<BrainstormContextValue | null>(null);

// Provider takes primitives instead of a pre-built value object so it
// can memoize internally — saves every caller from having to remember
// to wrap the value in useMemo. Every sticky-note on the canvas reads
// this context, so an unstable value cascades to every sticky.
export function BrainstormContextProvider({
  settings,
  spaceId,
  children,
}: {
  settings: BrainstormSettings;
  spaceId: string;
  children: ReactNode;
}) {
  const value = useMemo<BrainstormContextValue>(
    () => ({ settings, spaceId }),
    [settings, spaceId],
  );
  return (
    <BrainstormContext.Provider value={value}>
      {children}
    </BrainstormContext.Provider>
  );
}

/**
 * Read brainstorm context. Returns null when the consumer renders
 * outside a BrainstormContextProvider — consumers should handle the
 * null case by simply not showing brainstorm-specific UI.
 */
export function useBrainstormContext(): BrainstormContextValue | null {
  return useContext(BrainstormContext);
}
