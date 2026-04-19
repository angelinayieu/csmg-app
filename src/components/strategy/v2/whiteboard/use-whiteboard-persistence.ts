"use client";

import { useEffect, useState, useCallback } from "react";
import type {
  PostItNote,
  WhiteboardEdge,
  PinnedPosition,
} from "@/types/whiteboard";

// TODO: v2 — migrate to Supabase `whiteboard_annotations` table.
// For now, whiteboard state is scoped per browser via localStorage.

const keys = (spaceId: string) => ({
  postits: `whiteboard:${spaceId}:postits`,
  userEdges: `whiteboard:${spaceId}:userEdges`,
  pins: `whiteboard:${spaceId}:pins`,
});

function readJSON<T>(k: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(k: string, v: unknown) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // quota or serialization error — ignore silently
  }
}

export function useWhiteboardPersistence(spaceId: string) {
  const K = keys(spaceId);

  const [postits, setPostits] = useState<PostItNote[]>([]);
  const [userEdges, setUserEdges] = useState<WhiteboardEdge[]>([]);
  const [pins, setPins] = useState<Record<string, PinnedPosition>>({});
  const [hydrated, setHydrated] = useState(false);

  // Hydrate on mount
  useEffect(() => {
    setPostits(readJSON<PostItNote[]>(K.postits, []));
    setUserEdges(readJSON<WhiteboardEdge[]>(K.userEdges, []));
    setPins(readJSON<Record<string, PinnedPosition>>(K.pins, {}));
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  // Persist on change (skip pre-hydration runs)
  useEffect(() => {
    if (!hydrated) return;
    writeJSON(K.postits, postits);
  }, [postits, K.postits, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    writeJSON(K.userEdges, userEdges);
  }, [userEdges, K.userEdges, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    writeJSON(K.pins, pins);
  }, [pins, K.pins, hydrated]);

  // Post-it CRUD
  const addPostIt = useCallback((note: PostItNote) => {
    setPostits((prev) => [...prev, note]);
  }, []);
  const updatePostIt = useCallback((id: string, patch: Partial<PostItNote>) => {
    setPostits((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);
  const removePostIt = useCallback((id: string) => {
    setPostits((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // User-drawn edges
  const addUserEdge = useCallback((edge: WhiteboardEdge) => {
    setUserEdges((prev) => [...prev, edge]);
  }, []);
  const removeUserEdge = useCallback((id: string) => {
    setUserEdges((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // Pins
  const setPin = useCallback((nodeId: string, pos: PinnedPosition | null) => {
    setPins((prev) => {
      if (pos === null) {
        const next = { ...prev };
        delete next[nodeId];
        return next;
      }
      return { ...prev, [nodeId]: pos };
    });
  }, []);
  const clearAllPins = useCallback(() => setPins({}), []);

  return {
    hydrated,
    postits,
    userEdges,
    pins,
    addPostIt,
    updatePostIt,
    removePostIt,
    addUserEdge,
    removeUserEdge,
    setPin,
    clearAllPins,
  };
}
