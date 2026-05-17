// ── useRoomMessages — chat thread fetch + Realtime subscription ──
//
// Same architecture as useRoomEvents: initial GET seeds the list,
// postgres_changes INSERT subscription appends new arrivals. Dedups
// by id so an INSERT that races the initial GET doesn't double-render.
//
// Exposes a `sendText` callback that POSTs to /messages and lets
// Realtime echo back; we don't optimistically insert because the
// channel is fast enough that the round-trip feel is fine and the
// dedup logic is simpler.

"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RoomMessage, RoomMessageKind } from "@/lib/synergy/room-messages";

interface State {
  messages: RoomMessage[];
  loading: boolean;
  /** Fires a POST. Returns true on success, false on failure. */
  sendMessage: (
    body: string,
    opts?: { kind?: RoomMessageKind; meta?: Record<string, unknown> },
  ) => Promise<boolean>;
}

export function useRoomMessages(roomId: string): State {
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [loading, setLoading] = useState(true);

  // Initial fetch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/synergy/rooms/${roomId}/messages?limit=60`)
      .then((r) => r.json())
      .then((body: { messages?: RoomMessage[] }) => {
        if (cancelled) return;
        setMessages(body.messages ?? []);
      })
      .catch(() => {
        // Soft-fail — render empty
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // Realtime live INSERT subscription.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`synergy_room_messages:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "synergy_room_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const row = payload.new as RoomMessage;
          if (!row) return;
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            return [...prev, row];
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId]);

  const sendMessage = useCallback(
    async (
      body: string,
      opts?: { kind?: RoomMessageKind; meta?: Record<string, unknown> },
    ) => {
      const trimmed = body.trim();
      if (!trimmed) return false;
      try {
        const res = await fetch(`/api/synergy/rooms/${roomId}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            body: trimmed,
            kind: opts?.kind ?? "text",
            meta: opts?.meta,
          }),
        });
        if (!res.ok) return false;
        return true;
      } catch {
        return false;
      }
    },
    [roomId],
  );

  return { messages, loading, sendMessage };
}
