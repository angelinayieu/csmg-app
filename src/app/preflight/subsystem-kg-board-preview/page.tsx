"use client";

// Preflight verification for the subsystem-KG-on-the-whiteboard feature
// (Phase 2). Public route so it's verifiable without the /app/* auth gate.
//
// Mounts the real WhiteboardBase, then exercises the deploy round-trip:
// each button fires DEPLOY_SUBSYSTEM_KG_EVENT (via deploySubsystemKgCard);
// the board's onSubsystemKg listener drops a `subsystem-kg` triad card.
// The card's "Open in room" button fires OPEN_ROOM_EVENT carrying
// { roomId, focusEntityId } — we catch it here and surface both in the
// status readout, proving the focus-hint seam RoomAltitudeMap will honor.

import { useEffect, useState } from "react";
import { WhiteboardBase } from "@/components/objective/whiteboard-base";
import { deploySubsystemKgCard } from "@/components/objective/subsystem-kg-board-bus";
import { OPEN_ROOM_EVENT } from "@/components/objective/shapes/room-card-shape";

export default function SubsystemKgBoardPreviewPage() {
  const [lastOpen, setLastOpen] = useState<{
    roomId: string;
    focusEntityId?: string;
  } | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [showUi, setShowUi] = useState(true);

  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (
        e as CustomEvent<{ roomId: string; focusEntityId?: string }>
      ).detail;
      setLastOpen(detail ?? null);
      setOpenCount((c) => c + 1);
    }
    window.addEventListener(OPEN_ROOM_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ROOM_EVENT, onOpen);
  }, []);

  return (
    <div className="fixed inset-0">
      <WhiteboardBase spaceId="preflight-subsystem-kg" showUi={showUi} />

      {/* Control panel — floats over the board. */}
      <div
        className="fixed left-4 top-4 z-[100] flex w-72 flex-col gap-2 rounded-2xl p-4"
        style={{
          background: "rgba(255,255,255,0.94)",
          border: "1px solid rgba(15,23,42,0.08)",
          boxShadow: "0 18px 48px -16px rgba(11,18,40,0.28)",
          fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
        }}
      >
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
          Subsystem KG → board · preflight
        </div>
        <p className="text-[12px] leading-snug text-slate-500">
          Each button drops a mechanism&apos;s scoped problem → mechanism →
          solution triad onto the board. Press a card&apos;s &quot;Open in
          room&quot; — the round-trip (with the mechanism focus hint) fires
          below. Re-deploying the same mechanism re-focuses, never stacks.
        </p>

        <button
          type="button"
          onClick={() =>
            deploySubsystemKgCard({
              mechanismId: "mech-spaced-repetition",
              mechanismName: "Spaced-repetition scheduler",
              roomId: "sub-retention",
              spaceId: "preflight-subsystem-kg",
              color: "#2563EB",
              problemLabels: [
                "Learners forget within 48h",
                "Cramming before reviews",
              ],
              solutionLabels: [
                "Durable recall at 30 days",
                "Even study load",
              ],
              problemCount: 2,
              solutionCount: 2,
              hasSpec: true,
              stepCount: 5,
            })
          }
          className="mt-1 rounded-full px-3 py-2 text-[12px] font-semibold text-white"
          style={{ background: "#2563EB" }}
        >
          Deploy KG · scheduler (5 steps)
        </button>

        <button
          type="button"
          onClick={() =>
            deploySubsystemKgCard({
              mechanismId: "mech-adaptive-difficulty",
              mechanismName: "Adaptive difficulty tuner",
              roomId: "sub-engagement",
              spaceId: "preflight-subsystem-kg",
              color: "#7C3AED",
              problemLabels: [
                "Too-hard items cause churn",
                "Too-easy items bore",
                "No per-user calibration",
              ],
              solutionLabels: ["Flow-state retention", "Lower drop-off"],
              problemCount: 3,
              solutionCount: 2,
              hasSpec: true,
              stepCount: 7,
            })
          }
          className="rounded-full px-3 py-2 text-[12px] font-semibold text-white"
          style={{ background: "#7C3AED" }}
        >
          Deploy KG · difficulty (7 steps)
        </button>

        <button
          type="button"
          onClick={() =>
            deploySubsystemKgCard({
              mechanismId: "mech-streak-nudge",
              mechanismName: "Streak nudge",
              roomId: "sub-engagement",
              spaceId: "preflight-subsystem-kg",
              color: "#0E7490",
              problemLabels: ["Users lapse after day 3"],
              solutionLabels: [],
              problemCount: 1,
              solutionCount: 0,
              hasSpec: false,
              stepCount: 0,
            })
          }
          className="rounded-full px-3 py-2 text-[12px] font-semibold text-white"
          style={{ background: "#0E7490" }}
        >
          Deploy KG · nudge (no internals)
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
          {showUi ? "Hide board chrome" : "Show board chrome"}
        </button>

        <div
          className="mt-1 rounded-xl px-3 py-2 text-[12px]"
          style={{ background: "rgba(15,23,42,0.04)" }}
        >
          {lastOpen ? (
            <span className="text-slate-700">
              Open fired → room <strong>{lastOpen.roomId}</strong>
              {lastOpen.focusEntityId ? (
                <>
                  {" "}
                  · focus <strong>{lastOpen.focusEntityId}</strong>
                </>
              ) : null}{" "}
              · {openCount}×
            </span>
          ) : (
            <span className="text-slate-400">
              No Open fired yet — deploy a KG, then press &quot;Open in
              room&quot; on the card.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
