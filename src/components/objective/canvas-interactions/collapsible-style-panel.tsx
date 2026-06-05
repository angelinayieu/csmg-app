"use client";

// ── CollapsibleStylePanel ──
//
// tldraw's style panel (color / opacity / dash / size), but collapsed by
// default and CONTROLLED by the shared board-panel signal. The trigger lives
// in the unified BoardTopRightBar (so the palette reads as part of that one
// glass row); this component only renders the actual DefaultStylePanel — and
// only while the "style" panel is open — anchored just BELOW the bar at the
// top-right. It stays mounted in the tldraw `components.StylePanel` slot
// because DefaultStylePanel needs the editor context.

import { DefaultStylePanel, type TLUiStylePanelProps } from "tldraw";
import { usePanel } from "@/lib/objective-canvas/board-panel-signal";

export function CollapsibleStylePanel(props: TLUiStylePanelProps) {
  const open = usePanel("style");
  if (!open) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        pointerEvents: "all",
        // Sit just below the unified top-right bar (top:16, ~38px tall),
        // hugging the right edge so it reads as that bar's dropdown.
        marginTop: 62,
        marginRight: 16,
      }}
    >
      <DefaultStylePanel {...props} />
    </div>
  );
}
