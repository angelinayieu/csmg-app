"use client";

// ── CanvasTopControls ─────────────────────────────────────────────
//
// The top-center control cluster. Currently the AI thinking-settings popover
// (depth · complexity · temperature · web search). Positioned here so the
// settings popover anchors below it; kept as a wrapper so future top-bar pills
// slot in beside it without re-touching whiteboard-base.
//
// NOTE: the ‹ › engine A/B toggle is intentionally NOT surfaced here — a prior
// pass found a bare toggle read as a mystery control. The verbs default to the
// "pipeline" engine; flip in code via setDirectionEngine if A/B is needed.

import { AiSettingsBar } from "./ai-settings-bar";

export function CanvasTopControls() {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 66,
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
      }}
    >
      <AiSettingsBar />
    </div>
  );
}
