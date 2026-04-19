"use client";

import { useState } from "react";
import { ChevronDown, Layers, Plus, ArrowRightLeft, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PerspectiveDelta, DeltaInsight, DeltaContradiction, DeltaStrengthened } from "@/types/execution-brief";

interface PerspectiveDeltaPanelProps {
  delta: PerspectiveDelta;
}

const typeIcons: Record<DeltaInsight["type"], string> = {
  leverage: "L",
  risk: "R",
  bottleneck: "B",
  feedback_loop: "F",
  connection: "C",
  strategy: "S",
};

const typeBg: Record<DeltaInsight["type"], string> = {
  leverage: "bg-green-100 text-green-700",
  risk: "bg-red-100 text-red-700",
  bottleneck: "bg-amber-100 text-amber-700",
  feedback_loop: "bg-purple-100 text-purple-700",
  connection: "bg-blue-100 text-blue-700",
  strategy: "bg-indigo-100 text-indigo-700",
};

export function PerspectiveDeltaPanel({ delta }: PerspectiveDeltaPanelProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const deepCount = delta.insights_only_in_deep.length;
  const contradictedCount = delta.insights_contradicted.length;
  const strengthenedCount = delta.insights_strengthened.length;
  const totalChanges = deepCount + contradictedCount + strengthenedCount;

  if (totalChanges === 0) return null;

  const toggle = (section: string) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  return (
    <section className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-indigo-500" />
        <span className="text-sm font-semibold text-gray-800">
          Deep Analysis Delta
        </span>
      </div>

      {/* Summary line */}
      <p className="mt-1.5 text-[12px] text-gray-600">
        {deepCount > 0 && (
          <span>
            Found <span className="font-semibold text-indigo-600">{deepCount}</span> additional insight{deepCount !== 1 ? "s" : ""}
          </span>
        )}
        {contradictedCount > 0 && (
          <span>
            {deepCount > 0 ? ", contradicted " : "Contradicted "}
            <span className="font-semibold text-amber-600">{contradictedCount}</span>
          </span>
        )}
        {strengthenedCount > 0 && (
          <span>
            {deepCount > 0 || contradictedCount > 0 ? ", strengthened " : "Strengthened "}
            <span className="font-semibold text-green-600">{strengthenedCount}</span>
          </span>
        )}
      </p>

      {/* Collapsible sub-sections */}
      <div className="mt-3 space-y-1.5">
        {/* Only in Deep Analysis */}
        {deepCount > 0 && (
          <div>
            <button
              type="button"
              onClick={() => toggle("deep")}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-indigo-100/50 transition-colors"
            >
              <Plus className="h-3.5 w-3.5 text-indigo-500" />
              <span className="text-[11px] font-medium text-gray-700">
                Only in Deep Analysis
              </span>
              <span className="ml-auto flex items-center gap-1">
                <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">
                  {deepCount}
                </span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-gray-400 transition-transform",
                    expandedSection === "deep" && "rotate-180"
                  )}
                />
              </span>
            </button>

            {expandedSection === "deep" && (
              <div className="ml-6 mt-1 space-y-1">
                {delta.insights_only_in_deep.map((insight, idx) => (
                  <InsightRow key={idx} insight={insight} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Contradicted */}
        {contradictedCount > 0 && (
          <div>
            <button
              type="button"
              onClick={() => toggle("contradicted")}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-amber-100/50 transition-colors"
            >
              <ArrowRightLeft className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-[11px] font-medium text-gray-700">
                Contradicted
              </span>
              <span className="ml-auto flex items-center gap-1">
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
                  {contradictedCount}
                </span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-gray-400 transition-transform",
                    expandedSection === "contradicted" && "rotate-180"
                  )}
                />
              </span>
            </button>

            {expandedSection === "contradicted" && (
              <div className="ml-6 mt-1 space-y-1.5">
                {delta.insights_contradicted.map((item, idx) => (
                  <ContradictionRow key={idx} item={item} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Strengthened */}
        {strengthenedCount > 0 && (
          <div>
            <button
              type="button"
              onClick={() => toggle("strengthened")}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-green-100/50 transition-colors"
            >
              <TrendingUp className="h-3.5 w-3.5 text-green-500" />
              <span className="text-[11px] font-medium text-gray-700">
                Strengthened
              </span>
              <span className="ml-auto flex items-center gap-1">
                <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-600">
                  {strengthenedCount}
                </span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-gray-400 transition-transform",
                    expandedSection === "strengthened" && "rotate-180"
                  )}
                />
              </span>
            </button>

            {expandedSection === "strengthened" && (
              <div className="ml-6 mt-1 space-y-1">
                {delta.insights_strengthened.map((item, idx) => (
                  <StrengthenedRow key={idx} item={item} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function InsightRow({ insight }: { insight: DeltaInsight }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-white/60 px-2.5 py-1.5 border border-gray-100">
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[9px] font-bold",
          typeBg[insight.type]
        )}
      >
        {typeIcons[insight.type]}
      </span>
      <div className="min-w-0">
        {insight.entity_name && (
          <span className="text-[11px] font-semibold text-gray-700">
            {insight.entity_name}
          </span>
        )}
        <p className="text-[11px] leading-snug text-gray-600 line-clamp-2">
          {insight.summary}
        </p>
      </div>
    </div>
  );
}

function ContradictionRow({ item }: { item: DeltaContradiction }) {
  return (
    <div className="rounded-lg bg-white/60 px-2.5 py-2 border border-amber-100 space-y-1">
      {item.entity_name && (
        <span className="text-[11px] font-semibold text-gray-700">
          {item.entity_name}
        </span>
      )}
      <div className="flex items-start gap-1.5 text-[10px]">
        <span className="shrink-0 rounded bg-gray-100 px-1 py-0.5 font-medium text-gray-500">
          Quick
        </span>
        <span className="text-gray-600 line-clamp-2">{item.quick_claim}</span>
      </div>
      <div className="flex items-start gap-1.5 text-[10px]">
        <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 font-medium text-amber-600">
          Deep
        </span>
        <span className="text-gray-700 line-clamp-2">{item.deep_claim}</span>
      </div>
      <p className="text-[10px] italic text-gray-500">{item.resolution}</p>
    </div>
  );
}

function StrengthenedRow({ item }: { item: DeltaStrengthened }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white/60 px-2.5 py-1.5 border border-green-100">
      <div className="min-w-0 flex-1">
        {item.entity_name && (
          <span className="text-[11px] font-semibold text-gray-700">
            {item.entity_name}
          </span>
        )}
        <p className="text-[10px] text-gray-500">
          {item.additional_evidence}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-500">
          {item.quick_confidence}
        </span>
        <span className="text-[10px] text-gray-400">&rarr;</span>
        <span className={cn(
          "rounded-full px-1.5 py-0.5 text-[9px] font-medium",
          item.deep_confidence === "high" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
        )}>
          {item.deep_confidence}
        </span>
      </div>
    </div>
  );
}
