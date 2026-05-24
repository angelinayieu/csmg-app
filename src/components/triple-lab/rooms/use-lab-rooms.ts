// ── useLabRooms ──
//
// Fetches the user-added rooms for a space, keyed by column slot, and
// exposes the four mutations triple-lab needs:
//   - createRoom(slot, kind, room_config)
//   - deleteRoom(roomId)
//   - patchRoom(roomId, patch)   — collapsed / room_config / position
//   - refresh()                   — re-pull from server
//
// State shape mirrors the lab_rooms table 1-1 and is segmented by
// column so the triple-lab render loop can pick `roomsByColumn[idx]`
// without re-filtering on every frame.

"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  LabRoomRow,
  LabRoomsListResponse,
} from "@/app/api/spaces/[id]/lab-rooms/route";

export type ColumnSlot = "left" | "middle" | "right";

export interface RoomsByColumn {
  left: LabRoomRow[];
  middle: LabRoomRow[];
  right: LabRoomRow[];
}

const EMPTY: RoomsByColumn = { left: [], middle: [], right: [] };

function group(rows: LabRoomRow[]): RoomsByColumn {
  const out: RoomsByColumn = { left: [], middle: [], right: [] };
  for (const r of rows) {
    if (r.column_slot === "left" || r.column_slot === "middle" || r.column_slot === "right") {
      out[r.column_slot].push(r);
    }
  }
  for (const slot of ["left", "middle", "right"] as const) {
    out[slot].sort((a, b) => a.position - b.position);
  }
  return out;
}

export interface UseLabRoomsResult {
  rooms: RoomsByColumn;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createRoom: (
    slot: ColumnSlot,
    kind: string,
     
    roomConfig?: Record<string, any>,
  ) => Promise<LabRoomRow | null>;
  deleteRoom: (roomId: string) => Promise<boolean>;
  patchRoom: (
    roomId: string,
    patch: {
      collapsed?: boolean;
      position?: number;
       
      room_config?: Record<string, any>;
    },
  ) => Promise<LabRoomRow | null>;
}

export function useLabRooms(spaceId: string | null): UseLabRoomsResult {
  const [rooms, setRooms] = useState<RoomsByColumn>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!spaceId) {
      setRooms(EMPTY);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/spaces/${spaceId}/lab-rooms`, {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as LabRoomsListResponse;
      setRooms(group(json.rooms ?? []));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createRoom = useCallback(
    async (
      slot: ColumnSlot,
      kind: string,
       
      roomConfig?: Record<string, any>,
    ) => {
      if (!spaceId) return null;
      const res = await fetch(`/api/spaces/${spaceId}/lab-rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          column_slot: slot,
          kind,
          room_config: roomConfig ?? {},
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(body?.error ?? `HTTP ${res.status}`);
        return null;
      }
      const { room } = (await res.json()) as { room: LabRoomRow };
      // Optimistic insert: append to the right column without a full refetch.
      setRooms((prev) => {
        const next: RoomsByColumn = {
          left: [...prev.left],
          middle: [...prev.middle],
          right: [...prev.right],
        };
        next[slot] = [...next[slot], room].sort(
          (a, b) => a.position - b.position,
        );
        return next;
      });
      return room;
    },
    [spaceId],
  );

  const deleteRoom = useCallback(
    async (roomId: string) => {
      if (!spaceId) return false;
      const res = await fetch(
        `/api/spaces/${spaceId}/lab-rooms/${roomId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(body?.error ?? `HTTP ${res.status}`);
        return false;
      }
      setRooms((prev) => ({
        left: prev.left.filter((r) => r.id !== roomId),
        middle: prev.middle.filter((r) => r.id !== roomId),
        right: prev.right.filter((r) => r.id !== roomId),
      }));
      return true;
    },
    [spaceId],
  );

  const patchRoom = useCallback(
    async (
      roomId: string,
      patch: {
        collapsed?: boolean;
        position?: number;
         
        room_config?: Record<string, any>;
      },
    ) => {
      if (!spaceId) return null;
      // Optimistic update first.
      setRooms((prev) => {
        const update = (rows: LabRoomRow[]) =>
          rows.map((r) => (r.id === roomId ? { ...r, ...patch } : r));
        return {
          left: update(prev.left),
          middle: update(prev.middle),
          right: update(prev.right),
        };
      });
      const res = await fetch(
        `/api/spaces/${spaceId}/lab-rooms/${roomId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(body?.error ?? `HTTP ${res.status}`);
        // On error, re-pull authoritative state.
        await refresh();
        return null;
      }
      const { room } = (await res.json()) as { room: LabRoomRow };
      return room;
    },
    [spaceId, refresh],
  );

  return { rooms, loading, error, refresh, createRoom, deleteRoom, patchRoom };
}
