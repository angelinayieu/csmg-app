"use client";

// ── Canvas subject-scope context (F2 / D14) ──────────────────────────
//
// Mirrors canvas-reactions-context. Lets tldraw custom shapes
// (KGNodeShape) read the space-wide subject-scope index without
// threading it through shape props (which would need a tldraw schema
// migration). Shape components render inside the tldraw editor's
// React tree, so plain context composition works.
//
// Provider lives near the canvas root (mounted by interaxis-canvas
// alongside CanvasReactionsContext). Consumers call useCanvasSubjectScopes()
// and read `index.byEntity.get(entityId)` for ring rendering.

import { createContext, useContext } from "react";
import type { SubjectScopeIndex } from "./hooks/use-space-subject-scopes";

export interface CanvasSubjectScopesContextValue {
  spaceId: string | null;
  index: SubjectScopeIndex;
}

const EMPTY_INDEX: SubjectScopeIndex = {
  byEntity: new Map(),
  total_subjects: 0,
  total_scoped_entities: 0,
  loading: false,
};

export const CanvasSubjectScopesContext =
  createContext<CanvasSubjectScopesContextValue>({
    spaceId: null,
    index: EMPTY_INDEX,
  });

export function useCanvasSubjectScopes(): CanvasSubjectScopesContextValue {
  return useContext(CanvasSubjectScopesContext);
}
