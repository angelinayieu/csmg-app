"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Ring } from "@/components/ui/ring";
import { CalloutBox } from "@/components/ui/callout-box";
import { IntensityDot } from "@/components/ui/intensity-dot";
import type { RichLeveragePoint } from "@/types/synthesis";
import type { Entity } from "@/types";

interface LeverageCardProps {
  point: RichLeveragePoint;
  entity: Entity | undefined;
  rank: number;
  delay?: number;
}

export function LeverageCard({ point, entity, rank, delay = 0 }: LeverageCardProps) {
  const [expanded, setExpanded] = useState(false);
  const confidence = entity?.confidence ?? 0.8;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border transition-all duration-300",
        expanded
          ? "border-blue-200 bg-blue-50/30"
          : "border-gray-200 bg-gray-50/60"
      )}
      style={{
        animationDelay: `${delay}ms`,
      }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-5 py-3.5 text-left"
      >
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold transition-colors duration-200",
            expanded
              ? "bg-blue-500 text-white"
              : "bg-gray-200 text-gray-500"
          )}
        >
          {rank}
        </span>
        <span className="text-[11px] font-semibold tracking-wide text-gray-400">
          {point.entity_id}
        </span>
        <span className="flex-1 truncate text-sm font-semibold text-gray-800">
          {entity?.name ?? point.entity_id}
        </span>
        <Ring value={confidence} size={38} showValue />
        <ChevronDown
          className={cn(
            "h-4 w-4 text-gray-400 transition-transform duration-200",
            expanded && "rotate-180"
          )}
        />
      </button>

      {/* Expanded content */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-[350ms]",
          expanded ? "max-h-[3000px] opacity-100" : "max-h-0 opacity-0"
        )}
        style={{ transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
      >
        <div
          className="space-y-3 px-5 pb-5 pt-1"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Summary */}
          {point.summary && (
            <p className="text-[13.5px] leading-relaxed text-gray-600">
              {point.summary}
            </p>
          )}

          {/* Reasoning */}
          {point.reasoning?.length > 0 && (
            <CalloutBox type="insight" label="Why this has outsized impact">
              {point.reasoning.map((r, i) => (
                <p key={i} className={i < point.reasoning.length - 1 ? "mb-2" : ""}>
                  {r}
                </p>
              ))}
            </CalloutBox>
          )}

          {/* Mechanisms */}
          {point.how_it_works?.length > 0 && (
            <CalloutBox type="mechanism" label="How this actually works">
              {point.how_it_works.map((h, i) => (
                <p key={i} className={i < point.how_it_works.length - 1 ? "mb-1" : ""}>
                  <span className="font-medium">{i + 1}.</span> {h}
                </p>
              ))}
            </CalloutBox>
          )}

          {/* Primary action */}
          {point.action?.primary && (
            <CalloutBox type="action" label="Recommended approach">
              {point.action.primary}
            </CalloutBox>
          )}

          {/* Alternatives */}
          {point.action?.alternatives?.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-semibold text-gray-500">
                Alternative approaches
              </div>
              <div className="space-y-1.5">
                {point.action.alternatives.map((alt, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-gray-200 bg-white p-3"
                  >
                    <div className="text-xs font-medium text-gray-800">
                      {alt.when}
                    </div>
                    <div className="mt-1 text-xs leading-relaxed text-gray-600">
                      {alt.approach}
                    </div>
                    <div className="mt-1.5 text-[11px] text-amber-600">
                      Tradeoff: {alt.tradeoff}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* When this matters */}
          {point.when_matters?.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-semibold text-gray-500">
                When this matters most
              </div>
              <div className="space-y-1">
                {point.when_matters.map((w, i) => (
                  <div
                    key={i}
                    className="flex gap-2 rounded-lg bg-gray-50 px-3 py-2"
                  >
                    <IntensityDot level={w.intensity} />
                    <div>
                      <div className="text-xs font-medium text-gray-800">
                        {w.situation}
                      </div>
                      <div className="mt-0.5 text-xs leading-snug text-gray-500">
                        {w.impact}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Connections */}
          {point.connections?.length > 0 && (
            <CalloutBox type="insight" label="How this connects to other areas">
              {point.connections.map((c, i) => (
                <p key={i} className={i < point.connections.length - 1 ? "mb-1" : ""}>
                  {c}
                </p>
              ))}
            </CalloutBox>
          )}
        </div>
      </div>
    </div>
  );
}
