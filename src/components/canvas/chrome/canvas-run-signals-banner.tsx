"use client";

// ── Canvas run-signals banner ──
//
// Audit fix: three event types were being silently dropped because
// nothing listened to them:
//   • `target_outcome_identified` — emitted once per run by the
//     target-outcome extractor (frame-extractor/route.ts:633).
//     Carries the run's target metric + direction. Before this,
//     the extractor's work never surfaced in the UI.
//   • `layer_coverage_gap` — emitted by synthesize/route.ts when
//     coverage gate finds missing layers. Carries a human-readable
//     message the UI should display verbatim. The commentary on the
//     event explicitly said "UI may render as a warning banner
//     verbatim" — this is that banner.
//   • `measurement_coverage_gap` — D1 companion to layer-coverage-gap
//     (docs/KG_DEPTH_CRITIQUE.md §9 D1). Emitted by synthesize/route.ts
//     when fundamental/critical entities in measurable categories
//     lack a unit + scale spec. Same banner pattern, distinct icon
//     and copy ("📏 unmeasured: …").
//
// All three are run-scoped + transient. We pin them as a compact
// pill / warning strip below the topbar and auto-fade the outcome
// pill ~20s after it arrives. Coverage-gap warnings are sticky until
// dismissed — they signal something the user should fix or confirm.

import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, AlertTriangle, Target, X, Ruler } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRunEventStore } from "../hooks/run-event-store";
import type {
  LayerCoverageGapEvent,
  MeasurementCoverageGapEvent,
  TargetOutcomeIdentifiedEvent,
} from "@/types/pipeline-events";

export interface CanvasRunSignalsBannerProps {
  runId: string | null;
}

const OUTCOME_AUTO_FADE_MS = 20_000;

