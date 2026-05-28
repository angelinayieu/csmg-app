"use client";

// ── useMapState ───────────────────────────────────────────────────
//
// Phase 12.A (12.A.8-server). Loads + persists the per-user map view
// state (currently pinned node positions) via the causal_map_state
// route. Load is async (setState in a promise callback, NOT synchronous
// in the effect body) so it stays clear of the repo's
// `react-hooks/set-state-in-effect` rule. Saves are debounced so a drag
// gesture (a burst of position changes) collapses into one PUT.
//
// `latestRef` mirrors `pins` synchronously so the debounced save always
// flushes the freshest value without depending on a stale closure.

import { useCallback, useEffect, useRef, useState } from "react";

export type MapPins = Record<string, { x: number; y: number }>;

interface UseMapState {
  pins: MapPins;
  /** Set/replace one node's pinned position (called from drag changes). */
  setPin: (id: string, pos: { x: number; y: number }) => void;
  /** Clear all pins (revert to auto-layout). */
  resetPins: () => void;
  /** True once the initial load has settled (success or fail). */
  loaded: boolean;
}

export function useMapState(spaceId: string): UseMapState {
  const [pins, setPins] = useState<MapPins>({});
  const [loaded, setLoaded] = useState(false);
  const latestRef = useRef<MapPins>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const url = `/api/brainstorm/space/${spaceId}/causal-map/state`;

  // Load once per space. Async → the setState lives in a promise
  // continuation, not the synchronous effect body.
  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return;
        const loadedPins = json?.state?.pins;
        if (loadedPins && typeof loadedPins === "object") {
          latestRef.current = loadedPins as MapPins;
          setPins(loadedPins as MapPins);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: { pins: latestRef.current } }),
      }).catch(() => {
        // Soft-fail — positions still apply for the session.
      });
    }, 600);
  }, [url]);

  const setPin = useCallback(
    (id: string, pos: { x: number; y: number }) => {
      const next: MapPins = {
        ...latestRef.current,
        [id]: { x: Math.round(pos.x), y: Math.round(pos.y) },
      };
      latestRef.current = next;
      setPins(next);
      scheduleSave();
    },
    [scheduleSave],
  );

  const resetPins = useCallback(() => {
    latestRef.current = {};
    setPins({});
    scheduleSave();
  }, [scheduleSave]);

  // Flush-safe cleanup.
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  return { pins, setPin, resetPins, loaded };
}
