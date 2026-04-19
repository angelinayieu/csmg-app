"use client";

// Phase 30 — React context so tldraw custom shapes (KGNodeShape) can
// read the space-wide reaction index without threading it through
// shape props (which would require a tldraw schema migration). Shape
// components render inside the tldraw editor's React tree, so plain
// context composition works.

import { createContext, useContext } from "react";
import type { SpaceReactionsIndex } from "./hooks/use-space-reactions";

export interface CanvasReactionsContextValue {
  spaceId: string | null;
  index: SpaceReactionsIndex;
}

const EMPTY_INDEX: SpaceReactionsIndex = {
  byEntity: new Map(),
  total: 0,
  loading: false,
};

export const CanvasReactionsContext =
  createContext<CanvasReactionsContextValue>({
    spaceId: null,
    index: EMPTY_INDEX,
  });

export function useCanvasReactions(): CanvasReactionsContextValue {
  return useContext(CanvasReactionsContext);
}
