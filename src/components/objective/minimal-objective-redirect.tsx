"use client";

// ── MinimalObjectiveRedirect ──
//
// In minimal mode the objective lives as a card on the board. Its "Press to
// open ↗" fires OPEN_ROOM_EVENT → the shell opens a window with the page's
// output. Instead of a dead-end placeholder ("append ?full=1 to the URL"),
// opening should just take the user to the full analysis canvas. This mounts
// ONLY when that window opens (the shell hides children while collapsed), and
// navigates to ?full=1. A full reload is used so the objective layout re-reads
// the param + switches out of minimal mode.

import { useEffect } from "react";

export function MinimalObjectiveRedirect() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("full") === "1") return; // already full — nothing to do
    sp.set("full", "1");
    window.location.assign(`${window.location.pathname}?${sp.toString()}`);
  }, []);

  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "50vh",
        fontFamily:
          '-apple-system, "SF Pro Text", Inter, system-ui, sans-serif',
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, color: "#64748B" }}
      >
        <span
          className="animate-spin"
          style={{
            width: 16,
            height: 16,
            borderRadius: 999,
            border: "2px solid rgba(15,23,42,0.12)",
            borderTopColor: "#64748B",
            display: "inline-block",
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 500 }}>Opening canvas…</span>
      </div>
    </div>
  );
}
