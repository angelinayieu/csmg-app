"use client";

import { useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tier3Evidence } from "@/components/strategy/tier-3-evidence";
import { Tier2ExecutionPlan } from "@/components/strategy/tier-2-execution-plan";
import type { StrategicRecommendation } from "@/types/strategy";
import type { SynthesisData } from "@/types/synthesis";
import type { Entity, Cycle, Scenario } from "@/types";
import type { ImprovementGoal, GoalRecommendation, SuggestedObjective } from "@/types/goals";

interface EvidenceStripProps {
  recommendation: StrategicRecommendation;
  entityMap: Map<string, Entity>;
  synthData: SynthesisData | null;
  entities: Entity[];
  cycles: Cycle[];
  scenarios: Scenario[];
  spaceId: string;
  suggestedObjectives?: SuggestedObjective[];
  activeGoal?: ImprovementGoal | null;
  goalRecommendations?: GoalRecommendation[];
  onRecordOutcome?: (
    recId: string,
    goalId: string,
    outcome: "effective" | "partial" | "ineffective",
    notes: string,
  ) => Promise<{ refinement_signals?: Array<{ entity_id: string; recommendation: string; reason: string }> } | null>;
}

export function EvidenceStrip({
  recommendation,
  entityMap,
  synthData,
  entities,
  cycles,
  scenarios,
  spaceId,
  suggestedObjectives,
  activeGoal,
  goalRecommendations,
  onRecordOutcome,
}: EvidenceStripProps) {
  const [expanded, setExpanded] = useState<"none" | "execution" | "evidence">("none");

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-2.5 mb-2.5 px-0.5">
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
          style={{
            background: "rgba(255,255,255,0.7)",
            backdropFilter: "blur(14px) saturate(160%)",
            WebkitBackdropFilter: "blur(14px) saturate(160%)",
            border: "1px solid rgba(11,13,18,0.14)",
            fontSize: 11,
            fontWeight: 700,
            color: "#0B0D12",
            letterSpacing: "-0.005em",
            boxShadow:
              "0 1px 0 rgba(255,255,255,0.8) inset, 0 2px 6px rgba(11,13,18,0.04)",
          }}
        >
          <FileText className="w-2.5 h-2.5" style={{ color: "rgba(11,13,18,0.48)" }} />
          Evidence &amp; deep dive
        </span>
        <span
          style={{
            fontSize: 11,
            color: "rgba(11,13,18,0.48)",
            fontWeight: 500,
          }}
        >
          pre-mortem · goal outcomes · execution brief · micro-tactics grid
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {/* Execution accordion */}
        <AccordionPanel
          title="Execution Plan"
          subtitle={`${(recommendation.micro_tactics ?? []).length} micro-tactics · temporal phases · infrastructure proposals`}
          open={expanded === "execution"}
          onToggle={() =>
            setExpanded((v) => (v === "execution" ? "none" : "execution"))
          }
        >
          <Tier2ExecutionPlan
            recommendation={recommendation}
            entityMap={entityMap}
            spaceId={spaceId}
            synthData={synthData}
          />
        </AccordionPanel>

        {/* Evidence accordion */}
        <AccordionPanel
          title="Evidence & Grounding"
          subtitle="BSC perspectives expanded · pre-mortem · goal outcomes · synthesis grounding"
          open={expanded === "evidence"}
          onToggle={() =>
            setExpanded((v) => (v === "evidence" ? "none" : "evidence"))
          }
        >
          <Tier3Evidence
            recommendation={recommendation}
            entityMap={entityMap}
            synthData={synthData}
            entities={entities}
            cycles={cycles}
            scenarios={scenarios}
            suggestedObjectives={suggestedObjectives}
            activeGoal={activeGoal}
            goalRecommendations={goalRecommendations}
            onRecordOutcome={onRecordOutcome}
          />
        </AccordionPanel>
      </div>
    </div>
  );
}

function AccordionPanel({
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-[12px] overflow-hidden"
      style={{
        background: "rgba(255, 255, 255, 0.72)",
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
        border: "1px solid rgba(11,13,18,0.14)",
      }}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/30 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div
            className="font-bold"
            style={{
              fontSize: 12.5,
              color: "#0B0D12",
              letterSpacing: "-0.005em",
            }}
          >
            {title}
          </div>
          <div
            className="truncate"
            style={{
              fontSize: 11,
              color: "rgba(11,13,18,0.48)",
              fontWeight: 500,
              marginTop: 1,
            }}
          >
            {subtitle}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div
          className="p-4"
          style={{
            borderTop: "1px solid rgba(11,13,18,0.08)",
            background: "rgba(255,255,255,0.4)",
          }}
        >
          <div
            className="glass-card p-4 rounded-[10px]"
            style={{
              background: "#fff",
              border: "1px solid rgba(11,13,18,0.08)",
            }}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
