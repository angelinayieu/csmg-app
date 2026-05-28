"use client";

// ── useLocalPref ──────────────────────────────────────────────────
//
// Phase 12.A (12.A.8, client slice). SSR-safe per-key preference backed
// by localStorage. Mirrors the notebook-rail pattern in
// app/objective/[spaceId]/layout.tsx: render the `initial` value on the
// server + first client paint (so hydration matches), then flip to the
// stored value in an effect. Writes persist on every set. Soft-fails
// when storage is unavailable (private mode, quota) — the value still
// works for the session.
//
// This is the migration-free half of A.8: it remembers view toggles
// (Cards/Map, room view, health overlay) per space/room. The server-
// backed `causal_map_state` table (cross-device, pinned node positions)
// lands when the pending Phase 12.A migration is applied.

import { useCallback, useEffect, useState } from "react";

export function useLocalPref<T>(
  key: string,
  initial: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);

  // Read the stored value after mount (and whenever the key changes —
  // e.g. navigating between rooms). Pre-hydration we keep `initial` so
  // server + client first paint agree.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) setValue(JSON.parse(raw) as T);
      else setValue(initial);
    } catch {
      // Storage unavailable / malformed — keep current value.
    }
    // `initial` intentionally omitted: callers pass a literal each render,
    // so including it would re-read on every render. Key is the identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Soft-fail — session-only state still works.
      }
    },
    [key],
  );

  return [value, set];
}
