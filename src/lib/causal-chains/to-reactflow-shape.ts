// ── Causal chain → reactflow adapter ───────────────────────────────────
//
// Pure data transform: `CausalChain[]` → `{ nodes, edges }` laid out as a
// left-to-right flow with multiple chains stacked vertically and all
// converging on a shared terminal "goal" node on the right.
//
// Why a shared terminal: every chain's stage[5] is the same master
// objective (`primary_goal_id` is identical across chains). Rendering
// six separate goal nodes would fragment the convergence; one shared
// node makes the "N chains all serve this goal" story legible at a glance.

import type { CausalChain, CausalStageKind } from "@/types/causal-chains";

export interface StageNodeData {
  /** Which of the six canonical stages this node represents. */
  kind: CausalStageKind;
  /** Display title (e.g. "WM ≈ 4 chunks"). */
  title: string;
  /** Sub-label (e.g. "Cowan invariant"). */
  meta: string;
  /** 0..1 confidence — drives edge stroke + node ring intensity. */
  confidence?: number;
  /** Training-only vs web-verified badge. */
  verified?: boolean;
  /** Short headline value (e.g. "+23%"). */
  valueLabel?: string;
  /** Entity backing this stage, if any. */
  entityId?: string | null;
  /** Chain identity — used on click to route to the trace page. */
  chainId: string;
  chainRank: number;
  chainName: string;
  /** Position within the 6-stage chain (0..5). */
  stageIndex: number;
  /** True for the shared terminal goal node — different layout + styling. */
  isTerminal?: boolean;
  /** Only on the terminal node: number of chains converging. */
  convergingCount?: number;
}

export interface GoalNodeInput {
  /** ImprovementGoal.id — every chain's primary_goal_id. */
  id: string;
  /** Display title of the goal (e.g. the user's ultimate objective). */
  title: string;
}

export interface FlowShape {
  nodes: Array<{
    id: string;
    type: "stage" | "goal";
    position: { x: number; y: number };
    data: StageNodeData;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    animated?: boolean;
    style?: Record<string, string | number>;
    data?: { confidence?: number; chainId: string };
  }>;
}

// ── Layout constants ────────────────────────────────────────────────────

const NODE_W = 180;
const NODE_H = 72;
const COL_GAP = 64;   // horizontal gap between stages
const ROW_GAP = 28;   // vertical gap between chains
const STAGES_PER_CHAIN = 5; // first 5 stages; the 6th merges into the shared terminal

/**
 * Build reactflow nodes + edges for a set of causal chains.
 *
 * @param chains    Ranked causal chains (order determines vertical stacking).
 * @param goal      The shared terminal goal node spec.
 */
export function causalChainsToFlow(
  chains: CausalChain[],
  goal: GoalNodeInput | null,
): FlowShape {
  const nodes: FlowShape["nodes"] = [];
  const edges: FlowShape["edges"] = [];

  chains.forEach((chain, rowIdx) => {
    const y = rowIdx * (NODE_H + ROW_GAP);

    // Stages 0..4 (concept → outcome). Stage 5 merges into the shared goal.
    for (let i = 0; i < STAGES_PER_CHAIN; i++) {
      const stage = chain.stages[i];
      if (!stage) continue;
      const nodeId = `${chain.id}::${i}`;
      nodes.push({
        id: nodeId,
        type: "stage",
        position: { x: i * (NODE_W + COL_GAP), y },
        data: {
          kind: stage.kind,
          title: stage.title,
          meta: stage.meta,
          confidence: stage.confidence,
          verified: stage.verified,
          valueLabel: stage.value_label,
          entityId: stage.entity_id ?? null,
          chainId: chain.id,
          chainRank: chain.rank,
          chainName: chain.name,
          stageIndex: i,
        },
      });

      // Edge to previous stage in the same chain.
      if (i > 0) {
        const prevId = `${chain.id}::${i - 1}`;
        edges.push({
          id: `${prevId}->${nodeId}`,
          source: prevId,
          target: nodeId,
          data: { confidence: stage.confidence, chainId: chain.id },
        });
      }
    }

    // Final edge from stage 4 (outcome) into the shared terminal goal node.
    if (goal) {
      const outcomeId = `${chain.id}::${STAGES_PER_CHAIN - 1}`;
      edges.push({
        id: `${outcomeId}->goal`,
        source: outcomeId,
        target: "goal",
        animated: true,
        data: {
          confidence: chain.confidence,
          chainId: chain.id,
        },
      });
    }
  });

  // Shared terminal goal node — center-right of the canvas, vertically
  // aligned to the middle of the stacked chains.
  if (goal) {
    const terminalX = STAGES_PER_CHAIN * (NODE_W + COL_GAP);
    const totalH = Math.max(1, chains.length) * (NODE_H + ROW_GAP) - ROW_GAP;
    const terminalY = Math.max(0, totalH / 2 - NODE_H / 2);
    nodes.push({
      id: "goal",
      type: "goal",
      position: { x: terminalX, y: terminalY },
      data: {
        kind: "goal",
        title: goal.title,
        meta: "Master objective",
        chainId: "__goal__",
        chainRank: 0,
        chainName: goal.title,
        stageIndex: STAGES_PER_CHAIN,
        isTerminal: true,
        convergingCount: chains.length,
      },
    });
  }

  return { nodes, edges };
}

/** Bounding box for the flow — used to fit the viewport. */
export function flowBounds(flow: FlowShape): { width: number; height: number } {
  if (flow.nodes.length === 0) return { width: 0, height: 0 };
  let maxX = 0;
  let maxY = 0;
  for (const n of flow.nodes) {
    maxX = Math.max(maxX, n.position.x + NODE_W);
    maxY = Math.max(maxY, n.position.y + NODE_H);
  }
  return { width: maxX, height: maxY };
}

export const CAUSAL_LAYOUT = {
  NODE_W,
  NODE_H,
  COL_GAP,
  ROW_GAP,
  STAGES_PER_CHAIN,
} as const;
