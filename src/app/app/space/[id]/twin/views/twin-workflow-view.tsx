"use client";

// ── Workflow view ──────────────────────────────────────────────────
//
// Thin wrapper that hands the lazy-loaded workflow data to the
// existing DigitalTwinFlowchart module. Adapts the API payload shape
// to the component's prop signature.
//
// The flowchart is the most expensive child on this page — keeping
// it isolated under a single view means switching to layers /
// mechanisms doesn't re-render the workflow tree.

import { DigitalTwinFlowchart } from "@/components/dashboard/modules/digital-twin-flowchart";
import type { TwinWorkflowData } from "@/app/api/spaces/[id]/twin-workflow-data/route";

interface Props {
  workflowData: TwinWorkflowData;
  onEntityClick?: (entityId: string) => void;
}

export function TwinWorkflowView({ workflowData, onEntityClick }: Props) {
  return (
    <DigitalTwinFlowchart
      entities={workflowData.entities}
      edges={workflowData.edges}
      cycles={workflowData.cycles}
      synthesisData={workflowData.synthesis_data}
      activeGoal={workflowData.active_goal}
      proposedSpec={workflowData.proposed_spec}
      currentTwinState={workflowData.current_twin_state}
      space={{ maturity: workflowData.space_maturity }}
      onEntityClick={onEntityClick ? (e) => onEntityClick(e.id) : undefined}
    />
  );
}
