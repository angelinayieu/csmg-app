"use client";

import { useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSpaceData } from "@/contexts/space-data-context";
import ObjectivesDecompositionShell from "@/components/objectives/objectives-decomposition-shell";
import type { SynthesisData } from "@/types/synthesis";
import type { SuggestedObjective } from "@/types/goals";

export default function ObjectivesPage() {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (parsedSynthData as any).suggested_objectives ?? [];
  }, [parsedSynthData]);

  if (!ctx.hasSynthesis) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        Run synthesis to detect objectives
      </div>
    );
  }

  // Manual sub-goal creation: opens the GoalSetter modal with an empty
  // prefill whose parent_goal_id is set to the clicked goal. GoalSetter
  // already handles this (it shows "Track Sub-Objective" as the title).
  //
  // The prefill shape matches SuggestedObjective. Fields left empty
  // (title/description/metric_name) prompt the user to fill them in;
  // parent_goal_id is the only thing we pin.
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
    [ctx]
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

  return (
    <div className="h-full overflow-y-auto p-4">
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
          const res = await fetch(`/api/goals/${goalId}/sub-space`, { method: "POST" });
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
