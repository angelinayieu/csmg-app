"use client";

import { useSpaceData } from "@/contexts/space-data-context";
import { SynthesisModules } from "@/components/dashboard/modules/synthesis-modules";

export default function LeveragePage() {
  const ctx = useSpaceData();

  if (!ctx.hasSynthesis) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        Run synthesis to view leverage points
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
        strategyOnly
        sectionFilter="leverage"
      />
    </div>
  );
}
