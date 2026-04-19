"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  ChevronDown,
  Combine,
} from "lucide-react";
import type { IntelligenceRadarDataV2 } from "@/types/intelligence-v2";

// ── Types ──

type Composition = NonNullable<IntelligenceRadarDataV2["compositions"]>[number];

export interface CompositionsPanelProps {
  compositions: Composition[];
  onEntityClick?: (entityId: string) => void;
  className?: string;
  compact?: boolean;
}

// ── Layer colors for chips ──

const LAYER_CHIP_COLORS: Record<string, { bg: string; text: string }> = {
  internal: { bg: "bg-blue-100", text: "text-blue-700" },
  conceptual: { bg: "bg-teal-100", text: "text-teal-700" },
  external: { bg: "bg-purple-100", text: "text-purple-700" },
  bridge: { bg: "bg-amber-100", text: "text-amber-700" },
};

function layerChipStyle(layer: string) {
  return LAYER_CHIP_COLORS[layer] ?? LAYER_CHIP_COLORS.internal;
}

// ── Composition Card ──

function CompositionCard({
  composition,
  onEntityClick,
}: {
  composition: Composition;
  onEntityClick?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const scorePct = Math.round(composition.composition_score * 100);

  return (
    <div className="rounded-lg border border-blue-100 bg-gradient-to-br from-blue-50/30 to-purple-50/20 px-3 py-2.5">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Combine className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
          <span className="text-[11px] font-semibold text-gray-800 truncate">
            {composition.emergent_label}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <div className="h-1.5 w-10 rounded-full bg-blue-100">
            <div
              className="h-1.5 rounded-full bg-blue-400"
              style={{ width: `${Math.min(scorePct, 100)}%` }}
            />
          </div>
          <span className="text-[8px] text-blue-500 tabular-nums">{scorePct}%</span>
        </div>
      </div>

      {/* Description */}
      <p className="mt-1.5 text-[10px] text-gray-600 leading-snug">
        {composition.emergent_description}
      </p>

      {/* Component entities */}
      <div className="mt-2 flex flex-wrap gap-1">
        {composition.components.map((comp) => {
          const style = layerChipStyle(comp.layer);
          return (
            <button
              key={comp.entity_id}
              onClick={() => onEntityClick?.(comp.entity_id)}
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[9px] font-medium transition-colors hover:ring-1 hover:ring-blue-300",
                style.bg,
                style.text,
              )}
              title={`${comp.role} (${comp.layer})`}
            >
              {comp.name}
              <span className="ml-0.5 text-[7px] opacity-60">{comp.role}</span>
            </button>
          );
        })}
      </div>

      {/* Expand for mechanism detail */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-1.5 flex items-center gap-0.5 text-[8px] text-blue-400 hover:text-blue-600 transition-colors"
      >
        <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", expanded && "rotate-180")} />
        {expanded ? "Hide mechanism" : "Show mechanism"}
      </button>
      {expanded && (
        <div className="mt-1.5 rounded-md bg-white/60 border border-blue-100 px-2.5 py-2">
          <p className="text-[9px] text-gray-600 leading-snug">
            <span className="font-semibold text-blue-600">Mechanism: </span>
            {composition.mechanism}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main Panel ──

export function CompositionsPanel({
  compositions,
  onEntityClick,
  className,
  compact = false,
}: CompositionsPanelProps) {
  const [expanded, setExpanded] = useState(!compact);

  if (compositions.length === 0) return null;

  const display = compact ? compositions.slice(0, 3) : compositions;

  return (
    <div className={className}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between group"
      >
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-blue-500" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.04em] text-gray-500 group-hover:text-gray-700">
            Emergent Compositions
          </span>
          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-600">
            {compositions.length}
          </span>
        </div>
        <ChevronDown className={cn("h-3 w-3 text-gray-300 transition-transform", expanded && "rotate-180")} />
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {display.map((c) => (
            <CompositionCard
              key={c.id}
              composition={c}
              onEntityClick={onEntityClick}
            />
          ))}
          {compact && compositions.length > 3 && (
            <p className="text-[9px] text-gray-400 text-center">
              +{compositions.length - 3} more in fullscreen view
            </p>
          )}
        </div>
      )}
    </div>
  );
}
