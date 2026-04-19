"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  Target,
  GitBranch,
  Brain,
  Lightbulb,
  ArrowRight,
} from "lucide-react";
import type { StrategyLayers, StrategyPillar, PillarContribution } from "@/types/strategy";

// ── Pillar config ──

const PILLAR_CONFIG: Record<StrategyPillar, { label: string; color: string; bg: string; border: string }> = {
  assets: { label: "Assets", color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  deep_research: { label: "Research", color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200" },
  concept_graph: { label: "Graph", color: "text-violet-700", bg: "bg-violet-50", border: "border-violet-200" },
};

// ── Layer config ──

const LAYER_CONFIG = {
  l1: { label: "Outcomes", color: "text-green-700", bg: "bg-green-50/60", border: "border-green-200", barColor: "bg-green-500", ringColor: "border-green-500", dotColor: "bg-green-500", icon: Target },
  l2: { label: "Methods", color: "text-blue-700", bg: "bg-blue-50/60", border: "border-blue-200", barColor: "bg-blue-500", ringColor: "border-blue-500", dotColor: "bg-blue-500", icon: GitBranch },
  l3: { label: "Reasoning", color: "text-amber-700", bg: "bg-amber-50/60", border: "border-amber-200", barColor: "bg-amber-500", ringColor: "border-amber-500", dotColor: "bg-amber-500", icon: Brain },
  l4: { label: "Insights", color: "text-purple-700", bg: "bg-purple-50/60", border: "border-purple-200", barColor: "bg-purple-500", ringColor: "border-purple-500", dotColor: "bg-purple-500", icon: Lightbulb },
} as const;

// ── Sub-components ──

function PillarBadges({ sources }: { sources: PillarContribution[] }) {
  if (!sources.length) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap mt-1">
      {sources.map((ps, i) => {
        const cfg = PILLAR_CONFIG[ps.pillar];
        return (
          <span
            key={i}
            className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium border", cfg.bg, cfg.color, cfg.border)}
            title={`${cfg.label}: ${ps.contribution}\nRefs: ${ps.source_refs.join(", ")}`}
          >
            {cfg.label}
          </span>
        );
      })}
    </div>
  );
}

function CrossRefBadges({ ids, color }: { ids: string[]; color: string }) {
  if (!ids.length) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap mt-0.5">
      <ArrowRight className="h-2.5 w-2.5 text-gray-300" />
      {ids.map((id) => (
        <span key={id} className={cn("rounded px-1 py-0.5 text-[10px] font-mono font-medium", color)}>
          {id}
        </span>
      ))}
    </div>
  );
}

// ── Props ──

export interface StrategyLayersPanelProps {
  layers: StrategyLayers;
}

// ── Main Component ──

