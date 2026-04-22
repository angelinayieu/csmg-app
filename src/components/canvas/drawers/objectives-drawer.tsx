"use client";

// ── Objectives drawer ──
// Absorbs the deleted /objectives route. Single "tree" tab renders the
// proposed + decomposition sections.

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Target } from "lucide-react";
import { CanvasDrawer, type DrawerTab } from "./canvas-drawer";
import ObjectivesDecompositionShell from "@/components/objectives/objectives-decomposition-shell";
import { ProposedObjectivesSection } from "@/components/objectives/proposed-objectives-section";
import { useSpaceData } from "@/contexts/space-data-context";
import type { SynthesisData } from "@/types/synthesis";
import type { SuggestedObjective } from "@/types/goals";

const TABS: DrawerTab[] = [
  { id: "tree", label: "Tree", icon: <Target className="h-3 w-3" /> },
];

export interface ObjectivesDrawerProps {
  open: boolean;
  onClose: () => void;
  activeTab: string | null;
  onTabChange: (tabId: string) => void;
}

export function ObjectivesDrawer({
  open,
  onClose,
  activeTab,
  onTabChange,
}: ObjectivesDrawerProps) {
  return (
    <CanvasDrawer
      open={open}
      onClose={onClose}
      title="Objectives"
      subtitle="Goals · decomposition"
      tabs={TABS}
      activeTab={activeTab ?? "tree"}
      onTabChange={onTabChange}
      widthPx={680}
    >
      {open ? <ObjectivesDrawerBody /> : null}
    </CanvasDrawer>
  );
}

function ObjectivesDrawerBody() {
  const ctx = useSpaceData();
  const router = useRouter();

  const parsedSynthData = useMemo<SynthesisData | null>(() => {
    if (!ctx.space.synthesis_data) return null;
    try {
      return (typeof ctx.space.synthesis_data === "string"
        ? JSON.parse(ctx.space.synthesis_data)
        : ctx.space.synthesis_data) as SynthesisData;
    } catch {
      return null;
    }
  }, [ctx.space.synthesis_data]);

  const suggestedObjectives = useMemo<SuggestedObjective[]>(() => {
    if (!parsedSynthData) return [];
    return (
      ((parsedSynthData as unknown as { suggested_objectives?: SuggestedObjective[] })
        .suggested_objectives) ?? []
    );
  }, [parsedSynthData]);

  const handleAddSubGoal = useCallback(
    (parentGoalId: string) => {
      const prefill: SuggestedObjective = {
        key: `manual-sub-${parentGoalId}-${Date.now()}`,
        title: "",
        description: "",
        objective_type: "maximize",
        source_type: "worth_considering",
        metric_name: "",
        metric_unit: null,
        baseline_estimate: null,
        target_estimate: null,
        source_entity_id: null,
        rationale: "",
        confidence: "moderate",
        priority: 3,
        parent_goal_id: parentGoalId,
      };
      ctx.setGoalPrefill(prefill);
      ctx.setShowGoalSetter(true);
    },
    [ctx],
  );

  const handleAcceptObjective = async (obj: SuggestedObjective) => {
    try {
      let desc = obj.description;
      if (obj.rationale) desc += `\n\nRationale: ${obj.rationale}`;
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          space_id: ctx.space.id,
          title: obj.title,
          description: desc,
          metric_name: obj.metric_name,
          metric_unit: obj.metric_unit ?? null,
          target_value: obj.target_estimate ?? 100,
          baseline_value: obj.baseline_estimate ?? 0,
          objective_type: obj.objective_type ?? "maximize",
          source: "auto_detected",
          parent_goal_id: obj.parent_goal_id ?? null,
          benchmark: obj.benchmark ?? null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        ctx.setGoalList((prev) => [data.goal, ...prev]);
        ctx.setActiveGoal(data.goal);
        ctx.refresh();
      }
    } catch (err) {
      console.error("Failed to create goal:", err);
    }
  };

  if (!ctx.hasSynthesis) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-gray-400">
        Run synthesis to detect objectives.
      </div>
    );
  }

  return (
    <div className="p-4">
      <ProposedObjectivesSection
        spaceId={ctx.space.id}
        onResolved={() => ctx.refresh()}
      />
      <ObjectivesDecompositionShell
        primaryGoal={ctx.activeGoal}
        allGoals={ctx.goalList}
        suggestedObjectives={suggestedObjectives}
        onAccept={handleAcceptObjective}
        onAddSubGoal={handleAddSubGoal}
        onDecompose={async (goalId) => {
          await fetch(`/api/goals/${goalId}/sub-objectives`, { method: "POST" });
          ctx.refresh();
        }}
        onCreateSubSpace={async (goalId) => {
          const res = await fetch(`/api/goals/${goalId}/sub-space`, {
            method: "POST",
          });
          if (res.ok) {
            const data = await res.json();
            router.push(`/app/space/${data.spaceId}`);
          }
        }}
        onNavigateToSpace={(spaceId) => router.push(`/app/space/${spaceId}`)}
        onGoalClick={ctx.setActiveGoal}
        variant="full"
        initiallyExpanded
      />
    </div>
  );
}
