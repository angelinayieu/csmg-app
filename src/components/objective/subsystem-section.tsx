"use client";

// ── SubsystemSection ──────────────────────────────────────────────
//
// The room "Subsystems" tab, with a two-mode lens toggle:
//
//   • Modules        — the system view: every lever as a subsystem module,
//                      wired left→right by produces→consumes tokens
//                      (existing <SubsystemModulesView>, reused verbatim).
//   • Knowledge graph — the focused view: ONE mechanism's specialized KG
//                      (its problem → mechanism → solution triad, openable
//                      into the internal data-flow), via <SubsystemKgPanel>.
//                      Each KG can be sent to the whiteboard from there.
//
// Why a wrapper (not edits to the two existing views): it keeps the KG
// entry-point logic in ONE owned file and reduces the room-view host's
// integration to a SINGLE element swap —
//
//     <SubsystemModulesView model={buildSubsystemModules({lanes,edges,roomCategories})} onOpenItem={…} />
//   → <SubsystemSection spaceId={…} subId={…} lanes={lanes} edges={edges} roomCategories={roomCategories} onOpenItem={…} />
//
// — because only the host has lanes/edges/spaceId/subId in scope (the
// modules view receives just the built model). Collision-safe: a NEW file
// that builds the model itself (same call the host made inline) and
// consumes the two views + the KG panel as black boxes.

import { useMemo, useState } from "react";
import { Boxes, Workflow } from "lucide-react";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import { SubsystemModulesView } from "./subsystem-modules-view";
import { SubsystemKgPanel } from "./subsystem-kg-panel";
import { buildSubsystemModules } from "@/lib/objective-canvas/build-subsystem-modules";
import type { RoomCategories } from "@/lib/objective-canvas/generate-categories";
import type { RoomLane, RoomEdge } from "./sub-objective-room-view";

type Mode = "modules" | "kg";

interface Props {
  spaceId: string;
  /** Sub-objective room id — lets a board KG card's "Open in room" return. */
  subId: string;
  lanes: RoomLane[];
  edges: RoomEdge[];
  roomCategories: RoomCategories;
  /** Open a lever's full detail drawer (parity with the Map / Modules). */
  onOpenItem?: (id: string) => void;
}

export function SubsystemSection({
  spaceId,
  subId,
  lanes,
  edges,
  roomCategories,
  onOpenItem,
}: Props) {
  // Same call the room-view host made inline — the model is the single
  // source for both modes (modules layout + the KG mechanism picker).
  const model = useMemo(
    () => buildSubsystemModules({ lanes, edges, roomCategories }),
    [lanes, edges, roomCategories],
  );

  const colorFor = useMemo(() => {
    const m = new Map(model.groups.map((g) => [g.id, g.color]));
    return (subsystem: string) => m.get(subsystem) ?? appleVibe.stage.features;
  }, [model.groups]);

  const [mode, setMode] = useState<Mode>("modules");
  // Default the KG focus to the first lever that has a generated spec
  // (richest graph), else the first lever.
  const [focusId, setFocusId] = useState<string | null>(null);
  const activeId =
    focusId ??
    model.modules.find((m) => m.hasSpec)?.id ??
    model.modules[0]?.id ??
    null;

  const activeModule = model.modules.find((m) => m.id === activeId) ?? null;

  return (
    <div style={{ fontFamily: appleVibe.font.stack }}>
      {/* ── Lens toggle: Modules ⇄ Knowledge graph ── */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div
          className="inline-flex items-center gap-0.5 rounded-xl p-0.5"
          style={{ background: appleVibe.surface.card, boxShadow: appleVibe.shadow.chip }}
        >
          {(
            [
              { id: "modules", label: "Modules", icon: Boxes },
              { id: "kg", label: "Knowledge graph", icon: Workflow },
            ] as const
          ).map(({ id, label, icon: Icon }) => {
            const on = mode === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className="flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[12px] font-medium transition-colors"
                style={{
                  color: on ? appleVibe.text.primary : appleVibe.text.tertiary,
                  background: on ? appleVibe.surface.base : "transparent",
                  boxShadow: on ? appleVibe.shadow.chip : "none",
                }}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                {label}
              </button>
            );
          })}
        </div>

        <span className="text-[11px]" style={{ color: appleVibe.text.tertiary }}>
          {mode === "modules"
            ? "How the levers interlock (produces → consumes)"
            : "One mechanism's specialized graph"}
        </span>
      </div>

      {mode === "modules" ? (
        <SubsystemModulesView model={model} onOpenItem={onOpenItem} />
      ) : model.modules.length === 0 ? (
        <div
          className="flex items-center justify-center rounded-2xl px-6 py-16 text-center text-[12.5px]"
          style={{
            background: appleVibe.surface.base,
            border: `1px solid ${appleVibe.stroke.soft}`,
            color: appleVibe.text.tertiary,
          }}
        >
          No mechanisms in this room yet — add levers to see their knowledge
          graphs.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Mechanism picker — choose which subsystem component's KG to view. */}
          <div className="flex flex-wrap gap-1.5">
            {model.modules.map((m) => {
              const on = m.id === activeId;
              const accent = colorFor(m.subsystem);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setFocusId(m.id)}
                  title={m.hasSpec ? `${m.stepCount} internal steps` : "No spec yet"}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium transition-all"
                  style={{
                    color: on ? "#fff" : appleVibe.text.secondary,
                    background: on ? accent : `${accent}12`,
                    border: `1px solid ${on ? accent : `${accent}30`}`,
                  }}
                >
                  <span
                    className="h-[6px] w-[6px] flex-shrink-0 rounded-full"
                    style={{
                      background: on ? "#fff" : accent,
                      opacity: m.hasSpec ? 1 : 0.4,
                    }}
                  />
                  {m.name}
                </button>
              );
            })}
          </div>

          {activeModule ? (
            <SubsystemKgPanel
              key={activeModule.id}
              spaceId={spaceId}
              subId={subId}
              lanes={lanes}
              edges={edges}
              mechanismId={activeModule.id}
              mechanismName={activeModule.name}
              spec={model.specsById[activeModule.id] ?? null}
              accent={colorFor(activeModule.subsystem)}
              onOpenItem={onOpenItem}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
