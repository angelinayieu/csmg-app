// Preview harness for CardHoverActions — the per-card hover action bar
// (Decompose · Variations · Questions · Make plan · Save). On the real
// canvas it reveals below a card on hover and fires board-bus CardActions.
// Public route. SAFE TO DELETE.

"use client";

import { useState } from "react";
import { CardHoverActions } from "@/components/objective/canvas-interactions/card-hover-actions";
import type { CardAction } from "@/components/objective/board-bus";

export default function CardHoverActionsPreview() {
  const [last, setLast] = useState<CardAction | null>(null);
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: 24, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
        CardHoverActions — per-card hover action bar
      </h1>
      <p style={{ fontSize: 12.5, color: "rgba(15,23,42,0.55)", marginBottom: 22 }}>
        Hover a card on the whiteboard → this pops up just below it. Last action:{" "}
        <strong>{last ?? "—"}</strong>
      </p>

      {/* Mock card with the bar below it, like the real reveal. */}
      <div style={{ position: "relative", width: 230, margin: "8px auto 0" }}>
        <div
          style={{
            width: 230,
            height: 120,
            borderRadius: 18,
            background: "linear-gradient(160deg,#fff,#f8f9fc)",
            border: "1px solid rgba(15,23,42,0.07)",
            boxShadow: "0 14px 36px -16px rgba(124,58,237,0.33), 0 6px 18px -10px rgba(11,18,40,0.16)",
            padding: 14,
          }}
        >
          <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.14em", color: "#7C3AED" }}>
            FEATURE
          </div>
          <div style={{ marginTop: 10, fontSize: 14.5, fontWeight: 600, color: "#0B1228" }}>
            Contextual Content Filter
          </div>
        </div>
        <div style={{ position: "absolute", top: "calc(100% + 5px)", left: "50%", transform: "translateX(-50%)" }}>
          <CardHoverActions accent="#7C3AED" onAction={setLast} />
        </div>
      </div>
    </div>
  );
}
