"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Zap, BookOpen } from "lucide-react";
import type { CoreTension, IntelligenceNarrative } from "@/types/intelligence-v2";

export interface IntelligenceBriefCardProps {
  coreTension?: CoreTension;
  narrative?: IntelligenceNarrative;
  entityNames?: Map<string, string>;
  signalCount?: number;
  onEntityClick?: (entityId: string) => void;
  className?: string;
}

export function IntelligenceBriefCard({
  coreTension,
  narrative,
  entityNames,
  signalCount,
  onEntityClick,
  className,
}: IntelligenceBriefCardProps) {
  if (!coreTension && !narrative) return null;

  // Resolve entity IDs to names for tags
  const tensionTags = (coreTension?.entity_ids ?? [])
    .map((id) => entityNames?.get(id) ?? id)
    .filter(Boolean);

  return (
    <div
      className={cn(
        "rounded-2xl border border-gray-200/60 bg-white p-5 shadow-sm",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-gray-900">
            Intelligence brief
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {narrative
              ? `Synthesized from ${signalCount ?? "multiple"} signals`
              : "Core strategic tension"}
          </p>
        </div>
      </div>

      {/* Key tension highlight */}
      {coreTension && (
        <div className="mb-3.5 rounded-r-xl rounded-l border-l-[3px] border-blue-500 bg-blue-50/40 px-3.5 py-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Zap className="h-3 w-3 text-blue-600" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.8px] text-blue-600">
              Key Tension
            </span>
          </div>
          <p className="text-[13px] font-medium text-gray-900 leading-snug">
            {coreTension.title}
          </p>
          {coreTension.description && (
            <p className="mt-1 text-xs text-gray-600 leading-relaxed">
              {coreTension.description}
            </p>
          )}
        </div>
      )}

      {/* Narrative text */}
      {narrative?.executive_summary && (
        <p className="text-[13px] leading-relaxed text-gray-600">
          {narrative.executive_summary}
        </p>
      )}

      {/* Change summary */}
      {narrative?.change_summary && (
        <p className="mt-2 text-xs italic text-gray-500">
          <span className="font-medium not-italic">What changed: </span>
          {narrative.change_summary}
        </p>
      )}

      {/* Tags */}
      {tensionTags.length > 0 && (
        <div className="mt-3.5 flex flex-wrap gap-1.5 border-t border-gray-100 pt-3.5">
          {tensionTags.map((tag) => (
            <button
              key={tag}
              onClick={() => {
                const id = coreTension?.entity_ids.find(
                  (eid) => (entityNames?.get(eid) ?? eid) === tag
                );
                if (id && onEntityClick) onEntityClick(id);
              }}
              className="rounded-md bg-gray-100/80 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-200/80 transition-colors"
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
