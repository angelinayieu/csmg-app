"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Layers,
  ChevronDown,
  ArrowRight,
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Minus,
  BarChart3,
} from "lucide-react";
import type { IntelligenceRadarDataV2 } from "@/types/intelligence-v2";

// ── Types ──

type CrossLayerAnalysis = NonNullable<IntelligenceRadarDataV2["cross_layer_analysis"]>;
type ValidationChain = CrossLayerAnalysis["top_validation_chains"][number];
type LayerTension = CrossLayerAnalysis["top_layer_tensions"][number];

export interface CrossLayerAnalysisPanelProps {
  analysis: CrossLayerAnalysis;
  onEntityClick?: (entityId: string) => void;
  className?: string;
  compact?: boolean;
}

// ── Layer color helpers ──

const LAYER_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  internal: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", label: "User Assets" },
  conceptual: { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-200", label: "Concept Model" },
  external: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", label: "Research" },
  bridge: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", label: "Bridge" },
};

function getLayerStyle(layer: string) {
  return LAYER_COLORS[layer] ?? LAYER_COLORS.internal;
}

// ── Direction indicator ──

function DirectionBadge({ direction }: { direction: "validates" | "challenges" | "neutral" }) {
  const config = {
    validates: { icon: CheckCircle2, color: "text-green-600 bg-green-50 border-green-200", label: "Validates" },
    challenges: { icon: XCircle, color: "text-red-600 bg-red-50 border-red-200", label: "Challenges" },
    neutral: { icon: Minus, color: "text-gray-500 bg-gray-50 border-gray-200", label: "Neutral" },
  };
  const c = config[direction];
  const Icon = c.icon;
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide", c.color)}>
      <Icon className="h-2.5 w-2.5" />
      {c.label}
    </span>
  );
}

// ── Severity badge ──

function SeverityBadge({ severity }: { severity: "high" | "medium" | "low" }) {
  const colors = {
    high: "bg-red-50 text-red-700 border-red-200",
    medium: "bg-amber-50 text-amber-700 border-amber-200",
    low: "bg-gray-100 text-gray-500 border-gray-200",
  };
  return (
    <span className={cn("rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase", colors[severity])}>
      {severity}
    </span>
  );
}

// ── Validation Chain Card ──

function ValidationChainCard({
  chain,
  onEntityClick,
}: {
  chain: ValidationChain;
  onEntityClick?: (id: string) => void;
}) {
  const confidencePct = Math.round(chain.chain_confidence * 100);
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      {/* Chain flow visualization */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {/* External entity */}
        <button
          onClick={() => onEntityClick?.(chain.external_entity.id)}
          className={cn(
            "rounded-md border px-2 py-1 text-[10px] font-medium transition-colors hover:ring-1 hover:ring-purple-300",
            getLayerStyle("external").bg,
            getLayerStyle("external").text,
            getLayerStyle("external").border,
          )}
        >
          {chain.external_entity.name}
        </button>

        <ArrowRight className="h-3 w-3 text-gray-400 flex-shrink-0" />

        {/* Conceptual intermediary (optional) */}
        {chain.conceptual_entity && (
          <>
            <button
              onClick={() => onEntityClick?.(chain.conceptual_entity!.id)}
              className={cn(
                "rounded-md border px-2 py-1 text-[10px] font-medium transition-colors hover:ring-1 hover:ring-teal-300",
                getLayerStyle("conceptual").bg,
                getLayerStyle("conceptual").text,
                getLayerStyle("conceptual").border,
              )}
            >
              {chain.conceptual_entity.name}
            </button>
            <ArrowRight className="h-3 w-3 text-gray-400 flex-shrink-0" />
          </>
        )}

        {/* Internal entity */}
        <button
          onClick={() => onEntityClick?.(chain.internal_entity.id)}
          className={cn(
            "rounded-md border px-2 py-1 text-[10px] font-medium transition-colors hover:ring-1 hover:ring-blue-300",
            getLayerStyle("internal").bg,
            getLayerStyle("internal").text,
            getLayerStyle("internal").border,
          )}
        >
          {chain.internal_entity.name}
        </button>
      </div>

      {/* Meta row */}
      <div className="mt-2 flex items-center gap-2">
        <DirectionBadge direction={chain.direction} />
        <div className="flex items-center gap-1">
          <div className="h-1 w-12 rounded-full bg-gray-200">
            <div
              className={cn(
                "h-1 rounded-full transition-all",
                confidencePct >= 70 ? "bg-green-400" : confidencePct >= 40 ? "bg-amber-400" : "bg-red-400",
              )}
              style={{ width: `${confidencePct}%` }}
            />
          </div>
          <span className="text-[8px] text-gray-400">{confidencePct}%</span>
        </div>
        {chain.conceptual_entity && (
          <span className="text-[8px] text-teal-500 font-medium">via concept model</span>
        )}
      </div>
    </div>
  );
}

