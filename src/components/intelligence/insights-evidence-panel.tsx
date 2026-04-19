"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import type { Entity } from "@/types";
import type { CrossContextInsight, HiddenSignalData } from "@/types/synthesis";
import type {
  PriorityDecisionV2,
  ContradictionItem,
} from "@/types/intelligence-v2";
import type { SourceCredibility } from "@/types/intelligence";
import { cleanEntityName } from "./orbital-graph";

interface InsightsEvidencePanelProps {
  crossContextInsights: CrossContextInsight[];
  hiddenSignals: HiddenSignalData[];
  priorityDecisions: PriorityDecisionV2[];
  contradictions: ContradictionItem[];
  entities: Entity[];
  credibilityMap: Map<string, SourceCredibility>;
  onEntityClick: (entityId: string) => void;
  onDecisionExecute?: (decision: PriorityDecisionV2) => void;
  onDecisionCreateGoal?: (decision: PriorityDecisionV2) => void;
}

type InsightType = "FINDING" | "HYPOTHESIS" | "CONTRADICTION";

interface UnifiedInsight {
  id: string;
  type: InsightType;
  text: string;
  strength: number; // 1-4
  entityIds: string[];
  isPriority: boolean;
}

const TYPE_CONFIG: Record<InsightType, { label: string; bg: string; text: string; border: string }> = {
  FINDING:       { label: "FINDING",       bg: "bg-green-50",  text: "text-green-700",  border: "border-green-200" },
  HYPOTHESIS:    { label: "HYPOTHESIS",    bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-200" },
  CONTRADICTION: { label: "CONTRADICTION", bg: "bg-red-50",    text: "text-red-700",    border: "border-red-200" },
};

function confidenceToStrength(confidence: "high" | "moderate" | "low"): number {
  return confidence === "high" ? 4 : confidence === "moderate" ? 3 : 1;
}

export function InsightsEvidencePanel({
  crossContextInsights,
  hiddenSignals,
  priorityDecisions,
  contradictions,
  entities,
  credibilityMap,
  onEntityClick,
}: InsightsEvidencePanelProps) {
  const [showAll, setShowAll] = useState(false);

  const entityLookup = useMemo(() => {
    const m = new Map<string, Entity>();
    for (const e of entities) {
      m.set(e.entity_id, e);
      m.set(e.id, e);
    }
    return m;
  }, [entities]);

  // ── Unify all insight types into one list ──

  const allInsights: UnifiedInsight[] = useMemo(() => {
    const items: UnifiedInsight[] = [];

    // Cross-context insights → FINDING
    for (const cci of crossContextInsights) {
      items.push({
        id: `cci_${items.length}`,
        type: "FINDING",
        text: cci.insight,
        strength: confidenceToStrength(cci.confidence),
        entityIds: [...(cci.internal_entities ?? []), ...(cci.external_entities ?? [])],
        isPriority: cci.confidence === "high",
      });
    }

    // High-impact hidden signals → HYPOTHESIS
    for (const hs of hiddenSignals) {
      if ((hs.trajectory_impact ?? 0) >= 7) {
        items.push({
          id: `hs_${items.length}`,
          type: "HYPOTHESIS",
          text: `${hs.signal_name}: ${hs.description}`,
          strength: Math.min(4, Math.ceil((hs.trajectory_impact ?? 5) / 2.5)),
          entityIds: [],
          isPriority: (hs.trajectory_impact ?? 0) >= 8,
        });
      }
    }

    // Contradictions → CONTRADICTION
    for (const c of contradictions) {
      items.push({
        id: c.id,
        type: "CONTRADICTION",
        text: `${c.a} vs ${c.b}: ${c.why_it_matters}`,
        strength: c.confidence != null ? Math.ceil(c.confidence * 4) : 2,
        entityIds: [],
        isPriority: true,
      });
    }

    // Top priority decision → FINDING (promoted)
    if (priorityDecisions.length > 0) {
      const top = priorityDecisions[0];
      items.unshift({
        id: top.id,
        type: "FINDING",
        text: `Decision: ${top.decision_question} → ${top.recommended_reason}`,
        strength: 4,
        entityIds: top.affected_entities,
        isPriority: true,
      });
    }

    // Sort: priority first, then by strength
    return items.sort((a, b) => {
      if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
      return b.strength - a.strength;
    });
  }, [crossContextInsights, hiddenSignals, contradictions, priorityDecisions]);

  const displayInsights = showAll ? allInsights : allInsights.slice(0, 6);
  const totalCount = allInsights.length;
  const highImpactCount = allInsights.filter((i) => i.strength >= 3).length;
  const contradictionCount = allInsights.filter((i) => i.type === "CONTRADICTION").length;

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="text-[13px] font-semibold text-gray-700">What the evidence adds up to</h4>
          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-gray-400">
            <span>{totalCount} insights</span>
            <span>{highImpactCount} high-impact</span>
            {contradictionCount > 0 && (
              <span className="text-red-400">{contradictionCount} contradictions</span>
            )}
          </div>
        </div>
        {allInsights.length > 6 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-[10px] text-interaxis-600 font-medium hover:text-interaxis-700 transition-colors"
          >
            {showAll ? "Show less" : "View all"}
          </button>
        )}
      </div>

      {/* Insight cards */}
      <div className="space-y-2">
        {displayInsights.map((insight) => {
          const cfg = TYPE_CONFIG[insight.type];
          return (
            <div
              key={insight.id}
              className={cn(
                "rounded-lg border px-3 py-2.5",
                insight.isPriority ? "border-l-2 border-l-blue-400 border-gray-100" : "border-gray-100"
              )}
            >
              {/* Type badge + strength */}
              <div className="flex items-center gap-2 mb-1">
                <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-bold", cfg.bg, cfg.text)}>
                  {cfg.label}
                </span>
                {/* Strength bars */}
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4].map((level) => (
                    <div
                      key={level}
                      className={cn(
                        "w-3 h-1.5 rounded-sm",
                        level <= insight.strength ? "bg-gray-500" : "bg-gray-200"
                      )}
                    />
                  ))}
                </div>
              </div>

              {/* Text */}
              <p className="text-[11px] text-gray-700 leading-relaxed">{insight.text}</p>

              {/* Evidence trail — entity chips */}
              {insight.entityIds.length > 0 && (
                <div className="flex items-center gap-1 mt-2 flex-wrap">
                  <span className="text-[9px] text-gray-400">Backed by</span>
                  {insight.entityIds.slice(0, 5).map((eid) => {
                    const e = entityLookup.get(eid);
                    const cred = credibilityMap.get(eid);
                    return (
                      <button
                        key={eid}
                        onClick={() => onEntityClick(eid)}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-[9px] text-gray-600 transition-colors"
                      >
                        {e ? cleanEntityName(e) : eid.slice(0, 8)}
                        {cred && (
                          <span className="text-[8px] text-gray-400">{cred.effective_confidence.toFixed(1)}</span>
                        )}
                      </button>
                    );
                  })}
                  {insight.entityIds.length > 5 && (
                    <span className="text-[9px] text-gray-400">+{insight.entityIds.length - 5}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {allInsights.length === 0 && (
        <div className="text-center py-6">
          <p className="text-[12px] text-gray-400">No synthesized insights yet.</p>
          <p className="text-[10px] text-gray-300 mt-1">Run synthesis to generate cross-context insights.</p>
        </div>
      )}
    </div>
  );
}
