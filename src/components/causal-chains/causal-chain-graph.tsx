"use client";

// ── Causal chain DAG ───────────────────────────────────────────────────
//
// Reactflow-powered visualization of the synthesis_data.causal_chains
// payload. Each chain is a row of 5 stages (concept → research →
// deliverable → application → outcome); all chains converge on a single
// shared "goal" node on the right. Click any stage to open its trace.
//
// Why a DAG instead of the legacy list: causal chains ARE directed
// graphs. The list view forced the reader to imagine the fan-in to the
// goal node from N parallel streams. The DAG shows it.

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type NodeTypes,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { CausalChain } from "@/types/causal-chains";
import type { ImprovementGoal } from "@/types/goals";
import { StageNode } from "./stage-node";
import {
  causalChainsToFlow,
  flowBounds,
  type StageNodeData,
} from "@/lib/causal-chains/to-reactflow-shape";

const nodeTypes: NodeTypes = {
  stage: StageNode,
  // The terminal goal uses the same node component — differentiated by
  // `data.isTerminal`. Keeps styling in one place.
  goal: StageNode,
};

interface Props {
  spaceId: string;
  chains: CausalChain[];
  goal: ImprovementGoal | null;
  /** Optional fixed height; defaults to auto-sized from the layout bounds. */
  height?: number;
}

export function CausalChainGraph({ spaceId, chains, goal, height }: Props) {
  return (
    <ReactFlowProvider>
      <CausalChainGraphInner
        spaceId={spaceId}
        chains={chains}
        goal={goal}
        height={height}
      />
    </ReactFlowProvider>
  );
}

function CausalChainGraphInner({ spaceId, chains, goal, height }: Props) {
  const router = useRouter();

  // Build the flow lazily — inputs are already sorted by the caller.
  const { nodes, edges, containerHeight } = useMemo(() => {
    const goalInput = goal
      ? { id: goal.id, title: goal.title }
      : { id: "synth-goal", title: "Master objective" };
    const flow = causalChainsToFlow(chains, goalInput);
    const b = flowBounds(flow);
    // Minimum 240px so the empty / sparse cases don't collapse the card.
    const h = height ?? Math.max(240, Math.min(720, b.height + 80));
    return {
      // StageNodeData doesn't overlap with reactflow's stricter Record shape
      // constraint. The underlying object IS usable — flow handlers cast it
      // back to StageNodeData — so the unknown bounce is safe.
      nodes: flow.nodes as unknown as Node[],
      edges: flow.edges as Edge[],
      containerHeight: h,
    };
  }, [chains, goal, height]);

  // Stage click → trace page, matching the legacy list view's behavior.
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const d = node.data as unknown as StageNodeData;
      if (d.isTerminal) return;
      const qs = d.stageIndex != null ? `?step=${d.stageIndex}` : "";
      router.push(`/app/space/${spaceId}/trace/${d.chainId}${qs}`);
    },
    [router, spaceId],
  );

  return (
    <div
      className="relative w-full rounded-lg overflow-hidden ring-1 ring-black/5 bg-gradient-to-br from-white/80 to-indigo-50/30"
      style={{ height: containerHeight }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.2, minZoom: 0.3 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        defaultEdgeOptions={{
          type: "smoothstep",
          style: { stroke: "#A5B4FC", strokeWidth: 1.5 },
        }}
        panOnDrag
        zoomOnScroll={false}
        zoomOnPinch
        minZoom={0.2}
        maxZoom={1.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#E5E7EB" />
        <Controls
          position="bottom-right"
          showInteractive={false}
          className="!bg-white/80 !ring-1 !ring-black/5 !rounded-lg !shadow-sm"
        />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          nodeStrokeWidth={2}
          maskColor="rgba(99, 102, 241, 0.08)"
          className="!bg-white/80 !ring-1 !ring-black/5 !rounded-lg !shadow-sm"
        />
      </ReactFlow>
    </div>
  );
}
