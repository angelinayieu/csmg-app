// ── useRoomRealtime — Supabase postgres_changes subscription ──
//
// Subscribes the calling client to live INSERT / UPDATE / DELETE
// events on synergy_room_nodes filtered to a single room_id. Each
// event invokes the matching callback so the consumer can fold it
// into local state.
//
// RLS gates which rows the channel receives — both members of the
// room get events; non-members get nothing.

"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RoomNode } from "@/lib/synergy/room-client";

export function useRoomRealtime(
  roomId: string,
  callbacks: {
    onInsert: (node: RoomNode) => void;
    onUpdate: (node: RoomNode) => void;
    onDelete: (nodeId: string) => void;
  },
) {
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`synergy_room:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "synergy_room_nodes",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          callbacks.onInsert(payload.new as RoomNode);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "synergy_room_nodes",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          callbacks.onUpdate(payload.new as RoomNode);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "synergy_room_nodes",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const old = payload.old as { id?: string };
          if (old?.id) callbacks.onDelete(old.id);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);
}
