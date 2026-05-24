"use client";

// ── ScratchNoteRoom ──
//
// Free-text scratchpad that doubles as a candidate factory (Phase 8).
//
// Two surfaces:
//   - Textarea autosaves to room_config.text on 700ms idle.
//   - "Materialize → Whiteboard" button calls the materialize endpoint,
//     which runs the text through a noun-phrase extractor and stages
//     entity candidates into pipeline_candidates. On success the host
//     opens the CandidateReviewDrawer focused on the new batch.
//
// The button is the bridge between rooms (draft space) and the
// whiteboard (committed reality) — until this shipped, scratch notes
// were a dead-end UI.

import { useCallback, useEffect, useState } from "react";
import type { RoomBodyProps } from "./room-registry";
import { colors, tracking } from "../tokens";

export function ScratchNoteRoom({
  spaceId,
  roomId,
  roomConfig,
  onMaterialized,
}: RoomBodyProps) {
  const initial = typeof roomConfig?.text === "string" ? roomConfig.text : "";
  const [text, setText] = useState(initial);
  // `dirty` mirrors "text !== lastSaved" without crossing the
  // ref-during-render rule (react-hooks/refs). We only need it to
  // toggle the visible save-state hint, so plain state is fine.
  const [dirty, setDirty] = useState(false);

  // ── Autosave ─────────────────────────────────────────────────────
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

  // ── Materialize state ────────────────────────────────────────────
  // status drives the button label + disabled state:
  //   idle       → "✦ Materialize → Whiteboard"
  //   working    → "Extracting…" (button locked)
  //   error      → tiny inline error message (button re-enabled)
  //   success    → instant transition, no persistent indicator (host
  //                opens the drawer immediately so the user is already
  //                reviewing the candidates).
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const trimmedHasContent = text.trim().length > 0;
  const canMaterialize = trimmedHasContent && status !== "working" && !dirty;

  const materialize = useCallback(async () => {
    if (!canMaterialize) return;
    setStatus("working");
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/spaces/${spaceId}/lab-rooms/${roomId}/materialize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        batchId?: string;
        staged?: number;
      };
      setStatus("idle");
      if (body.batchId && onMaterialized) {
        onMaterialized(body.batchId);
      }
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [canMaterialize, spaceId, roomId, onMaterialized]);

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
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <div
          className="text-[10px]"
          style={{ color: colors.neutral.fg400 }}
        >
          {dirty ? "Saving…" : "Saved"}
        </div>
        {/* Materialize action — only shown when the textarea has
         *  content. Disabled while autosave is in flight to avoid a
         *  race where the materialize call uses stale text. */}
        <button
          type="button"
          onClick={() => void materialize()}
          disabled={!canMaterialize}
          title={
            !trimmedHasContent
              ? "Type something to materialize"
              : dirty
              ? "Waiting for save…"
              : status === "working"
              ? "Extracting candidates…"
              : "Extract entity candidates from this note"
          }
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold transition-all"
          style={{
            background: canMaterialize
              ? colors.brand.gradient
              : colors.neutral.chipBg,
            color: canMaterialize ? "white" : colors.neutral.fg400,
            boxShadow: canMaterialize
              ? `0 3px 8px ${colors.brand.shadow}`
              : "none",
            opacity: status === "working" ? 0.7 : 1,
            letterSpacing: tracking.eyebrowTight,
          }}
        >
          <span className="font-mono text-[11px] leading-none">✦</span>
          {status === "working" ? "Extracting…" : "Materialize"}
        </button>
      </div>
      {/* Error toast — tiny inline strip, only on failure */}
      {status === "error" && errorMsg && (
        <div
          className="mt-1.5 rounded-md px-2 py-1 text-[10px] font-semibold"
          style={{
            background: colors.state.bottleneckSoft,
            color: colors.state.bottleneckFgChip,
          }}
        >
          ⚠ {errorMsg}
        </div>
      )}
    </div>
  );
}