export function CanvasRunSignalsBanner({ runId }: CanvasRunSignalsBannerProps) {
  const { events } = useRunEventStore();

  const outcome = useMemo<TargetOutcomeIdentifiedEvent | null>(() => {
    // Latest wins — the extractor fires once per run but allow replay.
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i].event;
      if (e.type === "target_outcome_identified") {
        return e as TargetOutcomeIdentifiedEvent;
      }
    }
    return null;
  }, [events]);

  const gaps = useMemo<LayerCoverageGapEvent[]>(() => {
    // Collect every gap event — synthesize can emit one per space in
    // multi-space runs. Dedupe by spaceId; later emissions win.
    const byKey = new Map<string, LayerCoverageGapEvent>();
    for (const s of events) {
      if (s.event.type === "layer_coverage_gap") {
        const e = s.event as LayerCoverageGapEvent;
        byKey.set(e.spaceId, e);
      }
    }
    return Array.from(byKey.values());
  }, [events]);

  // D1 — same dedupe pattern for the measurement-coverage gap event.
  const measurementGaps = useMemo<MeasurementCoverageGapEvent[]>(() => {
    const byKey = new Map<string, MeasurementCoverageGapEvent>();
    for (const s of events) {
      if (s.event.type === "measurement_coverage_gap") {
        const e = s.event as MeasurementCoverageGapEvent;
        byKey.set(e.spaceId, e);
      }
    }
    return Array.from(byKey.values());
  }, [events]);

  const [outcomeFaded, setOutcomeFaded] = useState(false);
  useEffect(() => {
    if (!outcome) return;
    setOutcomeFaded(false);
    const t = setTimeout(() => setOutcomeFaded(true), OUTCOME_AUTO_FADE_MS);
    return () => clearTimeout(t);
  }, [outcome?.runId, outcome?.name]);

  const [dismissedGaps, setDismissedGaps] = useState<Set<string>>(new Set());
  const [dismissedMeasurementGaps, setDismissedMeasurementGaps] = useState<
    Set<string>
  >(new Set());

  if (!outcome && gaps.length === 0 && measurementGaps.length === 0) return null;

  const visibleGaps = gaps.filter((g) => !dismissedGaps.has(g.spaceId));
  const visibleMeasurementGaps = measurementGaps.filter(
    (g) => !dismissedMeasurementGaps.has(g.spaceId),
  );

  return (
    <div
      className="pointer-events-none absolute left-1/2 top-14 z-20 flex -translate-x-1/2 flex-col items-center gap-2"
      aria-live="polite"
    >
      {outcome && !outcomeFaded && (
        <div
          className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-emerald-200/80 bg-white/90 px-3 py-1 text-[11px] font-medium shadow-sm backdrop-blur-md transition-opacity duration-500"
          title={outcome.rationale}
          style={{
            opacity: outcomeFaded ? 0 : 1,
          }}
        >
          <Target className="h-3 w-3 text-emerald-600" />
          <span className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-emerald-700">
            Target
          </span>
          <span className="text-gray-800">{outcome.name}</span>
          <DirectionIcon direction={outcome.direction} />
          {outcome.horizon && (
            <span className="text-[10px] text-gray-400">
              · {horizonLabel(outcome.horizon)}
            </span>
          )}
        </div>
      )}

      {visibleGaps.map((g) => (
        <div
          key={g.spaceId}
          className={cn(
            "pointer-events-auto flex max-w-[560px] items-start gap-2 rounded-lg border px-3 py-2 text-[11.5px] shadow-sm backdrop-blur-md",
            g.bypassed
              ? "border-amber-300/60 bg-amber-50/90 text-amber-900"
              : "border-red-300/60 bg-red-50/90 text-red-900",
          )}
          role="alert"
        >
          <AlertTriangle
            className={cn(
              "mt-0.5 h-3.5 w-3.5 flex-shrink-0",
              g.bypassed ? "text-amber-600" : "text-red-600",
            )}
          />
          <div className="flex-1 leading-snug">
            <div className="text-[9.5px] font-bold uppercase tracking-[0.14em]">
              {g.bypassed ? "Coverage gap (bypassed)" : "Coverage gap"}
            </div>
            <div className="mt-0.5">{g.message}</div>
            {g.gaps.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1 text-[10px] opacity-80">
                {g.gaps.map((gp, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-white/60 px-1.5 py-0.5 font-medium"
                  >
                    {gp.layer} · {gp.severity} · {gp.required_cell_count}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() =>
              setDismissedGaps((prev) => {
                const next = new Set(prev);
                next.add(g.spaceId);
                return next;
              })
            }
            className="flex h-5 w-5 items-center justify-center rounded-full text-current opacity-60 hover:bg-white/50 hover:opacity-100"
            title="Dismiss"
            aria-label="Dismiss coverage gap warning"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}

      {visibleMeasurementGaps.map((g) => {
        const pct = Math.round(g.stats.coverage_ratio * 100);
        const threshold = Math.round(g.stats.threshold_applied * 100);
        return (
          <div
            key={`m-${g.spaceId}`}
            className={cn(
              "pointer-events-auto flex max-w-[600px] items-start gap-2 rounded-lg border px-3 py-2 text-[11.5px] shadow-sm backdrop-blur-md",
              g.bypassed
                ? "border-amber-300/60 bg-amber-50/90 text-amber-900"
                : "border-orange-300/60 bg-orange-50/90 text-orange-900",
            )}
            role="alert"
          >
            <Ruler
              className={cn(
                "mt-0.5 h-3.5 w-3.5 flex-shrink-0",
                g.bypassed ? "text-amber-600" : "text-orange-600",
              )}
            />
            <div className="flex-1 leading-snug">
              <div className="flex items-center gap-2">
                <span className="text-[9.5px] font-bold uppercase tracking-[0.14em]">
                  {g.bypassed
                    ? "Measurement gap (bypassed)"
                    : "Measurement gap"}
                </span>
                <span className="rounded-full bg-white/60 px-1.5 py-0.5 text-[9.5px] font-medium tabular-nums">
                  {g.stats.measured_count}/{g.stats.gated_count} measured · {pct}% (target {threshold}%)
                </span>
              </div>
              <div className="mt-0.5">{g.message}</div>
              {g.gaps.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1 text-[10px] opacity-80">
                  {g.gaps.slice(0, 8).map((gp, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-white/60 px-1.5 py-0.5 font-medium"
                      title={`${gp.importance} ${gp.entity_category} · ${gp.reason.replace(/_/g, " ")}`}
                    >
                      {gp.entity_name || gp.entity_id || "?"}
                    </span>
                  ))}
                  {g.gaps.length > 8 && (
                    <span className="rounded-full bg-white/60 px-1.5 py-0.5 font-medium">
                      +{g.gaps.length - 8} more
                    </span>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() =>
                setDismissedMeasurementGaps((prev) => {
                  const next = new Set(prev);
                  next.add(g.spaceId);
                  return next;
                })
              }
              className="flex h-5 w-5 items-center justify-center rounded-full text-current opacity-60 hover:bg-white/50 hover:opacity-100"
              title="Dismiss"
              aria-label="Dismiss measurement gap warning"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function DirectionIcon({
  direction,
}: {
  direction: TargetOutcomeIdentifiedEvent["direction"];
}) {
  if (direction === "maximize")
    return <ArrowUpRight className="h-3 w-3 text-emerald-600" aria-label="maximize" />;
  if (direction === "minimize")
    return <ArrowDownRight className="h-3 w-3 text-red-600" aria-label="minimize" />;
  return <Minus className="h-3 w-3 text-gray-500" aria-label="maintain" />;
}

function horizonLabel(h: NonNullable<TargetOutcomeIdentifiedEvent["horizon"]>): string {
  switch (h) {
    case "immediate":
      return "now";
    case "short_term":
      return "short-term";
    case "medium_term":
      return "medium-term";
    case "long_term":
      return "long-term";
  }
}
