"use client";

// ── SubsystemKgPanel ───────────────────────────────────────────────
//
// The "specialized knowledge graph" for ONE subsystem component: a room
// Map focused to a single mechanism's problem → mechanism → solution
// triad, with the mechanism openable into its internal runtime_flow DAG.
//
// It is a THIN composition layer — it does not re-implement any graph
// rendering. `scopeRoomToMechanism` pares the room's lanes+edges to the
// triad, and we hand that slice to the existing <RoomAltitudeMap> (the
// same ReactFlow causal-map renderer the room "Map" tab uses). The
// mechanism's internals reuse <MechanismDataflowView> verbatim.
//
// Collision-safe by construction: NEW file, consumes existing exports as
// black boxes, edits nothing the parallel room-view session owns.

import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Frame, Workflow } from "lucide-react";
import { appleVibe, withAlpha } from "@/lib/apple-vibe-tokens";
import { RoomAltitudeMap } from "@/components/objective/causal-map/altitudes/RoomAltitudeMap";
import { MechanismDataflowView } from "@/components/objective/mechanism-dataflow-view";
import { scopeRoomToMechanism } from "@/lib/objective-canvas/build-subsystem-kg";
import { sendSubsystemKgToBoard } from "@/components/objective/subsystem-kg-board-bus";
import type {
  RoomLane,
  RoomEdge,
} from "@/components/objective/sub-objective-room-view";
import type { MechanismSpec } from "@/lib/objective-canvas/enrich-mechanism-spec";

interface Props {
  spaceId: string;
  lanes: RoomLane[];
  edges: RoomEdge[];
  /** Lever (mechanism) entity id to focus the KG on. */
  mechanismId: string;
  /** Fallback display name when the mechanism isn't in the lanes. */
  mechanismName?: string;
  /** The lever's generated spec — drives the internal data-flow DAG.
   *  Omit / null → the triad still renders; internals show a hint. */
  spec?: MechanismSpec | null;
  /** Open the lever's full detail drawer (parity with the Map). The
   *  drawer also hosts the data-flow DAG, so this is the heavier
   *  "open everything" path; the inline toggle is the lighter one. */
  onOpenItem?: (entityId: string) => void;
  /** Source sub-objective room id — lets a board KG card's "Open in room"
   *  re-enter this room. Enables the "Send to whiteboard" action. */
  subId?: string;
  /** Accent hex for the mechanism (defaults to the mechanism-family color). */
  accent?: string;
  /** Map height in px. */
  height?: number;
}

