"use client";

// ── Canvas asset-derived-entities context (P1 / D14) ─────────────────
//
// Mirrors canvas-reactions-context + canvas-subject-scopes-context.
// Lets AssetCardShape (rendering inside tldraw editor's React tree)
// read the space-wide asset-derived-entity index without threading it
// through shape props.
//
// One fetch per space; provider lives at canvas root in
// interaxis-canvas. Every asset card consumes the same index so we
// avoid N fetches per N cards.

import { createContext, useContext } from "react";
import type { AssetDerivedEntitiesIndex } from "./hooks/use-asset-derived-entities";

export interface CanvasAssetDerivedEntitiesContextValue {
  spaceId: string | null;
  index: AssetDerivedEntitiesIndex;
}

const EMPTY_INDEX: AssetDerivedEntitiesIndex = {
  byAssetId: new Map(),
  statsByAssetId: new Map(),
  metadataByAssetId: new Map(),
  total: 0,
  loading: false,
};

export const CanvasAssetDerivedEntitiesContext =
  createContext<CanvasAssetDerivedEntitiesContextValue>({
    spaceId: null,
    index: EMPTY_INDEX,
  });

export function useCanvasAssetDerivedEntities(): CanvasAssetDerivedEntitiesContextValue {
  return useContext(CanvasAssetDerivedEntitiesContext);
}
