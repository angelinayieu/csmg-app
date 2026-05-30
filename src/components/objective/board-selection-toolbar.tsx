"use client";

// ── BoardSelectionToolbar ──
//
// The contextual action that floats just above a multi-card selection on
// the objective board. Deliberately surfaces ONE primary verb at a time
// (the "one verb at a time" principle): exactly two cards → Connect;
// three or more → Synthesize. Presentational only — the parent
// (BoardOverlay in whiteboard-base) owns the selection math + the LLM
// call and passes screen coordinates + handlers in.

import { Loader2, GitMerge, Check, BookmarkPlus } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { Sparkle } from "@/components/objective/icons/sparkle";

export function BoardSelectionToolbar({
  x,
  y,
  count,
  busy,
  onRun,
  onSaveToLibrary,
  saved,
}: {
  /** Screen-space top-center of the selection (px from viewport origin). */
  x: number;
  y: number;
  count: number;
  busy: boolean;
  /** Fires the AI action appropriate to the current count. Present only
   *  when ≥2 cards are selected (Connect/Synthesize need a pair+). */
  onRun?: () => void;
  /** Save the selected cards to the Library as objects. Present whenever
   *  ≥1 selected card is library-saveable. */
  onSaveToLibrary?: () => void;
  /** Brief confirmation state after a successful save. */
  saved?: boolean;
}) {
  const isConnect = count === 2;
  const label = isConnect ? "Connect" : "Synthesize";
  const Icon = isConnect ? GitMerge : Sparkle;
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
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      {/* Primary verb — the existing "one verb at a time" AI action. */}
      {onRun && (
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
              "0 16px 40px -12px rgba(71,85,105,0.45), 0 4px 12px -2px rgba(11,18,40,0.14)",
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
      )}

      {/* Secondary, quiet action — save the selection to the Library. */}
      {onSaveToLibrary && (
        <button
          type="button"
          onClick={onSaveToLibrary}
          disabled={busy}
          title="Save the selected card(s) to your Library"
          className="flex items-center gap-1.5 rounded-full transition-all duration-150 ease-out hover:scale-[1.03] active:scale-95"
          style={{
            background: saved ? "rgba(22,163,74,0.10)" : "rgba(255,255,255,0.94)",
            border: `1px solid ${saved ? "rgba(22,163,74,0.30)" : appleVibe.stroke.soft}`,
            color: saved ? "rgba(22,163,74,0.95)" : appleVibe.text.primary,
            padding: "8px 13px",
            fontSize: 12,
            fontWeight: 600,
            cursor: busy ? "wait" : "pointer",
            backdropFilter: "blur(8px)",
            boxShadow: "0 8px 24px -10px rgba(11,18,40,0.18)",
            fontFamily: appleVibe.font.stack,
          }}
        >
          {saved ? (
            <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
          ) : (
            <BookmarkPlus className="h-3.5 w-3.5" strokeWidth={2.4} />
          )}
          {saved ? "Saved" : "Save to Library"}
        </button>
      )}
    </div>
  );
}
