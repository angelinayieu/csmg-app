"use client";

import { useCallback, useState } from "react";
import { ChevronRight, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CascadeObjective, CascadeRowVM } from "../strategy-view-model";
import { palette } from "../strategy-palette";
import { MechanismChain } from "./mechanism-chain";
import {
  STRATEGY_OBJECTIVE_DRAG_MIME,
  type StrategyObjectiveDragPayload,
} from "@/components/canvas/strategy-objective-drag";
import { useStrategyCanvasPresence } from "@/components/canvas/strategy-canvas-presence-context";
import type { CausalChain } from "@/types/causal-chains";
import type { Entity } from "@/types";

interface CascadeObjectiveProps {
  objective: CascadeObjective;
  row: CascadeRowVM;
  causalChains: CausalChain[];
  entityMap: Map<string, Entity>;
  spaceId: string;
  onLayoutChange?: () => void;
}

export function CascadeObjectiveCard({
  objective,
  row,
  causalChains,
  entityMap,
  spaceId,
  onLayoutChange,
}: CascadeObjectiveProps) {
  const p = palette(row.paletteKey);
  const [expanded, setExpanded] = useState(false);
  const presence = useStrategyCanvasPresence();
  const isOnCanvas = presence.objectiveIds.has(objective.id);

  const matchedChain = objective.matchedChainId
    ? causalChains.find((c) => c.id === objective.matchedChainId)
    : null;

  const handleToggle = () => {
    setExpanded((v) => !v);
    // Notify parent to redraw SVG routing after height change
    setTimeout(() => onLayoutChange?.(), 260);
  };

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!spaceId) {
        e.preventDefault();
        return;
      }
      // Don't toggle expanded on drag-start (the click handler still fires
      // on drop without movement, but native drag suppresses click).
      e.dataTransfer.effectAllowed = "copy";
      const payload: StrategyObjectiveDragPayload = {
        spaceId,
        objectiveId: objective.id,
        title: objective.title,
        description: objective.description ?? null,
        // The canvas shape requires a numeric progress for its inline bar;
        // qualitative / untracked objectives drop on the canvas at 0% and
        // the user can update it once execution data exists.
        progressPct: objective.progressPct ?? 0,
        tag: objective.tag,
        valueLabel: objective.valueLabel ?? null,
        paletteKey: row.paletteKey,
        sourceEntityIds: objective.sourceEntityIds,
        perspectiveLabel: row.categoryLabel,
      };
      e.dataTransfer.setData(
        STRATEGY_OBJECTIVE_DRAG_MIME,
        JSON.stringify(payload),
      );
      // text/plain fallback for non-canvas drop targets.
      const fallbackText = objective.description
        ? `${objective.title}\n\n${objective.description}`
        : objective.title;
      e.dataTransfer.setData("text/plain", fallbackText);
    },
    [spaceId, objective, row.paletteKey, row.categoryLabel],
  );

  return (
    <div
      draggable={Boolean(spaceId)}
      onDragStart={handleDragStart}
      className={cn(
        "rounded-[8px] overflow-hidden transition-all cursor-pointer",
        spaceId && "active:cursor-grabbing",
      )}
      onClick={handleToggle}
      title={
        spaceId
          ? "Click to expand · drag onto the canvas to pin this objective"
          : undefined
      }
      style={{
        background: "#fff",
        border: expanded
          ? `1px solid ${p.accent}`
          : "1px solid rgba(11,13,18,0.08)",
        boxShadow: expanded ? `0 0 0 2px ${p.tint}` : "0 1px 2px rgba(11,13,18,0.03)",
      }}
    >
      {/* Head */}
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <div className="flex-1 min-w-0">
          <p
            className="font-semibold mb-1.5 truncate"
            style={{
              fontSize: "12.5px",
              color: "#0B0D12",
              letterSpacing: "-0.005em",
              lineHeight: 1.3,
            }}
          >
            {objective.title}
          </p>
          {/* Progress bar only renders when we have a numeric percent. For
              qualitative metrics (current/target = "high"/"low") and for
              action-derived objectives that haven't been tracked yet, the
              valueLabel below carries the meaningful info instead. */}
          {objective.progressPct !== undefined && (
            <div
              className="h-[3px] rounded-full overflow-hidden relative"
              style={{ background: "rgba(11,13,18,0.06)" }}
            >
              <div
                className="absolute left-0 top-0 bottom-0 rounded-full"
                style={{
                  width: `${objective.progressPct}%`,
                  background: p.accent,
                }}
              />
            </div>
          )}
          {objective.valueLabel && (
            <p
              className="mt-1 font-mono"
              style={{
                fontSize: "9.5px",
                color: "rgba(11,13,18,0.48)",
                fontWeight: 500,
              }}
            >
              {objective.valueLabel}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isOnCanvas && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                presence.zoomToObjective(objective.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 transition-colors"
              style={{
                background: "rgba(16,185,129,0.10)",
                border: "1px solid rgba(16,185,129,0.32)",
                color: "#047857",
                fontSize: 8.5,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
              title="Pinned on canvas — click to zoom there"
              aria-label="Zoom to this objective on canvas"
            >
              <Pin className="h-2.5 w-2.5" strokeWidth={2.5} />
              On canvas
            </button>
          )}
          {objective.progressPct !== undefined && (
            <span
              className="tabular-nums"
              style={{
                fontSize: "11.5px",
                fontWeight: 700,
                color: "#0B0D12",
                letterSpacing: "-0.02em",
                minWidth: 30,
                textAlign: "right",
              }}
            >
              {objective.progressPct}%
            </span>
          )}
          <span
            className="rounded px-1.5 py-0.5"
            style={{
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              background:
                objective.tag === "lead"
                  ? "rgba(var(--accent-rgb), 0.08)"
                  : "rgba(251,191,36,0.1)",
              color: objective.tag === "lead" ? "var(--accent-700)" : "#B45309",
              border:
                objective.tag === "lead"
                  ? "1px solid rgba(var(--accent-rgb), 0.2)"
                  : "1px solid rgba(251,191,36,0.3)",
            }}
          >
            {objective.tag}
          </span>
          <span
            className={cn(
              "w-5 h-5 rounded flex items-center justify-center transition-all",
              expanded && "rotate-90",
            )}
            style={{
              border: "1px solid rgba(11,13,18,0.08)",
              background: expanded ? p.accent : "#fff",
              color: expanded ? "#fff" : "rgba(11,13,18,0.48)",
            }}
          >
            <ChevronRight className="w-2.5 h-2.5" strokeWidth={2.5} />
          </span>
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <>
          {matchedChain ? (
            <MechanismChain
              chain={matchedChain}
              entityMap={entityMap}
              spaceId={spaceId}
              assetEntityIds={objective.sourceEntityIds}
            />
          ) : (
            <div
              className="border-t"
              style={{
                borderColor: "rgba(11,13,18,0.08)",
                background: "rgba(247,248,250,0.6)",
                padding: "12px 14px",
                fontSize: 11,
                color: "rgba(11,13,18,0.48)",
              }}
            >
              {objective.description ? (
                <p style={{ marginBottom: 8, lineHeight: 1.5 }}>
                  {objective.description}
                </p>
              ) : null}
              <div
                className="flex items-center gap-2 rounded-md px-2.5 py-2"
                style={{
                  background: "rgba(99,102,241,0.06)",
                  border: "1px solid rgba(99,102,241,0.18)",
                  fontSize: 11,
                }}
              >
                <span style={{ color: "rgba(11,13,18,0.64)" }}>
                  No causal chain links this objective yet.
                </span>
                <a
                  href={`/app/space/${spaceId}/causal-chains`}
                  className="underline font-semibold transition-colors"
                  style={{ color: "#4F46E5" }}
                >
                  Generate chains →
                </a>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
