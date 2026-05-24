"use client";

// ── ScratchNoteRoom ──
//
// Tiny free-text scratchpad. Text persists into room_config.text via
// PATCH. We debounce writes (700ms idle) so typing doesn't fire a
// request per keystroke. The lone "Delete room" action is exposed via
// the host's chrome (RoomShell renders the ✕ button).

import { useEffect, useState } from "react";
import type { RoomBodyProps } from "./room-registry";
import { colors } from "../tokens";

export function ScratchNoteRoom({
  spaceId,
  roomId,
  roomConfig,
}: RoomBodyProps) {
  const initial = typeof roomConfig?.text === "string" ? roomConfig.text : "";
  const [text, setText] = useState(initial);
  // `dirty` mirrors "text !== lastSaved" without crossing the
  // ref-during-render rule (react-hooks/refs). We only need it to
  // toggle the visible save-state hint, so plain state is fine.
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    const handle = setTimeout(() => {
      // Fire and forget — patch endpoint is idempotent
      void fetch(`/api/spaces/${spaceId}/lab-rooms/${roomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_config: { ...roomConfig, text } }),
      })
        .then(() => setDirty(false))
        .catch(() => null);
    }, 700);
    return () => clearTimeout(handle);
  }, [dirty, text, spaceId, roomId, roomConfig]);

  return (
    <div className="p-3">
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        placeholder="Jot a thought here…"
        rows={4}
        className="w-full resize-y rounded-md border bg-white/70 p-2 text-[12.5px] leading-snug outline-none focus:ring-2"
        style={{
          borderColor: colors.neutral.borderInput,
          color: colors.neutral.fg900,
          // @ts-expect-error CSS custom prop
          "--tw-ring-color": colors.brand.haloSoft,
        }}
      />
      <div
        className="mt-1 text-[10px]"
        style={{ color: colors.neutral.fg400 }}
      >
        {dirty ? "Saving…" : "Saved"}
      </div>
    </div>
  );
}