export function SubsystemKgPanel({
  spaceId,
  lanes,
  edges,
  mechanismId,
  mechanismName,
  spec,
  onOpenItem,
  subId,
  accent,
  height = 440,
}: Props) {
  const scoped = useMemo(
    () => scopeRoomToMechanism({ lanes, edges, mechanismId }),
    [lanes, edges, mechanismId],
  );
  const [showInternals, setShowInternals] = useState(false);
  const [sent, setSent] = useState(false);

  const name = scoped.mechanismName ?? mechanismName ?? "This mechanism";
  const found = scoped.mechanismId != null;
  const accentColor = accent ?? appleVibe.stage.features;

  /** Drop this scoped KG onto the objective whiteboard as a triad card.
   *  Carries a lightweight snapshot (chip labels + counts) — never the full
   *  spec. Robust send: live event for a mounted board + a queued copy that
   *  a board mounting later drains. */
  function sendToBoard() {
    const problemLabels =
      scoped.lanes.find((l) => l.slug === "pain")?.items.map((i) => i.name) ??
      [];
    const solutionLabels = scoped.lanes
      .filter((l) => l.slug === "outcomes" || l.slug === "objective")
      .flatMap((l) => l.items.map((i) => i.name));
    const stepCount = Array.isArray(spec?.runtime_flow)
      ? spec!.runtime_flow.length
      : 0;
    sendSubsystemKgToBoard(spaceId, {
      mechanismId,
      mechanismName: name,
      roomId: subId ?? "",
      spaceId,
      color: accentColor,
      problemLabels,
      solutionLabels,
      problemCount: scoped.problemIds.length,
      solutionCount: scoped.solutionIds.length,
      hasSpec: !!spec,
      stepCount,
    });
    setSent(true);
    window.setTimeout(() => setSent(false), 2200);
  }

  return (
    <div style={{ fontFamily: appleVibe.font.stack }}>
      {/* ── Header ── */}
      <div className="mb-2 flex items-start justify-between gap-3 px-1">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span
              className="h-[8px] w-[8px] flex-shrink-0 rounded-full"
              style={{
                background: appleVibe.stage.features,
                boxShadow: `0 0 0 3px ${withAlpha(appleVibe.stage.features, "22")}`,
              }}
            />
            <span
              className="text-[13.5px] font-semibold leading-tight"
              style={{ color: appleVibe.text.primary }}
            >
              {name}
            </span>
          </div>
          <span
            className="text-[11px]"
            style={{ color: appleVibe.text.tertiary }}
          >
            problem → mechanism → solution
            {found
              ? ` · ${scoped.problemIds.length} problem${
                  scoped.problemIds.length === 1 ? "" : "s"
                } · ${scoped.solutionIds.length} outcome${
                  scoped.solutionIds.length === 1 ? "" : "s"
                }`
              : ""}
          </span>
        </div>

        <div className="flex flex-shrink-0 items-center gap-1.5">
          {found ? (
            <button
              type="button"
              onClick={sendToBoard}
              title="Drop this scoped KG onto the objective whiteboard"
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                color: sent ? "#fff" : accentColor,
                background: sent ? accentColor : `${accentColor}14`,
                boxShadow: appleVibe.shadow.chip,
              }}
            >
              {sent ? (
                <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
              ) : (
                <Frame className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              {sent ? "On whiteboard" : "Send to whiteboard"}
            </button>
          ) : null}

          {spec ? (
            <button
              type="button"
              onClick={() => setShowInternals((v) => !v)}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                color: appleVibe.text.secondary,
                background: appleVibe.surface.card,
                boxShadow: appleVibe.shadow.chip,
              }}
            >
              <Workflow className="h-3.5 w-3.5" strokeWidth={2} />
              {showInternals ? "Hide internals" : "Show internals"}
              {showInternals ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          ) : null}
        </div>
      </div>

      {/* ── The scoped KG (existing room Map renderer) ── */}
      {found ? (
        <RoomAltitudeMap
          spaceId={spaceId}
          lanes={scoped.lanes}
          edges={scoped.edges}
          height={height}
          onOpenItem={onOpenItem}
        />
      ) : (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-2xl px-6 text-center"
          style={{
            height,
            background: appleVibe.surface.base,
            border: `1px solid ${appleVibe.stroke.soft}`,
          }}
        >
          <Workflow
            className="h-6 w-6"
            style={{ color: appleVibe.text.faint }}
          />
          <p
            className="text-[12.5px]"
            style={{ color: appleVibe.text.secondary }}
          >
            This mechanism isn&apos;t wired into the room&apos;s causal spine
            yet — add a problem it counters or an outcome it drives to see its
            knowledge graph.
          </p>
        </div>
      )}

      {/* ── Internal data-flow (reuses MechanismDataflowView) ── */}
      {spec && showInternals ? (
        <div
          className="mt-3 rounded-2xl p-3"
          style={{
            background: appleVibe.surface.card,
            boxShadow: appleVibe.shadow.chip,
          }}
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <span
              className="text-[12px] font-semibold"
              style={{ color: appleVibe.text.primary }}
            >
              {name} — internal data flow
            </span>
            {onOpenItem ? (
              <button
                type="button"
                onClick={() => onOpenItem(mechanismId)}
                className="rounded-lg px-2 py-1 text-[10.5px]"
                style={{
                  color: appleVibe.text.secondary,
                  border: `1px solid ${appleVibe.stroke.hairline}`,
                }}
              >
                Open full detail
              </button>
            ) : null}
          </div>
          <MechanismDataflowView spec={spec} />
        </div>
      ) : null}

      {/* ── Footnote ── */}
      <div
        className="mt-2 px-1 text-[10.5px]"
        style={{ color: appleVibe.text.tertiary }}
      >
        {found
          ? "Click the mechanism to open its full detail. The graph is the same data as the room Map, scoped to this one subsystem."
          : null}
      </div>
    </div>
  );
}
