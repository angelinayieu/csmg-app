"use client";

// ── Operation Lane ────────────────────────────────────────────────────
//
// Per specforge_operation_card_system.md §8 + §21: a floating glass strip
// that shows the full SpecForge chain at-a-glance with per-engine status
// dots, click-to-focus navigation, and (when run) a 1-line output summary
// per engine. Reads from SpecForgeProgress.engineStatuses (already emitted
// by the runner) — no state of its own, no network calls.
//
// Design rules:
// - Cooperates with the existing chip — chip = "now/next" overlay (centered,
//   bottom), lane = "where am I in the chain" map (right edge, scrollable).
//   The two never compete for the same job.
// - Collapsible to a thin status strip so it doesn't crowd the board.
// - Click any row → centers the corresponding reasoning card in the editor.
// - Status colors picked to match the existing apple-vibe palette: green
//   for passed, amber for repaired, red for failed, blue for running, faint
//   gray for not_started.

import { forwardRef, useMemo, useState } from "react";
import type { Editor, TLShapeId } from "tldraw";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import {
  SPECFORGE_CHAIN,
  ENGINE_LABEL,
  PHASE_ORDER,
  PHASE_LABEL,
  PHASE_OF_ENGINE,
  type SpecForgeEngineId,
  type SpecForgePhase,
} from "@/lib/objective-canvas/specforge/types";
import type { EngineLaneStatus, SpecForgeProgress } from "./specforge-runner";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Fired when a lane row is clicked: opens the side panel rendered against
 *  the engine's polished bullets (no shape required). Listened to by
 *  SpecForgeDetailPanel. The per-engine cards no longer deploy as tldraw
 *  shapes — this event is now the primary way the user inspects an engine. */
export const OPEN_SPECFORGE_ENGINE_DETAIL_EVENT =
  "objective-board:open-specforge-engine-detail";

export interface OpenSpecForgeEngineDetail {
  engine: SpecForgeEngineId;
  result: unknown;
}

/** Lane row click → fire engine-detail event so the side panel can render
 *  the polished bullets for this engine. Soft-fails when the engine
 *  hasn't returned a result yet (running/not_started/failed). */
function openEngineDetail(engine: SpecForgeEngineId, status: EngineLaneStatus | undefined) {
  if (!status || status.result === undefined) return;
  try {
    window.dispatchEvent(
      new CustomEvent<OpenSpecForgeEngineDetail>(OPEN_SPECFORGE_ENGINE_DETAIL_EVENT, {
        detail: { engine, result: status.result },
      }),
    );
  } catch {
    /* defensive: never break the lane on a dispatch error */
  }
}

// ── Status color ──
// Single source of truth so the dot + the row tint always agree.
function statusColor(status: EngineLaneStatus["status"]): string {
  switch (status) {
    case "passed":
      return "#22C55E"; // green-500 — clean pass
    case "repaired":
      return "#F59E0B"; // amber-500 — passed after one repair
    case "failed":
      return "#EF4444"; // red-500 — soft-failed engine
    case "running":
      return "#3B82F6"; // blue-500 — in-flight (also gets pulse)
    case "not_started":
    default:
      return "#CBD5E1"; // slate-300 — quiet
  }
}

// ── Focus helper ──
// Lane row click → center the editor on the engine's reasoning card AND
// open the Side Panel for that card (the spec's "primary inspection
// surface" — see specforge_side_panel_interaction_system.md §6). Both
// actions fire in sequence so the user sees the card highlight + reads
// the panel without an extra click. Soft-fails on missing shape (engine
// may not have placed a card).
function focusShape(editor: Editor, shapeId: string | undefined) {
  if (!shapeId) return;
  try {
    const id = shapeId as TLShapeId;
    const bounds = editor.getShapePageBounds(id);
    if (!bounds) return;
    editor.centerOnPoint(
      { x: bounds.midX, y: bounds.midY },
      { animation: { duration: 320 } },
    );
    // Brief selection flash so the eye lands on the correct card.
    editor.select(id);
    // Open the Side Panel for this card. Fires AFTER the center+select so
    // the panel mount doesn't compete with the camera animation.
    window.setTimeout(() => {
      try {
        window.dispatchEvent(
          new CustomEvent("objective-board:open-specforge-detail", {
            detail: { shapeId },
          }),
        );
      } catch {
        /* defensive: never break lane click on a dispatch error */
      }
    }, 160);
    window.setTimeout(() => {
      try {
        editor.setSelectedShapes([]);
      } catch {
        /* unmount race — fine */
      }
    }, 1100);
  } catch (err) {
    console.warn("[operation-lane] focus failed:", err);
  }
}

