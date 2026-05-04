"use client";

import { useState } from "react";
import { Filter, Share2, RefreshCw, Sparkles, AlertTriangle } from "lucide-react";
import type { ViewKind as StrategyViewKind } from "../view-kind";
export type { StrategyViewKind };
import { cn } from "@/lib/utils";
import { ProvenanceChip, ChainArrow } from "./provenance-chip";
import { HeroMetric } from "./hero-metric";
import type { HeroVM } from "../strategy-view-model";

interface StrategyHeroGlassProps {
  hero: HeroVM;
  spaceId: string;
  status?: "generated" | "reviewing" | "confirmed" | "superseded" | null;
  /** Controlled view mode (optional — falls back to local state if not provided) */
  view?: StrategyViewKind;
  onViewChange?: (v: StrategyViewKind) => void;
  onRegenerate?: () => void;
  regenerating?: boolean;
  /**
   * Names of strategy-engine steps that fell back to a degraded path during
   * generation. When non-empty, the hero renders an amber banner so the
   * user can tell a clean run from one whose confidence number was
   * synthesized from a failed step.
   */
  degradedSteps?: string[];
}

type ViewKind = StrategyViewKind;

export function StrategyHeroGlass({
  hero,
  spaceId,
  status,
  onRegenerate,
  regenerating,
  view: controlledView,
  onViewChange,
  degradedSteps,
}: StrategyHeroGlassProps) {
  const [localView, setLocalView] = useState<ViewKind>("cascade");
  const view: ViewKind = controlledView ?? localView;
  const setView = (v: ViewKind) => {
    setLocalView(v);
    onViewChange?.(v);
  };

  const base = `/app/space/${spaceId}`;

  const statusLabel =
    status === "confirmed"
      ? "Confirmed strategy"
      : status === "reviewing"
        ? "Under review"
        : status === "superseded"
          ? "Superseded"
          : "Auto-generated strategy";

  const statusDotColor =
    status === "confirmed"
      ? "#10B981"
      : status === "reviewing"
        ? "#F59E0B"
        : "var(--accent-500)";

  return (
    <div
      className="glass-hero @container flex flex-col @[760px]:flex-row @[760px]:items-start @[760px]:justify-between gap-5 p-6 rounded-[20px]"
      style={{
        background: "rgba(255, 255, 255, 0.68)",
        backdropFilter: "blur(24px) saturate(170%)",
        WebkitBackdropFilter: "blur(24px) saturate(170%)",
        border: "1px solid rgba(255, 255, 255, 0.75)",
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.85) inset, 0 1px 2px rgba(11,13,18,0.04), 0 24px 60px -20px rgba(var(--accent-rgb), 0.18)",
      }}
    >
      <div className="@[760px]:flex-1 min-w-0 max-w-[820px] flex flex-col gap-2">
        {/* Degraded-run banner — appears only when one or more strategy
            engine steps fell back to a synthetic output. The confidence
            number is still rendered, but this banner tells the user it
            was assembled from a failed step (not an honest measurement),
            so they can decide whether to re-run before acting on it. */}
        {degradedSteps && degradedSteps.length > 0 && (
          <div
            className="flex items-start gap-2 rounded-lg px-3 py-2 mb-1"
            style={{
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.32)",
              color: "#92400E",
            }}
            role="alert"
          >
            <AlertTriangle className="w-3.5 h-3.5 mt-[1px] flex-shrink-0" />
            <span style={{ fontSize: 11.5, lineHeight: 1.45 }}>
              <span style={{ fontWeight: 700 }}>Degraded reasoning</span>
              {" — "}
              {degradedSteps.length === 1 ? "the" : `${degradedSteps.length} of 4`}
              {" "}step{degradedSteps.length > 1 ? "s" : ""}
              {" "}({degradedSteps.join(", ")}) fell back to a synthetic output.
              Confidence below may not reflect a clean reasoning trace —
              consider regenerating before acting on this strategy.
            </span>
          </div>
        )}

        {/* Pill */}
        <span
          className="inline-flex items-center gap-[7px] px-2.5 py-1 rounded-md text-[11px] font-semibold self-start"
          style={{
            background: "rgba(var(--accent-rgb), 0.06)",
            border: "1px solid rgba(var(--accent-rgb), 0.18)",
            color: "var(--accent-700)",
            letterSpacing: "-0.005em",
          }}
        >
          <span
            className="inline-block w-[5px] h-[5px] rounded-full"
            style={{
              background: statusDotColor,
              boxShadow:
                status === "generated" || !status
                  ? "0 0 0 3px rgba(var(--accent-rgb), 0.12)"
                  : undefined,
            }}
          />
          {statusLabel}
        </span>

        {/* Title */}
        <h1
          className="font-semibold"
          style={{
            fontSize: 22,
            letterSpacing: "-0.02em",
            lineHeight: 1.3,
            color: "#0B0D12",
          }}
        >
          {hero.title}
        </h1>

        {/* Summary */}
        <p
          className="max-w-[720px]"
          style={{
            fontSize: "12.5px",
            lineHeight: 1.55,
            color: "rgba(11,13,18,0.74)",
          }}
        >
          {hero.summary}
        </p>

        {/* Provenance chain — split into TWO honest groups:
            "Generated from" lists the actual upstream inputs to the
            strategy engine (KG, convergences, reasoning trace).
            "Derived" lists artifacts that are produced AFTER the
            strategy and reference it (causal chains propagate from
            L4 convergences through micro_tactics — i.e. they read
            the strategy's output, they don't feed into it).
            Conflating the two is misleading: a "Causal Chains · 0"
            chip in the upstream chain reads as "the strategy ran
            without chains as input" when in reality the strategy
            ran fine and chains were simply never propagated. */}
        <div
          className="flex items-center gap-2 flex-wrap mt-4 pt-3.5"
          style={{ borderTop: "1px solid rgba(11,13,18,0.08)" }}
        >
          <span
            className="font-mono mr-0.5"
            style={{
              fontSize: "9.5px",
              fontWeight: 700,
              color: "rgba(11,13,18,0.34)",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
            }}
          >
            Generated from
          </span>
          <ProvenanceChip
            label="Knowledge Graph"
            count={hero.provenance.kg.entities}
            countSuffix="entities"
            dotColor="#C084FC"
            href={`${base}/graph`}
            title={`${hero.provenance.kg.hubs} hub entities identified`}
          />
          <ChainArrow />
          <ProvenanceChip
            label="Convergence"
            count={hero.provenance.convergence.count}
            countSuffix={hero.provenance.convergence.count === 1 ? "convergence" : "convergences"}
            dotColor="var(--accent-500)"
            href={`${base}/convergence`}
            title={
              hero.provenance.convergence.l4Count > 0
                ? `${hero.provenance.convergence.l4Count} L4 invariant${hero.provenance.convergence.l4Count === 1 ? "" : "s"} of ${hero.provenance.convergence.count} total`
                : "No L4 invariants — chains seed from L3 mechanisms instead"
            }
          />
          <ChainArrow />
          <ProvenanceChip
            label="Reasoning Trace"
            count={hero.provenance.trace.iterationCount || undefined}
            countSuffix={
              hero.provenance.trace.iterationCount === 1 ? "step" : "steps"
            }
            dotColor="#F59E0B"
            title={
              hero.provenance.trace.present
                ? `Diagnose → synthesize → verify (${hero.provenance.trace.iterationCount} of 3 stages produced output)`
                : "No explicit trace recorded"
            }
          />
          {/* Visual separator between upstream inputs and downstream
              derivations — a vertical pipe instead of an arrow so it
              doesn't read as "and then". */}
          <span
            aria-hidden
            className="mx-1.5"
            style={{
              width: 1,
              height: 14,
              background: "rgba(11,13,18,0.14)",
              display: "inline-block",
            }}
          />
          <span
            className="font-mono mr-0.5"
            style={{
              fontSize: "9.5px",
              fontWeight: 700,
              color: "rgba(11,13,18,0.34)",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
            }}
            title="Artifacts derived from this strategy after it was generated"
          >
            Derived
          </span>
          <ProvenanceChip
            label="Causal Chains"
            count={hero.provenance.chains.count}
            countSuffix="trajectories"
            dotColor="#10B981"
            href={`${base}/causal-chains`}
            title={
              hero.provenance.chains.count === 0
                ? "Causal chains haven't been propagated yet — run them from the Causal Chains view to populate trajectories."
                : `${hero.provenance.chains.traced} chains fully traced`
            }
          />
        </div>

        {/* Hero metrics */}
        <div className="grid grid-cols-2 @[520px]:grid-cols-4 gap-2.5 mt-4">
          <HeroMetric
            label="Confidence"
            value={`${hero.metrics.confidence}`}
            unit="%"
            accent
          />
          {hero.metrics.targetMetric ? (
            <HeroMetric
              label={hero.metrics.targetMetric.name}
              value={hero.metrics.targetMetric.current}
              unit={hero.metrics.targetMetric.unit}
              delta={{
                display: `target ${hero.metrics.targetMetric.target}${hero.metrics.targetMetric.unit ?? ""}`,
                positive: true,
              }}
            />
          ) : (
            <HeroMetric label="Perspectives" value={`${hero.metrics.perspectivesCount}`} />
          )}
          <HeroMetric
            label="Tactics"
            value={`${hero.metrics.microTacticsCount}`}
            unit="steps"
          />
          <HeroMetric
            label="Alternatives"
            value={`${hero.metrics.alternativesCount}`}
            unit={hero.metrics.alternativesCount === 1 ? "path" : "paths"}
          />
        </div>
      </div>

      {/* Right side controls — stacks below the title block when the hero is narrower than 760px */}
      <div className="flex items-center gap-2 flex-wrap @[760px]:flex-shrink-0">
        <div
          className="flex p-[3px] rounded-[10px] flex-wrap"
          style={{
            background: "rgba(255,255,255,0.4)",
            border: "1px solid rgba(11,13,18,0.08)",
          }}
        >
          {(["cascade", "deliverables", "flow", "whiteboard"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "px-[11px] py-1.5 rounded-[7px] text-[11.5px] font-semibold transition-colors capitalize",
                view === v
                  ? "bg-white text-gray-900"
                  : "text-gray-500 bg-transparent hover:text-gray-700",
              )}
              style={
                view === v
                  ? {
                      boxShadow:
                        "0 1px 2px rgba(11,13,18,0.06), inset 0 0 0 1px rgba(11,13,18,0.08)",
                    }
                  : undefined
              }
            >
              {v}
            </button>
          ))}
        </div>
        {onRegenerate && (
          <button
            title="Regenerate strategy — apps and sub-strategies won't refresh until you confirm the new strategy"
            onClick={onRegenerate}
            disabled={regenerating}
            className="w-8 h-8 rounded-[9px] flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-white disabled:opacity-50 transition-all"
            style={{
              border: "1px solid rgba(11,13,18,0.08)",
              background: "rgba(255,255,255,0.5)",
            }}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", regenerating && "animate-spin")} />
          </button>
        )}
        <button
          title="Filter"
          className="w-8 h-8 rounded-[9px] flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-white transition-all"
          style={{
            border: "1px solid rgba(11,13,18,0.08)",
            background: "rgba(255,255,255,0.5)",
          }}
        >
          <Filter className="w-3.5 h-3.5" />
        </button>
        <button
          title="Share"
          className="w-8 h-8 rounded-[9px] flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-white transition-all"
          style={{
            border: "1px solid rgba(11,13,18,0.08)",
            background: "rgba(255,255,255,0.5)",
          }}
        >
          <Share2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
