"use client";

// ── CollapsibleStylePanel ──
//
// A collapsed-by-default replacement for tldraw's always-expanded style panel
// (color / opacity / dash / size). Renders a small glass palette icon; clicking
// it reveals the DefaultStylePanel. Declutters the top-right and stops the full
// palette colliding with the Notebook pill. Passed to <Tldraw components>.

import { useState } from "react";
import { DefaultStylePanel, type TLUiStylePanelProps } from "tldraw";
import { Palette } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";

export function CollapsibleStylePanel(props: TLUiStylePanelProps) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 6,
        pointerEvents: "all",
        // Hug the top-right corner. The objective layout overrides
        // `--oc-style-panel-top` to ~60px in FULL mode so the palette stacks
        // cleanly below the Notebook pill; in minimal mode (and anywhere the
        // var is unset) it falls back to a clean corner inset instead of the
        // old dead 52px gap that made the palette look like it was floating.
        // Sits below the top-right nav pill (~top:16–56) so the palette never
        // overlaps it; the full-mode layout already overrides this to ~60px.
        marginTop: "var(--oc-style-panel-top, 60px)",
        // Slides left of the Powerups panel when it's open (the rail sets
        // `--oc-style-panel-right`) so the palette never covers the panel's
        // close button. Back to the corner (12px) when the panel is closed.
        marginRight: "var(--oc-style-panel-right, 12px)",
        transition: "margin-right 0.28s cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      <button
        type="button"
        title={open ? "Hide style controls" : "Style controls"}
        aria-label="Toggle style controls"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          borderRadius: appleVibe.radius.sm,
          background: open ? appleVibe.accent.primary : "var(--glass-float-bg)",
          color: open ? appleVibe.text.onAccent : appleVibe.text.secondary,
          border: "1px solid var(--glass-border)",
          boxShadow:
            "inset 0 1px 0 var(--glass-highlight), 0 8px 24px -12px rgba(11,18,40,0.26)",
          backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
          WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
          cursor: "pointer",
        }}
      >
        <Palette style={{ width: 16, height: 16 }} strokeWidth={2} />
      </button>
      {open && <DefaultStylePanel {...props} />}
    </div>
  );
}
