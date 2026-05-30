// Preview harness for BoardSelectionToolbar — verifies the new
// "Save to Library" canvas interaction renders alongside the primary verb.
// The toolbar is position:absolute (x/y from viewport); each demo wraps it
// in a relative box. Public route. SAFE TO DELETE.

"use client";

import { BoardSelectionToolbar } from "@/components/objective/board-selection-toolbar";

function Demo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(15,23,42,0.5)", marginBottom: 8 }}>
        {label}
      </div>
      <div
        style={{
          position: "relative",
          height: 90,
          borderRadius: 16,
          background: "linear-gradient(180deg,#f6f7fb,#eef0f6)",
          border: "1px solid rgba(15,23,42,0.06)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function SelectionToolbarPreview() {
  const noop = () => {};
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: 24, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
        BoardSelectionToolbar — Save-to-Library interaction
      </h1>
      <p style={{ fontSize: 12.5, color: "rgba(15,23,42,0.55)", marginBottom: 22 }}>
        Selecting cards on the whiteboard surfaces these. "Save to Library" turns the
        selection into persistent <code>library_objects</code> via the shared route.
      </p>

      <Demo label="1 card selected → Save only (no AI verb)">
        <div style={{ position: "absolute", left: "50%", top: 64 }}>
          <BoardSelectionToolbar x={0} y={0} count={1} busy={false} onSaveToLibrary={noop} />
        </div>
      </Demo>

      <Demo label="2 cards → Connect + Save">
        <div style={{ position: "absolute", left: "50%", top: 64 }}>
          <BoardSelectionToolbar x={0} y={0} count={2} busy={false} onRun={noop} onSaveToLibrary={noop} />
        </div>
      </Demo>

      <Demo label="3+ cards → Synthesize + Save">
        <div style={{ position: "absolute", left: "50%", top: 64 }}>
          <BoardSelectionToolbar x={0} y={0} count={4} busy={false} onRun={noop} onSaveToLibrary={noop} />
        </div>
      </Demo>

      <Demo label="After save → confirmation state">
        <div style={{ position: "absolute", left: "50%", top: 64 }}>
          <BoardSelectionToolbar x={0} y={0} count={2} busy={false} onRun={noop} onSaveToLibrary={noop} saved />
        </div>
      </Demo>
    </div>
  );
}
