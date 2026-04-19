"use client";

import { useSpaceData } from "@/contexts/space-data-context";
import { SynthesisModules } from "@/components/dashboard/modules/synthesis-modules";

export default function InsightsPage() {
  const ctx = useSpaceData();

  if (!ctx.hasSynthesis) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        Run synthesis to unlock insights
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <SynthesisModules
        space={ctx.space}
        entities={ctx.entities}
        cycles={ctx.cycles}
        novelConnections={ctx.novelConnections}
        contradictions={ctx.contradictions}
        scenarios={ctx.scenarios}
        actionItems={ctx.actionItems}
        propositions={ctx.propositions}
        bridges={ctx.bridges}
        domainMap={ctx.domainMap}
        insightsOnly
        onToggleActionDone={(actionId, done) => {
          fetch(`/api/action-items/${actionId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: done ? "completed" : "pending" }),
          }).catch(() => {});
        }}
      />
    </div>
  );
}
