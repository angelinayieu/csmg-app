// Preview harness for FocusModePanel — the "Converge" interaction
// (Synergism Focus Mode, ported to the objective canvas). Mark what you
// decided across the board's nodes, then publish the kept set to the
// Strategy Brief. On the real canvas the host owns useFocusMode + dims
// out-of-scope shapes; here we drive it with mock nodes.
// Public route. SAFE TO DELETE.

"use client";

import { useState } from "react";
import { useFocusMode } from "@/components/synergy/focus-mode/use-focus-mode";
import { FocusModePanel } from "@/components/objective/canvas-interactions/focus-mode-panel";
import type { ClientNode } from "@/lib/synergy/types";

// A mix that exercises every auto-mark bucket:
//   core + a branch with an insight child   → "expanded" (kept)
//   a childless branch + the insight itself → "unclear"  (kept by default)
//   the plan node                           → "plans"    (kept)
//   three childless variations              → "exploratory" (set aside)
const MOCK_NODES: ClientNode[] = [
  { id: "room:onboarding", x: 0, y: 0, kind: "core", label: "Cut new-user onboarding drop-off by 30%" },
  { id: "card:filter", x: 0, y: 0, kind: "branch", label: "Contextual content filter", parent: null },
  { id: "card:checklist", x: 0, y: 0, kind: "branch", label: "Guided first-run checklist", parent: null },
  {
    id: "ins:compound",
    x: 0,
    y: 0,
    kind: "synergy",
    label: "Filter + checklist compound the onboarding lift",
    parent: "card:filter",
    parents: ["card:filter", "card:checklist"],
  },
  { id: "note:streaks", x: 0, y: 0, kind: "variation", label: "Gamified streaks" },
  { id: "note:tutor", x: 0, y: 0, kind: "variation", label: "AI tutor avatar" },
  { id: "note:referral", x: 0, y: 0, kind: "variation", label: "Referral incentive" },
  { id: "plan:mvp", x: 0, y: 0, kind: "plan", label: "Ship the filter MVP in 2 weeks" },
];

export default function FocusModePreview() {
  const focus = useFocusMode(MOCK_NODES);
  const [published, setPublished] = useState<string[] | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#fafafa",
        padding: 24,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <h1 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
          FocusModePanel — Converge
        </h1>
        <p
          style={{
            fontSize: 12.5,
            color: "rgba(15,23,42,0.55)",
            marginBottom: 16,
          }}
        >
          Mark what you decided, then publish the kept set. Hovering a row
          fires <code>onFocusNode</code> (canvas highlight). Currently
          focused: <strong>{focused ?? "—"}</strong> · Last published:{" "}
          <strong>{published ? `${published.length} nodes` : "—"}</strong>
        </p>

        {focus.phase === "closed" ? (
          <button
            type="button"
            onClick={() => {
              setPublished(null);
              focus.open();
            }}
            style={{
              padding: "10px 16px",
              borderRadius: 12,
              border: "1px solid rgba(15,23,42,0.10)",
              background: "#fff",
              cursor: "pointer",
              fontSize: 13.5,
              fontWeight: 600,
              color: "rgba(15,23,42,0.85)",
            }}
          >
            Open Converge →
          </button>
        ) : (
          <FocusModePanel
            nodes={MOCK_NODES}
            focus={focus}
            onFocusNode={setFocused}
            onPublish={(ids) => {
              setPublished(ids);
              // Real host navigates / opens the brief; here just settle.
              setTimeout(() => focus.endPublishing(), 1200);
            }}
          />
        )}

        {published && (
          <pre
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 12,
              background: "#fff",
              border: "1px solid rgba(15,23,42,0.08)",
              fontSize: 11.5,
              color: "rgba(15,23,42,0.7)",
              whiteSpace: "pre-wrap",
            }}
          >
            published kept ids:{"\n"}
            {JSON.stringify(published, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