interface OperationLaneProps {
  /** The live progress snapshot from `runSpecForge`. */
  progress: SpecForgeProgress;
  /** Used to centerOnPoint a card when a lane row is clicked. */
  editor: Editor;
}

export const OperationLane = forwardRef<HTMLDivElement, OperationLaneProps>(
  function OperationLane({ progress, editor }, containerRef) {
  const [collapsed, setCollapsed] = useState(false);

  // Group engines by act so the lane reads top-to-bottom as the spec's
  // narrative arc: Frame → Interweave → Decide → Build → Validate.
  const grouped = useMemo(
    () =>
      PHASE_ORDER.map((phase) => ({
        phase,
        engines: SPECFORGE_CHAIN.filter(
          (e) => PHASE_OF_ENGINE[e] === phase,
        ),
      })),
    [],
  );

  // Lane-wide aggregate stats for the header — "13/20 · 2 repaired".
  const stats = useMemo(() => {
    let done = 0;
    let repaired = 0;
    let failed = 0;
    for (const e of SPECFORGE_CHAIN) {
      const s = progress.engineStatuses[e]?.status;
      if (s === "passed" || s === "repaired" || s === "failed") done += 1;
      if (s === "repaired") repaired += 1;
      if (s === "failed") failed += 1;
    }
    return { done, repaired, failed, total: SPECFORGE_CHAIN.length };
  }, [progress.engineStatuses]);

  // Lane lives on the LEFT edge but offset past the ArtifactDock circles
  // (which sit at left:12 with 46px circles + tooltip preview). left:78
  // gives the dock breathing room and keeps the map-and-inspect surfaces
  // from overlapping each other. Map (lane) ↔ deep-inspect (panel) =
  // classic workflow split.
  const containerStyle: React.CSSProperties = {
    position: "absolute",
    top: 80,
    left: 78,
    bottom: 80,
    width: collapsed ? 42 : 268,
    maxHeight: "min(720px, calc(100vh - 160px))",
    display: "flex",
    flexDirection: "column",
    background: "var(--glass-float-bg)",
    backdropFilter: "blur(var(--blur-float)) saturate(1.7)",
    WebkitBackdropFilter: "blur(var(--blur-float)) saturate(1.7)",
    border: "1px solid rgba(15,23,42,0.06)",
    borderRadius: 18,
    boxShadow: "0 18px 38px rgba(15,23,42,0.10)",
    zIndex: 75,
    overflow: "hidden",
    transition: "width 220ms ease-out",
    fontFamily: appleVibe.font.stack,
    color: appleVibe.text.primary,
  };

  if (collapsed) {
    return (
      <div ref={containerRef} style={containerStyle}>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Expand operation lane"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            color: appleVibe.text.tertiary,
            padding: "10px 0",
            cursor: "pointer",
          }}
        >
          <ChevronRight style={{ width: 14, height: 14 }} strokeWidth={2.2} />
        </button>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            padding: "6px 0",
            overflowY: "auto",
          }}
        >
          {SPECFORGE_CHAIN.map((e) => {
            const laneStatus = progress.engineStatuses[e];
            const status = laneStatus?.status ?? "not_started";
            const ready = laneStatus?.result !== undefined;
            return (
              <button
                type="button"
                key={e}
                onClick={() => openEngineDetail(e, laneStatus)}
                disabled={!ready}
                title={ENGINE_LABEL[e]}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  background: statusColor(status),
                  border: "none",
                  cursor: ready ? "pointer" : "default",
                  opacity: ready ? 1 : 0.7,
                  animation:
                    status === "running" ? "pulse 1.4s ease-in-out infinite" : undefined,
                  padding: 0,
                }}
              />
            );
          })}
        </div>
        <style jsx>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.55; transform: scale(0.85); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={containerStyle}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px 10px",
          borderBottom: "1px solid rgba(15,23,42,0.05)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: appleVibe.text.tertiary,
            }}
          >
            Operations
          </span>
          <span
            style={{
              fontSize: 11.5,
              color: appleVibe.text.tertiary,
              letterSpacing: 0.1,
            }}
          >
            {stats.done}/{stats.total}
            {stats.repaired > 0 ? ` · ${stats.repaired} repaired` : ""}
            {stats.failed > 0 ? ` · ${stats.failed} failed` : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse operation lane"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            color: appleVibe.text.tertiary,
            cursor: "pointer",
            padding: 4,
          }}
        >
          <ChevronLeft style={{ width: 14, height: 14 }} strokeWidth={2.2} />
        </button>
      </div>

      {/* Engine rows, grouped by act */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "6px 0 10px",
        }}
      >
        {grouped.map((act) => (
          <PhaseBlock
            key={act.phase}
            phase={act.phase}
            engines={act.engines}
            progress={progress}
            editor={editor}
          />
        ))}
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
  },
);

