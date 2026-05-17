"use client";

// ── Canvas Frame Map ──
//
// 4×5 verdict grid (knowledge_layer × entity_category) rendered as a
// compact chrome panel pinned top-left below the chip cluster. This is
// the densest information artifact the framing panel produces — for
// every (layer, category) cell, the panel decided
// required / permitted / irrelevant + assigned a confidence + recorded
// which lenses voted. Prior to this panel the grid sat in
// `spaces.situation_frame.cells[]` and never rendered on the canvas;
// users had no way to see the structural verdict that gates axis
// selection downstream.
//
// Visibility rules:
//   • Hidden in audit-mode == "surface" (decluttering for demos).
//   • Hidden when no frame is loaded (legacy spaces / mid-pipeline).
//   • Hidden when the panel hard-failed (no cells emitted at all).
//
// Interaction:
//   • Collapsed by default at trail-mode → renders as a small clickable
//     "Frame map · 7 required" pill (top-left).
//   • Expanded at audit-mode by default → renders the full grid.
//   • Click pill → expands; click X → collapses. State is local
//     (per-mount) — the audit-mode toggle is the persistent control.
//   • Hover any cell → tooltip with status + lens list + rationale.
//
// Design language:
//   • Solid dot = required (≥2 lenses voted, conf ≥ 0.4).
//   • Hollow dot = permitted.
//   • Blank = irrelevant.
//   • Dot OPACITY scales with cell confidence (0.4–1.0).
//   • No color encoding — neutral slate throughout so the canvas's
//     real chroma (axis accents, ghost shapes, room tints) reads
//     uninterrupted.
//
// Pinned position is top-left (left-6, top-32) so it doesn't compete
// with the stage indicator (top-center) or any of the lasso/system
// chips (which mount along the top-right axis).

import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSituationFrame } from "../situation-frame-context";
import { useCanvasAuditMode } from "../canvas-audit-mode-context";
import type {
  EntityCategory,
  FrameCell,
} from "@/types/situation-frame";
import type { KnowledgeLayer } from "@/types/layer";

const LAYERS: KnowledgeLayer[] = ["internal", "conceptual", "external", "bridge"];
const CATEGORIES: EntityCategory[] = [
  "concrete",
  "abstract",
  "process",
  "relational",
  "epistemic",
];

const LAYER_LABEL: Record<KnowledgeLayer, string> = {
  internal: "Internal",
  conceptual: "Conceptual",
  external: "External",
  bridge: "Bridge",
};
const CATEGORY_LABEL: Record<EntityCategory, string> = {
  concrete: "Concrete",
  abstract: "Abstract",
  process: "Process",
  relational: "Relational",
  epistemic: "Epistemic",
};

// Display name for lens IDs — kept in sync with the shell shape's
// LENS_DISPLAY so the same IDs render the same labels across the canvas.
const LENS_DISPLAY: Record<string, string> = {
  systems_analyst: "Systems",
  skeptic: "Skeptic",
  operator: "Operator",
  engineer: "Engineer",
  historian: "Historian",
};
function lensLabel(id: string): string {
  return LENS_DISPLAY[id] ?? id.replace(/_/g, " ");
}