// ── Layer Tension Card ──

function LayerTensionCard({
  tension,
  onEntityClick,
}: {
  tension: LayerTension;
  onEntityClick?: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-red-100 bg-red-50/20 px-3 py-2.5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3 text-red-500" />
          <span className="text-[9px] font-semibold text-red-600 uppercase tracking-wide">Layer Tension</span>
        </div>
        <SeverityBadge severity={tension.severity} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {/* Internal claim */}
        <div className={cn("rounded-md border px-2.5 py-1.5", getLayerStyle("internal").bg, getLayerStyle("internal").border)}>
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[7px] font-bold uppercase tracking-wide text-blue-500">Internal Claim</span>
          </div>
          <button
            onClick={() => onEntityClick?.(tension.internal_claim.entity_id)}
            className="text-[10px] font-semibold text-blue-800 hover:underline cursor-pointer"
          >
            {tension.internal_claim.name}
          </button>
          <p className="text-[9px] text-blue-700/80 leading-snug mt-0.5">
            {tension.internal_claim.claim}
          </p>
        </div>

        {/* External counter */}
        <div className={cn("rounded-md border px-2.5 py-1.5", getLayerStyle("external").bg, getLayerStyle("external").border)}>
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[7px] font-bold uppercase tracking-wide text-purple-500">External Counter</span>
          </div>
          <button
            onClick={() => onEntityClick?.(tension.external_counter.entity_id)}
            className="text-[10px] font-semibold text-purple-800 hover:underline cursor-pointer"
          >
            {tension.external_counter.name}
          </button>
          <p className="text-[9px] text-purple-700/80 leading-snug mt-0.5">
            {tension.external_counter.claim}
          </p>
        </div>
      </div>

      {/* Mediating mechanism */}
      {tension.mediating_mechanism && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-[8px] text-gray-400">Mediator:</span>
          <button
            onClick={() => onEntityClick?.(tension.mediating_mechanism!.entity_id)}
            className={cn(
              "rounded-md border px-1.5 py-0.5 text-[9px] font-medium hover:ring-1 hover:ring-teal-300",
              getLayerStyle("conceptual").bg,
              getLayerStyle("conceptual").text,
              getLayerStyle("conceptual").border,
            )}
          >
            {tension.mediating_mechanism.name}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Layer Density Bar ──

function LayerDensityBars({
  density,
}: {
  density: Record<string, { entities: number; edges: number; density: number }>;
}) {
  const layers = Object.entries(density).sort(
    (a, b) => b[1].entities - a[1].entities,
  );
  const maxEntities = Math.max(...layers.map(([, d]) => d.entities), 1);

  return (
    <div className="space-y-1.5">
      {layers.map(([layer, data]) => {
        const style = getLayerStyle(layer);
        const pct = Math.round((data.entities / maxEntities) * 100);
        return (
          <div key={layer} className="flex items-center gap-2">
            <span className={cn("w-20 text-[9px] font-medium text-right", style.text)}>
              {style.label}
            </span>
            <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all", style.bg.replace("50", "400").replace("bg-", "bg-"))}
                style={{ width: `${pct}%`, backgroundColor: layer === "internal" ? "#3b82f6" : layer === "conceptual" ? "#14b8a6" : layer === "external" ? "#8b5cf6" : "#f59e0b" }}
              />
            </div>
            <span className="text-[8px] text-gray-400 w-16 tabular-nums">
              {data.entities}e · {data.edges}c
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Panel ──

export function CrossLayerAnalysisPanel({
  analysis,
  onEntityClick,
  className,
  compact = false,
}: CrossLayerAnalysisPanelProps) {
  const [showChains, setShowChains] = useState(true);
  const [showTensions, setShowTensions] = useState(true);
  const [showDensity, setShowDensity] = useState(!compact);

  const chains = analysis.top_validation_chains ?? [];
  const tensions = analysis.top_layer_tensions ?? [];
  const hasDensity = analysis.layer_density && Object.keys(analysis.layer_density).length > 0;

  if (chains.length === 0 && tensions.length === 0 && !hasDensity) return null;

  const displayChains = compact ? chains.slice(0, 3) : chains;
  const displayTensions = compact ? tensions.slice(0, 3) : tensions;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <Layers className="h-4 w-4 text-teal-500" />
          <span className="text-[11px] font-bold text-gray-800">Cross-Layer Analysis</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[8px] font-medium text-teal-600">
            {analysis.validation_chain_count} chains
          </span>
          {analysis.layer_tension_count > 0 && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[8px] font-medium text-red-600">
              {analysis.layer_tension_count} tensions
            </span>
          )}
        </div>
      </div>

      {/* Layer Density */}
      {hasDensity && (
        <div>
          <button
            onClick={() => setShowDensity(!showDensity)}
            className="w-full flex items-center justify-between group mb-1.5"
          >
            <div className="flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-gray-500 group-hover:text-gray-700">
                Knowledge Layer Density
              </span>
            </div>
            <ChevronDown className={cn("h-3 w-3 text-gray-300 transition-transform", showDensity && "rotate-180")} />
          </button>
          {showDensity && (
            <LayerDensityBars density={analysis.layer_density} />
          )}
        </div>
      )}

      {/* Validation Chains */}
      {chains.length > 0 && (
        <div>
          <button
            onClick={() => setShowChains(!showChains)}
            className="w-full flex items-center justify-between group"
          >
            <div className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-green-500" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-gray-500 group-hover:text-gray-700">
                Validation Chains
              </span>
              <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-medium text-green-600">
                {chains.length}
              </span>
            </div>
            <ChevronDown className={cn("h-3 w-3 text-gray-300 transition-transform", showChains && "rotate-180")} />
          </button>
          {showChains && (
            <div className="mt-2 space-y-1.5">
              {displayChains.map((chain) => (
                <ValidationChainCard
                  key={chain.id}
                  chain={chain}
                  onEntityClick={onEntityClick}
                />
              ))}
              {compact && chains.length > 3 && (
                <p className="text-[9px] text-gray-400 text-center">
                  +{chains.length - 3} more chains in fullscreen view
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Layer Tensions */}
      {tensions.length > 0 && (
        <div>
          <button
            onClick={() => setShowTensions(!showTensions)}
            className="w-full flex items-center justify-between group"
          >
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-gray-500 group-hover:text-gray-700">
                Layer Tensions
              </span>
              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-medium text-red-600">
                {tensions.length}
              </span>
            </div>
            <ChevronDown className={cn("h-3 w-3 text-gray-300 transition-transform", showTensions && "rotate-180")} />
          </button>
          {showTensions && (
            <div className="mt-2 space-y-2">
              {displayTensions.map((t) => (
                <LayerTensionCard
                  key={t.id}
                  tension={t}
                  onEntityClick={onEntityClick}
                />
              ))}
              {compact && tensions.length > 3 && (
                <p className="text-[9px] text-gray-400 text-center">
                  +{tensions.length - 3} more tensions in fullscreen view
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
