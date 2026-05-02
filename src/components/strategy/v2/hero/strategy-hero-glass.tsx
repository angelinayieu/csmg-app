"use client";

import { useState } from "react";
import { Filter, Share2, RefreshCw, Sparkles } from "lucide-react";
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
      className="glass-hero @container flex items-start justify-between gap-5 flex-wrap p-6 rounded-[20px]"
      style={{
        background: "rgba(255, 255, 255, 0.68)",
        backdropFilter: "blur(24px) saturate(170%)",
        WebkitBackdropFilter: "blur(24px) saturate(170%)",
        border: "1px solid rgba(255, 255, 255, 0.75)",
        boxShadow:
          "0 1px 0 rgba(255,255,255,0.85) inset, 0 1px 2px rgba(11,13,18,0.04), 0 24px 60px -20px rgba(var(--accent-rgb), 0.18)",
      }}
    >
      <div className="flex-1 min-w-0 max-w-[820px] flex flex-col gap-2">
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

        {/* Provenance chain */}
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
            count={hero.provenance.convergence.l4Count}
            countSuffix={hero.provenance.convergence.l4Count === 1 ? "L4 atom" : "L4 atoms"}
            dotColor="var(--accent-500)"
            href={`${base}/convergence`}
          />
          <ChainArrow />
          <ProvenanceChip
            label="Causal Chains"
            count={hero.provenance.chains.count}
            countSuffix="trajectories"
            dotColor="#10B981"
            href={`${base}/causal-chains`}
            title={`${hero.provenance.chains.traced} chains fully traced`}
          />
          <ChainArrow />
          <ProvenanceChip
            label="Reasoning Trace"
            count={hero.provenance.trace.iterationCount || undefined}
            countSuffix={
              hero.provenance.trace.iterationCount === 1 ? "iteration" : "iterations"
            }
            dotColor="#F59E0B"
            title={
              hero.provenance.trace.present
                ? "Click to inspect iterative reasoning"
                : "No explicit trace recorded"
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

      {/* Right side controls — wraps below the title block when the hero is narrower than ~720px */}
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <div
          className="flex p-[3px] rounded-[10px] flex-wrap"
          style={{
            background: "rgba(255,255,255,0.4)",
            border: "1px solid rgba(11,13,18,0.08)",
          }}
        >
          {(["cascade", "deliverables", "flow", "table", "whiteboard"] as const).map((v) => (
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
            title="Regenerate strategy"
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
