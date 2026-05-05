"use client";

// ── TwinAnalyticsStrip ───────────────────────────────────────────────
//
// Composer that places the three new "is the twin alive and legible?"
// visualizations next to each other:
//
//   1. State-space radar  — 4-axis shape (Health / Coverage / low-Risk
//                           / Dynamics). Shows the *shape* of the twin,
//                           not just one number.
//   2. Health sparkline   — historical health_score trace over the
//                           project's lifetime, sourced from the
//                           twin_snapshots history endpoint.
//   3. Entity attribution — per-entity health contribution stacked
//                           bars (the legibility surface).
//
// Reads from useSpaceData + computeTwinState client-side (no fetch for
// the radar — synthesis_data is already in the SSR-hydrated context).
// The sparkline and attribution components fetch their own data.
//
// Self-hides nothing — the children handle their own empty states so
// the section is always present, just informative when bare.

import { useMemo } from "react";
import { useSpaceData } from "@/contexts/space-data-context";
import { computeTwinState } from "@/lib/twin/compute-twin-state";
import type { Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { TwinMacroState } from "@/types/twin";
import { TwinStateRadar } from "./twin-state-radar";
import { TwinHealthSparkline } from "./twin-health-sparkline";
import { TwinTrajectorySparkline } from "./twin-trajectory-sparkline";
import { TwinEntityAttribution } from "./twin-entity-attribution";

export function TwinAnalyticsStrip() {
  const { space, entities, edges, cycles, activeGoal } = useSpaceData();

  // computeTwinState returns the wrapping TwinState ({ macro, goal_overlay });
  // every viz here only needs the macro shape.
  const twin: TwinMacroState = useMemo(() => {
    const synthData = (space?.synthesis_data ?? null) as SynthesisData | null;
    const full = computeTwinState(
      space,
      entities as Entity[],
      edges as Edge[],
      cycles as Cycle[],
      synthData,
      activeGoal ?? undefined,
    );
    return full.macro;
  }, [space, entities, edges, cycles, activeGoal]);

  if (!space?.id) return null;

  return (
    <section className="flex flex-col gap-4" aria-label="Twin analytics">
      {/* Top strip: radar + summary line + sparkline */}
      <div
        className="relative overflow-hidden rounded-[18px] border border-white/60 bg-gradient-to-br from-white/85 via-white/70 to-white/55 px-5 py-4 shadow-[0_4px_14px_rgba(15,23,42,0.04)]"
        style={{
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
        }}
      >
        <div className="flex flex-col items-start gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-5">
            <TwinStateRadar state={twin} density="medium" />
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-[color:var(--muted-fg,#6b7280)]">
                Twin shape
              </span>
              <span className="text-[16px] font-semibold tracking-[-0.01em] text-[color:var(--fg,#1d1d1f)]">
                {capitalize(twin.health_label)} · {Math.round(twin.health_score)}/100
              </span>
              <span className="text-[11px] text-[color:var(--muted-fg,#86868b)]">
                {summarize(twin)}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-3">
            <div className="flex flex-col items-end gap-1">
              <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-[color:var(--muted-fg,#6b7280)]">
                History
              </span>
              <TwinHealthSparkline spaceId={space.id} width={180} height={44} />
              <span className="text-[10px] text-[color:var(--muted-fg,#86868b)]">
                health_score across snapshots
              </span>
            </div>
            {/* Forward projection from the most recent trajectory_run.
                Self-hides when no trajectory has been computed yet —
                so this strip stays calm when the engine hasn't been
                used. Once the user runs a projection, the sparkline
                appears alongside the historical trace. */}
            <div className="flex flex-col items-end gap-1">
              <span className="text-[10px] font-semibold tracking-[0.14em] uppercase text-[color:var(--muted-fg,#6b7280)]">
                Forecast
              </span>
              <TwinTrajectorySparkline spaceId={space.id} width={180} height={44} />
            </div>
          </div>
        </div>
      </div>

      {/* Per-entity attribution */}
      <TwinEntityAttribution />
    </section>
  );
}

// ── helpers ──────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

function summarize(twin: TwinMacroState): string {
  const parts: string[] = [];
  parts.push(`${twin.coverage.entities_modeled} entities`);
  if (twin.dynamics.total_loops > 0) {
    parts.push(`${twin.dynamics.total_loops} loop${twin.dynamics.total_loops === 1 ? "" : "s"}`);
  }
  if (twin.dynamics.leverage_points > 0) {
    parts.push(`${twin.dynamics.leverage_points} leverage`);
  }
  if (twin.risk_exposure.critical_risks > 0) {
    parts.push(`${twin.risk_exposure.critical_risks} critical risk${twin.risk_exposure.critical_risks === 1 ? "" : "s"}`);
  }
  if (twin.risk_exposure.bottleneck_name) {
    parts.push(`bottleneck: ${twin.risk_exposure.bottleneck_name}`);
  }
  return parts.join(" · ");
}
