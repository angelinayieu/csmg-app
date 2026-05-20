// ── useRoomPresence ──
//
// One Supabase Realtime channel per room, multiplexing two things:
//
//   1. Presence track  → who is in this room right now (set of user_ids).
//      Uses the channel's `presence` primitive (`channel.track`).
//
//   2. Cursor broadcasts → live world-coord position of each remote
//      user's pointer. Uses `channel.send({ type: 'broadcast', … })`
//      which is transient and unpersisted — perfect for cursor data.
//
// Cursor positions are in WORLD coordinates (pre pan/zoom). The renderer
// maps them back to viewport pixels using the local pan/zoom state, so
// each user can pan independently and still see remote cursors anchored
// to the right canvas content.
//
// Throttled at ~30Hz on send. A cursor is dropped from the map if no
// update arrives for CURSOR_IDLE_MS, which mirrors what a human reads
// as "they stepped away."
//
// Return shape is destructured by callers — older single-user callers
// can just read `.onlineUserIds`.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface RemoteCursor {
  userId: string;
  /** World x in canvas coords (pre pan/zoom). */
  x: number;
  /** World y in canvas coords (pre pan/zoom). */
  y: number;
  /** ms timestamp of the most recent broadcast we received. */
  updatedAt: number;
}

export interface RoomPresenceState {
  /** Set of user_ids currently joined (excluding myUserId). */
  onlineUserIds: Set<string>;
  /** Latest world-coord cursor per remote user_id. */
  cursors: Map<string, RemoteCursor>;
  /** Throttled cursor broadcast — call on every mousemove. World coords. */
  broadcastCursor: (worldX: number, worldY: number) => void;
}

// 30Hz feels smooth without flooding Realtime. Anything faster wastes
// bandwidth; anything slower starts to feel laggy at 1.5x zoom.
const CURSOR_THROTTLE_MS = 33;
// If a remote user hasn't moved their cursor in this long, drop it from
// the visible set — same instinct as Figma's "user went idle" fade.
const CURSOR_IDLE_MS = 4_000;

export function useRoomPresence(
  roomId: string,
  myUserId: string,
): RoomPresenceState {
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [cursors, setCursors] = useState<Map<string, RemoteCursor>>(new Map());

  // Ref to the channel so broadcastCursor (a stable callback) can reach
  // it without forcing re-renders when the channel subscribes/unsubs.
  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);
  const lastSendRef = useRef(0);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`synergy_room_presence:${roomId}`, {
      config: {
        presence: { key: myUserId },
        // Don't echo our own broadcasts back; we already know where our
        // cursor is.
        broadcast: { self: false },
      },
    });
    channelRef.current = channel;

    const recomputePresence = () => {
      const state = channel.presenceState();
      const ids = new Set<string>();
      for (const key of Object.keys(state)) {
        if (key !== myUserId) ids.add(key);
      }
      setOnlineUserIds(ids);
    };

    channel
      .on("presence", { event: "sync" }, recomputePresence)
      .on("presence", { event: "join" }, recomputePresence)
      .on("presence", { event: "leave" }, (payload) => {
        recomputePresence();
        // Drop their cursor immediately on leave — don't wait for the
        // 4s idle prune. (`payload.key` is the presence key, which we
        // configured = user_id above.)
        const leftKey =
          (payload as unknown as { key?: string }).key ?? null;
        if (leftKey) {
          setCursors((prev) => {
            if (!prev.has(leftKey)) return prev;
            const next = new Map(prev);
            next.delete(leftKey);
            return next;
          });
        }
      })
      .on(
        "broadcast",
        { event: "cursor" },
        (msg) => {
          const payload = (msg as unknown as {
            payload?: { userId?: string; x?: number; y?: number };
          }).payload;
          if (
            !payload ||
            typeof payload.userId !== "string" ||
            typeof payload.x !== "number" ||
            typeof payload.y !== "number"
          ) {
            return;
          }
          if (payload.userId === myUserId) return;
          setCursors((prev) => {
            const next = new Map(prev);
            next.set(payload.userId!, {
              userId: payload.userId!,
              x: payload.x!,
              y: payload.y!,
              updatedAt: Date.now(),
            });
            return next;
          });
        },
      )
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ joined_at: new Date().toISOString() });
        }
      });

    // Idle prune — sweep cursors that haven't ticked in CURSOR_IDLE_MS.
    const pruneInterval = window.setInterval(() => {
      setCursors((prev) => {
        const now = Date.now();
        let mutated = false;
        const next = new Map(prev);
        for (const [k, c] of prev) {
          if (now - c.updatedAt > CURSOR_IDLE_MS) {
            next.delete(k);
            mutated = true;
          }
        }
        return mutated ? next : prev;
      });
    }, 1_000);

    return () => {
      window.clearInterval(pruneInterval);
      void channel.untrack();
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomId, myUserId]);

  const broadcastCursor = useCallback(
    (worldX: number, worldY: number) => {
      const channel = channelRef.current;
      if (!channel) return;
      const now = Date.now();
      if (now - lastSendRef.current < CURSOR_THROTTLE_MS) return;
      lastSendRef.current = now;
      void channel.send({
        type: "broadcast",
        event: "cursor",
        payload: { userId: myUserId, x: worldX, y: worldY },
      });
    },
    [myUserId],
  );

  return { onlineUserIds, cursors, broadcastCursor };
}