export function CanvasFrameMap() {
  const { frame, loading } = useSituationFrame();
  const auditMode = useCanvasAuditMode();
  // Local expand state. Initial = expanded iff audit-mode is "audit",
  // collapsed otherwise. Audit toggle changes persist; expand toggle
  // is per-mount.
  const [expanded, setExpanded] = useState(auditMode === "audit");

  // Cells keyed by "layer|category" for O(1) lookup.
  const cellMap = useMemo(() => {
    const m = new Map<string, FrameCell>();
    if (!frame?.cells) return m;
    for (const c of frame.cells) {
      m.set(`${c.layer}|${c.category}`, c);
    }
    return m;
  }, [frame]);

  // Required cell count for the collapsed pill.
  const requiredCount = useMemo(() => {
    if (!frame?.cells) return 0;
    return frame.cells.filter((c) => c.status === "required").length;
  }, [frame]);

  // Surface mode hides the panel entirely.
  if (auditMode === "surface") return null;
  // Loading / legacy / panel-failed spaces hide silently.
  if (loading || !frame || !frame.cells || frame.cells.length === 0) return null;

  // Collapsed pill — small clickable chip when not expanded.
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          "pointer-events-auto absolute left-6 top-32 z-30 flex items-center gap-2",
          "rounded-full border border-slate-200 bg-white/90 px-3 py-1.5",
          "text-[11px] font-medium text-slate-600 shadow-sm backdrop-blur-md",
          "transition hover:bg-white",
        )}
        title="Open the 4×5 lens-grid verdict (4 layers × 5 categories)"
      >
        <span className="font-semibold text-slate-700">Frame map</span>
        <span className="text-slate-400">·</span>
        <span>
          {requiredCount} required
        </span>
        <ChevronDown className="h-3 w-3 text-slate-400" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "pointer-events-auto absolute left-6 top-32 z-30",
        "rounded-xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur-md",
      )}
      style={{ width: 296 }}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-semibold text-slate-700">
            Frame map
          </span>
          <span className="text-[10px] text-slate-400">
            4 layers × 5 categories
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Collapse frame map"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="px-3 py-2.5">
        {/* Grid: header row (categories) + 4 data rows (layers). Each
            cell renders a status glyph + opacity-scaled confidence. */}
        <div
          className="grid items-center gap-x-1.5 gap-y-1"
          style={{
            // Layer label col + 5 category cols. Layer col gets a fixed
            // width; category cols are equal-flex so the grid stays
            // tight at 280-ish px.
            gridTemplateColumns: "auto repeat(5, 1fr)",
          }}
        >
          {/* Header row */}
          <div />
          {CATEGORIES.map((cat) => (
            <div
              key={`hdr-${cat}`}
              className="text-center text-[8.5px] font-medium text-slate-400"
              title={CATEGORY_LABEL[cat]}
            >
              {CATEGORY_LABEL[cat].slice(0, 4)}
            </div>
          ))}

          {/* Data rows */}
          {LAYERS.map((layer) => (
            <FrameMapRow
              key={layer}
              layer={layer}
              cellMap={cellMap}
            />
          ))}
        </div>

        {/* Legend */}
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-[9.5px] text-slate-500">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full bg-slate-700"
                style={{ opacity: 0.85 }}
              />
              required
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full border border-slate-500"
                style={{ background: "transparent" }}
              />
              permitted
            </span>
          </div>
          <span className="text-slate-400">opacity = confidence</span>
        </div>

        {/* Intentionally-empty layers, if any */}
        {frame.layer_coverage &&
          frame.layer_coverage.some((lc) => lc.intentionally_empty) && (
            <div className="mt-2 border-t border-slate-100 pt-2 text-[9.5px] text-slate-500">
              <span className="font-semibold text-slate-600">
                Intentionally empty:
              </span>{" "}
              {frame.layer_coverage
                .filter((lc) => lc.intentionally_empty)
                .map((lc) => LAYER_LABEL[lc.layer])
                .join(", ")}
            </div>
          )}
      </div>
    </div>
  );
}

function FrameMapRow({
  layer,
  cellMap,
}: {
  layer: KnowledgeLayer;
  cellMap: Map<string, FrameCell>;
}) {
  return (
    <>
      <div
        className="pr-1 text-right text-[9.5px] font-medium text-slate-600"
        title={LAYER_LABEL[layer]}
      >
        {LAYER_LABEL[layer]}
      </div>
      {CATEGORIES.map((cat) => {
        const cell = cellMap.get(`${layer}|${cat}`);
        return (
          <FrameMapCell key={`${layer}|${cat}`} cell={cell} />
        );
      })}
    </>
  );
}

function FrameMapCell({ cell }: { cell: FrameCell | undefined }) {
  // Missing cell = treated as irrelevant.
  if (!cell || cell.status === "irrelevant") {
    return (
      <div
        className="flex h-5 items-center justify-center"
        title="irrelevant — no lens flagged this cell"
        aria-hidden
      >
        <span className="text-[10px] text-slate-200">·</span>
      </div>
    );
  }

  // Opacity = max(0.35, confidence). Floor of 0.35 keeps low-confidence
  // cells legible without overpromising; cells below 0.4 typically got
  // demoted from required → permitted by the consensus pass anyway, so
  // the visible delta between high- and low-conf is meaningful.
  const opacity = Math.max(0.35, Math.min(1, cell.confidence || 0.5));

  const isRequired = cell.status === "required";
  const tooltipLenses = cell.supporting_lenses.length
    ? cell.supporting_lenses.map(lensLabel).join(" · ")
    : "no lens recorded";
  const tooltip = `${cell.status.toUpperCase()} — ${tooltipLenses}\nconf ${Math.round(cell.confidence * 100)}%${cell.rationale ? `\n${cell.rationale.slice(0, 140)}` : ""}`;

  return (
    <div
      className="flex h-5 items-center justify-center"
      title={tooltip}
    >
      <span
        className={cn(
          "inline-block h-2.5 w-2.5 rounded-full",
          isRequired
            ? "bg-slate-700"
            : "border border-slate-500 bg-transparent",
        )}
        style={{ opacity }}
        aria-label={`${cell.layer} × ${cell.category}: ${cell.status}`}
      />
    </div>
  );
}
