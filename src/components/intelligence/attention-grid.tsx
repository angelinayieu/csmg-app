"use client";

import React, { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { AlertCircle, ChevronDown } from "lucide-react";
import { AttentionCard, type AttentionItemType } from "./attention-card";
import type { PriorityDecisionV2, ContradictionItem, IntelligenceNarrative } from "@/types/intelligence-v2";

export interface AttentionGridProps {
  v2Decisions: PriorityDecisionV2[];
  contradictions: ContradictionItem[];
  attentionItems: IntelligenceNarrative["attention_items"];
  onExecuteDecision?: (decision: PriorityDecisionV2) => void;
  onCreateGoal?: (decision: PriorityDecisionV2) => void;
  onEntityClick?: (entityId: string) => void;
  className?: string;
}

interface MergedAttentionItem {
  id: string;
  type: AttentionItemType;
  impact: "high" | "medium" | "low";
  title: string;
  description: string;
  tags: string[];
  confidence?: number;
  sourceCount?: number;
  sortPriority: number;
  onOpen?: () => void;
}

export function AttentionGrid({
  v2Decisions,
  contradictions,
  attentionItems,
  onExecuteDecision,
  onEntityClick,
  className,
}: AttentionGridProps) {
  const [showAll, setShowAll] = useState(false);

  const items: MergedAttentionItem[] = useMemo(() => {
    const result: MergedAttentionItem[] = [];
    const seenTitles = new Set<string>();

    // V2 decisions → attention cards
    for (const d of v2Decisions) {
      const impact: "high" | "medium" | "low" =
        d.due_window === "now" ? "high" : d.due_window === "this_week" ? "medium" : "low";
      const sortPriority = d.due_window === "now" ? 0 : d.due_window === "this_week" ? 2 : 4;
      result.push({
        id: `decision_${d.id}`,
        type: "decision",
        impact,
        title: d.decision_question,
        description: d.recommended_reason,
        tags: [d.entity_name, d.evidence_level].filter(Boolean),
        confidence: d.confidence,
        sourceCount: d.evidence_refs.length,
        sortPriority,
        onOpen: onExecuteDecision ? () => onExecuteDecision(d) : undefined,
      });
      seenTitles.add(d.decision_question.toLowerCase());
    }

    // Contradictions → attention cards
    for (const c of contradictions) {
      const impact: "high" | "medium" | "low" =
        (c.confidence ?? 0) >= 0.7 ? "high" : (c.confidence ?? 0) >= 0.4 ? "medium" : "low";
      result.push({
        id: `contradiction_${c.id}`,
        type: "contradiction",
        impact,
        title: `${c.a} vs ${c.b}`,
        description: c.why_it_matters,
        tags: c.resolution_paths.slice(0, 2),
        confidence: c.confidence,
        sortPriority: 1,
      });
      seenTitles.add(`${c.a} vs ${c.b}`.toLowerCase());
    }

    // Narrative attention items not already covered
    for (const item of attentionItems ?? []) {
      if (seenTitles.has(item.title.toLowerCase())) continue;
      result.push({
        id: `attention_${item.title}`,
        type: item.source as AttentionItemType,
        impact: "high",
        title: item.title,
        description: item.reason,
        tags: [],
        sortPriority: 1.5,
        onOpen: item.entity_ids[0] && onEntityClick
          ? () => onEntityClick(item.entity_ids[0])
          : undefined,
      });
    }

    // Sort by priority
    result.sort((a, b) => a.sortPriority - b.sortPriority);
    return result;
  }, [v2Decisions, contradictions, attentionItems, onExecuteDecision, onEntityClick]);

  if (items.length === 0) return null;

  const displayed = showAll ? items : items.slice(0, 3);

  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-semibold uppercase tracking-[0.5px] text-gray-500">
            Requires Attention
          </span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
            {items.length}
          </span>
        </div>
        {items.length > 3 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="flex items-center gap-1 text-[13px] font-medium text-blue-600 hover:text-blue-700"
          >
            {showAll ? "Show less" : "View all"}
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                showAll && "rotate-180"
              )}
            />
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {displayed.map((item) => (
          <AttentionCard
            key={item.id}
            type={item.type}
            impact={item.impact}
            title={item.title}
            description={item.description}
            tags={item.tags}
            confidence={item.confidence}
            sourceCount={item.sourceCount}
            onOpen={item.onOpen}
          />
        ))}
      </div>
    </div>
  );
}
