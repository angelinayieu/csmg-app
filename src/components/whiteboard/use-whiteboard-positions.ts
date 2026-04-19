"use client";

// ── useWhiteboardPositions ──
//
// Load + mutate + persist per-node canvas positions. Manual overrides take
// precedence over the deterministic layout engine in whiteboard-canvas. If a
// node has no override, the layout engine picks its position.
//
// Persistence: debounced POST to /api/whiteboard/positions so quick drags don't
// hammer the API. Initial GET happens once on mount.

import { useEffect, useRef, useState, useCallback } from "react";

export interface NodePosition {
  entity_id: string;
  x: number;
  y: number;
  moved_at?: string;
}

const SAVE_DEBOUNCE_MS = 500;

export function useWhiteboardPositions(spaceId: string) {
  // Map<entity_id, { x, y }> — mutations update this locally first.
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [loaded, setLoaded] = useState(false);

  // Pending changes awaiting save
  const pendingRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initial load ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/whiteboard/positions?space_id=${encodeURIComponent(spaceId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        const map = new Map<string, { x: number; y: number }>();
        for (const p of (json.positions ?? []) as NodePosition[]) {
          map.set(p.entity_id, { x: p.x, y: p.y });
        }
        setPositions(map);
        setLoaded(true);
      } catch (err) {
        console.warn("[useWhiteboardPositions] Load failed (non-critical):", err);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  // ── Debounced flush ──
  const flush = useCallback(async () => {
    if (pendingRef.current.size === 0) return;
    const batch = Array.from(pendingRef.current.entries()).map(([entity_id, pos]) => ({
      entity_id,
      x: pos.x,
      y: pos.y,
    }));
    pendingRef.current.clear();
    try {
      await fetch("/api/whiteboard/positions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ space_id: spaceId, positions: batch }),
      });
    } catch (err) {
      console.warn("[useWhiteboardPositions] Save failed:", err);
      // If save failed, re-queue the batch so the next drag-save retries them.
      for (const b of batch) {
        if (!pendingRef.current.has(b.entity_id)) {
          pendingRef.current.set(b.entity_id, { x: b.x, y: b.y });
        }
      }
    }
  }, [spaceId]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      flush();
    }, SAVE_DEBOUNCE_MS);
  }, [flush]);

  // Flush on unmount so we don't lose an in-flight change
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // Fire-and-forget — can't await in cleanup
      flush();
    };
  }, [flush]);

  // ── Public mutators ──

  /** Update a single entity's position. Persists via debounced save. */
  const setPosition = useCallback(
    (entity_id: string, x: number, y: number) => {
      setPositions((prev) => {
        const next = new Map(prev);
        next.set(entity_id, { x, y });
        return next;
      });
      pendingRef.current.set(entity_id, { x, y });
      scheduleSave();
    },
    [scheduleSave],
  );

  /** Update many positions at once (e.g. shift-on-overlap). Persists debounced. */
  const setManyPositions = useCallback(
    (updates: Array<{ entity_id: string; x: number; y: number }>) => {
      setPositions((prev) => {
        const next = new Map(prev);
        for (const u of updates) next.set(u.entity_id, { x: u.x, y: u.y });
        return next;
      });
      for (const u of updates) pendingRef.current.set(u.entity_id, { x: u.x, y: u.y });
      scheduleSave();
    },
    [scheduleSave],
  );

  /** Remove all overrides, reverting to auto-layout. */
  const resetAll = useCallback(async () => {
    setPositions(new Map());
    pendingRef.current.clear();
    try {
      await fetch(`/api/whiteboard/positions?space_id=${encodeURIComponent(spaceId)}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.warn("[useWhiteboardPositions] Reset failed:", err);
    }
  }, [spaceId]);

  return {
    positions,
    loaded,
    setPosition,
    setManyPositions,
    resetAll,
  };
}
