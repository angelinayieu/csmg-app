"use client";

// useRoomCounts — fetch the per-stage counts that drive the operational
// cascade's room subtitles. Single fetch on mount + on space change;
// callers can refetch() after a mutation.
//
// Used by canvas-operational-seed-spawner to replace the placeholder
// "Reading your prompt…" / "Opening lenses…" / "Decomposing…" subtitles
// with real counts the moment the canvas mounts. The same hook can
// drive a periodic refresh later (radar-style) without changing the
// API surface.

import { useCallback, useEffect, useState } from "react";
import type { RoomCounts } from "@/lib/whiteboard/room-layout";

export interface UseRoomCountsResult {
  counts: RoomCounts | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useRoomCounts(
  spaceId: string | null | undefined,
): UseRoomCountsResult {
  const [counts, setCounts] = useState<RoomCounts | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!spaceId) {
      setCounts(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/spaces/${encodeURIComponent(spaceId)}/room-counts`,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as { counts: RoomCounts };
      setCounts(payload.counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCounts(null);
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/spaces/${encodeURIComponent(spaceId)}/room-counts`,
        );
        if (cancelled) return;
        if (!res.ok) {
          setCounts(null);
          setError(`HTTP ${res.status}`);
          return;
        }
        const payload = (await res.json()) as { counts: RoomCounts };
        if (!cancelled) {
          setCounts(payload.counts);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setCounts(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  return { counts, loading, error, refetch };
}
