// ── useRoomPresence — "is the other user in the room?" indicator ──
//
// Supabase Realtime presence is a separate primitive from
// postgres_changes. We open a channel keyed on room_id, track our
// own presence (just { user_id }), and listen for sync events to
// learn who else is currently joined.
//
// Returns the set of OTHER user_ids currently present.

"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function useRoomPresence(
  roomId: string,
  myUserId: string,
): Set<string> {
  const [otherUserIds, setOtherUserIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`synergy_room_presence:${roomId}`, {
      config: { presence: { key: myUserId } },
    });

    const recompute = () => {
      const state = channel.presenceState();
      const ids = new Set<string>();
      for (const key of Object.keys(state)) {
        if (key !== myUserId) ids.add(key);
      }
      setOtherUserIds(ids);
    };

    channel
      .on("presence", { event: "sync" }, recompute)
      .on("presence", { event: "join" }, recompute)
      .on("presence", { event: "leave" }, recompute)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ joined_at: new Date().toISOString() });
        }
      });

    return () => {
      void channel.untrack();
      supabase.removeChannel(channel);
    };
  }, [roomId, myUserId]);

  return otherUserIds;
}