export function StrategyLayersPanel({ layers }: StrategyLayersPanelProps) {
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set(["l1", "l2"]));

  const toggleLayer = (key: string) => {
    setExpandedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const layerEntries: Array<{
    key: string;
    config: typeof LAYER_CONFIG[keyof typeof LAYER_CONFIG];
    count: number;
    content: React.ReactNode;
  }> = [
    {
      key: "l1",
      config: LAYER_CONFIG.l1,
      count: layers.l1_outcomes.length,
      content: (
        <div className="space-y-2">
          {layers.l1_outcomes
            .sort((a, b) => a.sequence_position - b.sequence_position)
            .map((l1) => (
              <div key={l1.id} className="rounded-lg border border-green-100 bg-white/60 p-2.5">
                <div className="flex items-start gap-2">
                  <span className="flex-shrink-0 mt-0.5 rounded-full bg-green-100 text-green-700 text-[11px] font-bold w-5 h-5 flex items-center justify-center">
                    {l1.sequence_position}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium text-gray-800 leading-snug">{l1.outcome}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{l1.sequence_rationale}</p>
                    {l1.target_metric && (
                      <span className="inline-block mt-1 rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-600">
                        {l1.target_metric}
                      </span>
                    )}
                    <CrossRefBadges ids={l1.served_by_l2} color="bg-blue-50 text-blue-600" />
                    <PillarBadges sources={l1.pillar_sources} />
                  </div>
                </div>
              </div>
            ))}
        </div>
      ),
    },
    {
      key: "l2",
      config: LAYER_CONFIG.l2,
      count: layers.l2_methods.length,
      content: (
        <div className="space-y-2">
          {layers.l2_methods.map((l2) => (
            <div key={l2.id} className="rounded-lg border border-blue-100 bg-white/60 p-2.5">
              <p className="text-[12px] font-semibold text-gray-800">{l2.title}</p>
              {l2.causal_chain.length > 0 && (
                <div className="mt-1.5 flex items-start gap-1 flex-wrap">
                  {l2.causal_chain.map((step, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && <ArrowRight className="h-3 w-3 text-blue-300 mt-0.5 flex-shrink-0" />}
                      <div className="rounded bg-blue-50 px-1.5 py-1 max-w-[200px]">
                        <p className="text-[11px] font-medium text-blue-800 leading-tight">{step.step}</p>
                        <p className="text-[10px] text-blue-500 mt-0.5">{step.mechanism}</p>
                        {step.entity_refs.length > 0 && (
                          <div className="flex items-center gap-0.5 mt-0.5">
                            {step.entity_refs.map((ref) => (
                              <span key={ref} className="rounded bg-blue-100 px-1 py-0.5 text-[10px] font-mono text-blue-600">
                                {ref}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-gray-400 mt-1 italic">{l2.optimality_rationale}</p>
              <div className="flex items-center gap-2 mt-1">
                <CrossRefBadges ids={l2.serves_l1} color="bg-green-50 text-green-600" />
                <CrossRefBadges ids={l2.justified_by_l3} color="bg-amber-50 text-amber-600" />
              </div>
              <PillarBadges sources={l2.pillar_sources} />
            </div>
          ))}
        </div>
      ),
    },
    {
      key: "l3",
      config: LAYER_CONFIG.l3,
      count: layers.l3_reasoning.length,
      content: (
        <div className="space-y-2">
          {layers.l3_reasoning.map((l3) => {
            const typeColors: Record<string, string> = {
              multiplier: "bg-yellow-100 text-yellow-700",
              threshold: "bg-orange-100 text-orange-700",
              feedback_activation: "bg-cyan-100 text-cyan-700",
              risk_negation: "bg-red-100 text-red-700",
              structural_leverage: "bg-indigo-100 text-indigo-700",
            };
            return (
              <div key={l3.id} className="rounded-lg border border-amber-100 bg-white/60 p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", typeColors[l3.reasoning_type] ?? "bg-gray-100 text-gray-600")}>
                    {l3.reasoning_type.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="text-[11px] text-gray-700 leading-relaxed">{l3.logic_statement}</p>
                {l3.evidence.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {l3.evidence.map((ev, i) => (
                      <p key={i} className="text-[11px] text-gray-400 pl-2 border-l border-amber-200">
                        {ev}
                      </p>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <CrossRefBadges ids={l3.justifies_l2} color="bg-blue-50 text-blue-600" />
                  <CrossRefBadges ids={l3.enhanced_by_l4} color="bg-purple-50 text-purple-600" />
                </div>
                <PillarBadges sources={l3.pillar_sources} />
              </div>
            );
          })}
        </div>
      ),
    },
    {
      key: "l4",
      config: LAYER_CONFIG.l4,
      count: layers.l4_insights.length,
      content: (
        <div className="space-y-2">
          {layers.l4_insights.map((l4) => {
            const confidenceColors: Record<string, string> = {
              high: "bg-green-400",
              moderate: "bg-amber-400",
              low: "bg-red-400",
            };
            const typeLabels: Record<string, string> = {
              hidden_variable: "Hidden Variable",
              structural_pattern: "Structural Pattern",
              cross_domain_analog: "Cross-Domain Analog",
              timing_signal: "Timing Signal",
              compounding_factor: "Compounding Factor",
              blind_spot: "Blind Spot",
            };
            return (
              <div key={l4.id} className="rounded-lg border border-purple-100 bg-white/60 p-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">
                    {typeLabels[l4.insight_type] ?? l4.insight_type}
                  </span>
                  <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] font-medium text-gray-500">
                    {l4.scale}
                  </span>
                  <span className={cn("h-1.5 w-1.5 rounded-full", confidenceColors[l4.confidence] ?? "bg-gray-300")} title={`${l4.confidence} confidence`} />
                </div>
                <p className="text-[11px] text-gray-700 leading-relaxed">{l4.insight}</p>
                <CrossRefBadges ids={l4.enhances_l3} color="bg-amber-50 text-amber-600" />
                <PillarBadges sources={l4.pillar_sources} />
              </div>
            );
          })}
        </div>
      ),
    },
  ];

  return (
    <div>
      {/* Architecture summary */}
      {layers.architecture_summary && (
        <p className="text-[11px] text-gray-500 italic leading-relaxed mb-3">
          {layers.architecture_summary}
        </p>
      )}

      {/* Vertical ladder */}
      <div className="relative pl-8">
        {/* Connecting train-line bar */}
        <div className="absolute left-[11px] top-3 bottom-3 w-[2px] bg-gradient-to-b from-green-400 via-blue-400 via-amber-400 to-purple-400 rounded-full" />

        {layerEntries.map((layer, layerIndex) => {
          const expanded = expandedLayers.has(layer.key);
          const Icon = layer.config.icon;
          const isLast = layerIndex === layerEntries.length - 1;

          return (
            <div key={layer.key} className={cn("relative", !isLast && "pb-4")}>
              {/* Layer node circle on the train line */}
              <div className={cn(
                "absolute left-[-20px] top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-white z-10",
                layer.config.ringColor
              )}>
                <Icon className={cn("h-3 w-3", layer.config.color)} />
              </div>

              {/* Layer header + content */}
              <div className={cn(
                "rounded-lg border transition-colors",
                layer.config.border,
                expanded ? layer.config.bg : "bg-white"
              )}>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
                  onClick={() => toggleLayer(layer.key)}
                >
                  <span className={cn("text-[13px] font-semibold flex-1", layer.config.color)}>
                    {layer.config.label}
                  </span>
                  <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
                    {layer.count}
                  </span>
                  <ChevronDown className={cn("h-3.5 w-3.5 text-gray-400 transition-transform", expanded && "rotate-180")} />
                </button>
                {expanded && layer.count > 0 && (
                  <div className="px-3 pb-3">
                    {layer.content}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
