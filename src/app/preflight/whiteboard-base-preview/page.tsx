"use client";

// Preflight verification for the objective whiteboard base.
//
// Public (unauthenticated) route so it's verifiable without the
// /app/* auth gate. Mounts the real WhiteboardBase, then exercises the
// collapse-to-card round-trip: "Deploy" drops a room-card on the board;
// the card's own "Expand" button fires OPEN_ROOM_EVENT, which we catch
// here and surface in the status readout — proving the full loop the
// ObjectiveCanvasShell will rely on.

import { useEffect, useState } from "react";
import {
  WhiteboardBase,
  deployRoomCard,
} from "@/components/objective/whiteboard-base";
import { OPEN_ROOM_EVENT } from "@/components/objective/shapes/room-card-shape";

export default function WhiteboardBasePreviewPage() {
  const [lastExpanded, setLastExpanded] = useState<string | null>(null);
  const [expandCount, setExpandCount] = useState(0);
  // Mirrors how the shell flips chrome off while a room window is open.
  const [showUi, setShowUi] = useState(true);

  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<{ roomId: string }>).detail;
      setLastExpanded(detail?.roomId ?? "(unknown)");
      setExpandCount((c) => c + 1);
    }
    window.addEventListener(OPEN_ROOM_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ROOM_EVENT, onOpen);
  }, []);

  return (
    <div className="fixed inset-0">
      <WhiteboardBase
        spaceId="preflight-chips-v2"
        showUi={showUi}
        onEditorReady={(e) => {
          // Dev escape hatch so the preview harness can drive selection.
          (window as unknown as { __boardEditor?: unknown }).__boardEditor = e;
        }}
        onAiLink={async (mode, cards) => {
          // Mock the LLM so the full Connect/Synthesize → proposal →
          // Keep/Dismiss loop is verifiable without auth or a real call.
          await new Promise((r) => setTimeout(r, 600));
          if (mode === "connect") {
            return {
              headline: "reinforces",
              body: `${cards[0]?.title ?? "A"} strengthens ${
                cards[1]?.title ?? "B"
              } — resolving one compounds the other.`,
            };
          }
          return {
            headline: "shared energy bottleneck",
            body: `${cards.length} rooms converge on the same limiting factor; fixing it lifts all of them at once.`,
          };
        }}
      />

      {/* Control panel — floats over the board. */}
      <div
        className="fixed left-4 top-4 z-[100] flex w-72 flex-col gap-2 rounded-2xl p-4"
        style={{
          background: "rgba(255,255,255,0.94)",
          border: "1px solid rgba(15,23,42,0.08)",
          boxShadow: "0 18px 48px -16px rgba(11,18,40,0.28)",
          fontFamily:
            '-apple-system, "SF Pro Text", system-ui, sans-serif',
        }}
      >
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
          Whiteboard base · preflight
        </div>
        <p className="text-[12px] leading-snug text-slate-500">
          The board below is a real tldraw surface (drag, sticky-note via
          the toolbar, draw). Deploy a room as a card, then press its
          Expand button — the round-trip fires below.
        </p>

        <button
          type="button"
          onClick={() =>
            deployRoomCard({
              roomId: "__obj",
              title: "Cognitive Performance",
              subtitle: "The full objective, collapsed onto the board.",
              color: "#7C3AED",
              chips: ["3 rooms", "2 ready", "4 layers"],
            })
          }
          className="mt-1 rounded-full px-3 py-2 text-[12px] font-semibold text-white"
          style={{ background: "#7C3AED" }}
        >
          Deploy Objective card
        </button>

        <button
          type="button"
          onClick={() =>
            deployRoomCard({
              roomId: "sub-pain",
              title: "Reduce afternoon energy crashes",
              subtitle: "Pain room",
              color: "#EC4899",
              chips: ["4 mechanisms", "3 chains", "Ready"],
            })
          }
          className="rounded-full px-3 py-2 text-[12px] font-semibold text-white"
          style={{ background: "#EC4899" }}
        >
          Deploy Room card
        </button>

        <button
          type="button"
          onClick={() => setShowUi((v) => !v)}
          className="rounded-full px-3 py-2 text-[12px] font-semibold"
          style={{
            background: showUi ? "rgba(15,23,42,0.06)" : "#0B1228",
            color: showUi ? "#334155" : "white",
          }}
        >
          {showUi ? "Hide board chrome (showUi=false)" : "Show board chrome (showUi=true)"}
        </button>

        <div
          className="mt-1 rounded-xl px-3 py-2 text-[12px]"
          style={{ background: "rgba(15,23,42,0.04)" }}
        >
          {lastExpanded ? (
            <span className="text-slate-700">
              Expanded <strong>{lastExpanded}</strong> · {expandCount} time
              {expandCount === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="text-slate-400">
              No Expand fired yet — deploy a card, then press Expand on it.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