// ── Phase block — one of the 5 acts ──
function PhaseBlock({
  phase,
  engines,
  progress,
  editor,
}: {
  phase: SpecForgePhase;
  engines: SpecForgeEngineId[];
  progress: SpecForgeProgress;
  editor: Editor;
}) {
  return (
    <div style={{ padding: "4px 14px 10px" }}>
      <div
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: appleVibe.text.faint,
          padding: "6px 0 4px",
        }}
      >
        {PHASE_LABEL[phase]}
      </div>
      {engines.map((engine) => (
        <EngineRow
          key={engine}
          engine={engine}
          status={progress.engineStatuses[engine]}
          editor={editor}
        />
      ))}
    </div>
  );
}

// ── Single engine row ──
function EngineRow({
  engine,
  status,
  editor,
}: {
  engine: SpecForgeEngineId;
  status: EngineLaneStatus | undefined;
  editor: Editor;
}) {
  const s = status?.status ?? "not_started";
  // Per-engine reasoning cards no longer materialize on the board — the
  // row is clickable as soon as the engine has produced a result, and
  // the click opens the side panel (engine-detail mode) instead of
  // centering on a shape.
  const clickable = status?.result !== undefined;
  const dotColor = statusColor(s);
  return (
    <button
      type="button"
      onClick={() => openEngineDetail(engine, status)}
      disabled={!clickable}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 9,
        width: "100%",
        background: "transparent",
        border: "none",
        textAlign: "left",
        padding: "5px 4px",
        borderRadius: 7,
        cursor: clickable ? "pointer" : "default",
        color: appleVibe.text.primary,
        opacity: s === "not_started" ? 0.6 : 1,
        fontFamily: appleVibe.font.stack,
        transition: "background 120ms ease-out",
      }}
      onMouseEnter={(e) => {
        if (clickable) e.currentTarget.style.background = "rgba(15,23,42,0.045)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: dotColor,
          flexShrink: 0,
          marginTop: 4,
          animation: s === "running" ? "pulse 1.4s ease-in-out infinite" : undefined,
        }}
      />
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 1,
          minWidth: 0,
          flex: 1,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 540,
            letterSpacing: 0.1,
            lineHeight: 1.3,
            color: appleVibe.text.primary,
          }}
        >
          {ENGINE_LABEL[engine]}
        </span>
        {status?.outputSummary && (
          <span
            style={{
              fontSize: 10.5,
              color: appleVibe.text.tertiary,
              lineHeight: 1.35,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {status.outputSummary}
          </span>
        )}
        {status &&
          (status.issueCount ?? 0) > 0 &&
          s !== "passed" && (
            <span
              style={{
                fontSize: 10,
                color:
                  s === "failed" ? "#B91C1C" : s === "repaired" ? "#B45309" : appleVibe.text.tertiary,
                marginTop: 2,
              }}
            >
              {status.issueCount} issue{(status.issueCount ?? 0) === 1 ? "" : "s"}
            </span>
          )}
      </span>
    </button>
  );
}
