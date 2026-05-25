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
import type { AnswerSlot } from "@/types/clarifier-answer";

/**
 * Phase C — typed-clarifier assertions sourced from
 * spaces.synthesis_data.user_assertions. Read by the seed-card
 * spawner on first mount and by shapes that want to surface
 * which slot a particular card came from.
 */
export interface SeedAssertion {
  slot: AnswerSlot;
  value: string;
  question: string;
  answeredAt: string;
}

export interface BrainstormContextValue {
  settings: BrainstormSettings;
  spaceId: string;
  /** Per-slot list of user-asserted commitments from the clarifier.
   *  Empty/missing when the user skipped MCQs or didn't toggle the
   *  ask-questions setting. */
  seedAssertions?: SeedAssertion[];
}

const BrainstormContext = createContext<BrainstormContextValue | null>(null);

// Provider takes primitives instead of a pre-built value object so it
// can memoize internally — saves every caller from having to remember
// to wrap the value in useMemo. Every sticky-note on the canvas reads
// this context, so an unstable value cascades to every sticky.
export function BrainstormContextProvider({
  settings,
  spaceId,
  seedAssertions,
  children,
}: {
  settings: BrainstormSettings;
  spaceId: string;
  seedAssertions?: SeedAssertion[];
  children: ReactNode;
}) {
  const value = useMemo<BrainstormContextValue>(
    () => ({ settings, spaceId, seedAssertions }),
    [settings, spaceId, seedAssertions],
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
