"use client";

// ── BoardSelectionToolbar ──
//
// The contextual action that floats just above a multi-card selection on
// the objective board. Deliberately surfaces ONE primary verb at a time
// (the "one verb at a time" principle): exactly two cards → Connect;
// three or more → Synthesize. Presentational only — the parent
// (BoardOverlay in whiteboard-base) owns the selection math + the LLM
// call and passes screen coordinates + handlers in.

import { Sparkles, Loader2, GitMerge } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export function BoardSelectionToolbar({
  x,
  y,
  count,
  busy,
  onRun,
}: {
  /** Screen-space top-center of the selection (px from viewport origin). */
  x: number;
  y: number;
  count: number;
  busy: boolean;
  /** Fires the AI action appropriate to the current count. */
  onRun: () => void;
}) {
  const isConnect = count === 2;
  const label = isConnect ? "Connect" : "Synthesize";
  const Icon = isConnect ? GitMerge : Sparkles;
  const hint = isConnect ? "name the relationship" : `weave ${count} together`;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: Math.max(8, y - 56),
        transform: "translateX(-50%)",
        zIndex: 70,
        pointerEvents: "auto",
      }}
    >
      <button
        type="button"
        onClick={onRun}
        disabled={busy}
        title={`${label} — ${hint}`}
        className="flex items-center gap-2 rounded-full transition-all duration-150 ease-out hover:scale-[1.03] active:scale-95"
        style={{
          background: appleVibe.accent.primary,
          border: `1px solid ${appleVibe.accent.primary}`,
          color: appleVibe.text.onAccent,
          padding: "9px 15px",
          fontSize: 12.5,
          fontWeight: 650,
          letterSpacing: "0.01em",
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.85 : 1,
          boxShadow:
            "0 16px 40px -12px rgba(124,58,237,0.45), 0 4px 12px -2px rgba(11,18,40,0.14)",
          fontFamily: appleVibe.font.stack,
        }}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.4} />
        ) : (
          <Icon className="h-4 w-4" strokeWidth={2.4} />
        )}
        {busy ? "Thinking…" : label}
        <span
          style={{
            marginLeft: 2,
            display: "inline-grid",
            placeItems: "center",
            minWidth: 18,
            height: 18,
            padding: "0 5px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.22)",
            fontSize: 10.5,
            fontWeight: 700,
          }}
        >
          {count}
        </span>
      </button>
    </div>
  );
}
