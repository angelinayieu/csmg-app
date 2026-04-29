"use client";

// ── Composition (right rail) ──────────────────────────────────────
//
// 4 rows — Buffer (β₄), Decay (δ), Rehearsal (ρ), Attention (α) —
// each with a colored badge, name, weight bar, and 0–100 score.
// Weights come from prediction.compWeights.
//
// L1 first-pass (D14 follow-up): the components themselves are still
// hard-coded to the WORKING-MEMORY MODEL (Cowan 2001 / Baddeley
// architecture). This is correct for the cognitive template but is
// NOT generic — a non-cognitive Twin shouldn't see β/δ/ρ/α. Until the
// full L1 refactor lands (entity-param-driven simulator), this panel
// surfaces the Twin name + KG-scope size in its header so users
// understand "these 4 primitives are the working-memory model
// computed for this Twin", not a universal Lab compass.
//
// Next steps:
//   - L1b: Subject schema generalization (arbitrary parameter sets)
//   - L1c: predict.ts as a generic param-driven simulator
//   - L1d: COMPONENTS derived from KG entities scoped by the Twin

import { Info } from "lucide-react";
import { COMPONENTS } from "../lib/components-defs";
import type { Prediction } from "../lib/types";

export interface CompositionPanelProps {
  prediction: Prediction;
  /** Twin name shown in the header so users see WHAT this composition
   *  is being computed for. Optional for back-compat. */
  subjectName?: string;
  /** KG scope summary shown under the header so users see what
   *  entities back the model. Optional. */
  scopeSummary?: {
    /** Count of entities this Twin's scope_system contains. */
    entity_count: number;
    /** Optional brief label, e.g. "CRCI biology". */
    label?: string;
  };
}

export function CompositionPanel({
  prediction,
  subjectName,
  scopeSummary,
}: CompositionPanelProps) {
  // L1 transparency tooltip: explains why these specific 4 primitives
  // (working memory model) are being shown regardless of which Twin is
  // active. Surfaces the deferred-fix explicitly so users understand
  // it's a known limitation, not a bug.
  const modelTooltip =
    "Working-memory model: 4 primitives from Cowan/Baddeley architecture. " +
    "Currently hard-coded for cognitive Twins. Future versions will derive the " +
    "primitive set from each Twin's scoped KG entities.";

  return (
    <div className="border-t border-black/[0.05] px-[18px] py-[14px]">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6e6e73]">
            Composition
          </span>
          <span
            className="text-[10px] font-medium text-[#a1a1a6]"
            title={modelTooltip}
          >
            · Working-Memory Model
          </span>
          <Info
            className="h-3 w-3 cursor-help text-[#c7c7cc]"
            aria-label={modelTooltip}
          />
        </div>
        <div className="text-[11px] font-medium text-[#86868b]">4 parts</div>
      </div>

      {/* L1 — Twin + scope context. Renders ONLY when caller passes
          subjectName / scopeSummary, so existing call sites that don't
          supply these stay visually unchanged. */}
      {(subjectName || scopeSummary) && (
        <div className="mb-2.5 flex items-center gap-2 text-[10.5px] text-[#86868b]">
          {subjectName && (
            <span>
              for <span className="font-semibold text-[#1d1d1f]">{subjectName}</span>
            </span>
          )}
          {subjectName && scopeSummary && <span className="text-[#d2d2d7]">·</span>}
          {scopeSummary && (
            <span>
              scope:{" "}
              <span className="font-mono tabular-nums text-[#1d1d1f]">
                {scopeSummary.entity_count}
              </span>{" "}
              {scopeSummary.entity_count === 1 ? "entity" : "entities"}
              {scopeSummary.label ? ` · ${scopeSummary.label}` : ""}
            </span>
          )}
        </div>
      )}

      <div className="divide-y divide-black/[0.05]">
        {COMPONENTS.map((c) => {
          const w = Math.round(prediction.compWeights[c.id]);
          const colorBg = `${c.color}20`;

          return (
            <div
              key={c.id}
              className="grid items-center gap-2.5 py-1.5 text-[12px]"
              style={{
                gridTemplateColumns: "22px 1fr 70px 28px",
              }}
              title={c.role}
            >
              {/* Greek-letter badge */}
              <div
                className="relative grid h-[22px] w-[22px] place-items-center rounded-[9px] text-[11px] font-bold leading-none tracking-[-0.02em]"
                style={{
                  background: colorBg,
                  color: c.color,
                }}
              >
                {c.sym}
                {c.sub && (
                  <span className="absolute -bottom-[1px] right-[2px] text-[7px] font-bold leading-none">
                    {c.sub}
                  </span>
                )}
              </div>

              {/* Name */}
              <div className="overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[#1d1d1f]">
                {c.name}
              </div>

              {/* Bar */}
              <div className="h-1 overflow-hidden rounded-[2px] bg-[#f2f2f4]">
                <div
                  className="h-full rounded-[2px] transition-[width] duration-300"
                  style={{
                    width: `${w}%`,
                    background: c.color,
                  }}
                />
              </div>

              {/* Value */}
              <div className="text-right text-[11px] font-semibold tabular-nums text-[#424245]">
                {w}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
