// ── useRoomEvents — Realtime subscription to synergy_room_events ──
//
// On mount: fetches the most recent batch via GET /events and primes
// state.
// While mounted: subscribes to INSERTs filtered to this room_id and
// appends each new event in chronological order.
//
// RLS enforces membership both in the initial GET and in the Realtime
// publication, so non-members see nothing.

"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface RoomEvent {
  id: string;
  room_id: string;
  actor_id: string;
  kind:
    | "node_added"
    | "node_edited"
    | "node_moved"
    | "node_deleted"
    | "node_linked"
    | "note";
  target_node_id: string | null;
  summary: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

interface State {
  events: RoomEvent[];
  loading: boolean;
}

export function useRoomEvents(roomId: string): State {
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Initial fetch — chronological (oldest first).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/synergy/rooms/${roomId}/events?limit=80`)
      .then((r) => r.json())
      .then((body: { events?: RoomEvent[] }) => {
        if (cancelled) return;
        setEvents(body.events ?? []);
      })
      .catch(() => {
        // Soft-fail — rail just renders empty
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // Live subscription — append new INSERTs.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`synergy_room_events:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "synergy_room_events",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const row = payload.new as RoomEvent;
          if (!row) return;
          setEvents((prev) => {
            // De-dup by id in case the initial GET overlapped a fresh
            // INSERT during the subscribe handshake.
            if (prev.some((e) => e.id === row.id)) return prev;
            return [...prev, row];
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  return { events, loading };
}
