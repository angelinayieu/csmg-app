// Agent workflow — the "Experiment Digital Twin" shape.
//
// An AgentWorkflow is a directed graph showing how agents orchestrate to
// move the subject toward the active goal. Distinct from the Knowledge
// Graph (which models the subject itself) and the Mechanism Twin (which
// models the subject's process). This graph answers: "what are the agents
// actually doing, and how do their outputs chain?"
//
// Design principles:
//   1. Hand-laid layout — every node carries its (row, col) hint so the
//      renderer doesn't need a DAG layout library (dagre/elkjs are 60kb+
//      each; we ship less than a page of SVG code instead).
//   2. Stable node ids — agents keep the same id across runs so live
//      status can be joined cheaply.
//   3. Pluggable source — a space can adopt:
//        (a) the default pipeline workflow (every space gets one),
//        (b) a use-case-template override (AgentWorkflow on UseCaseTemplate),
//        (c) a user-edited / agent-proposed custom workflow (future).

// ── Node ──────────────────────────────────────────────────────────────

export type AgentNodeKind =
  | "agent"      // AI agent (synthesizer, critic, reasoner, etc.)
  | "data"       // a named data product (Prompt Design, Quality Score)
  | "criteria"   // an evaluation criteria ("Novel" Criteria Lab)
  | "output"     // terminal output of the pipeline
  | "input";     // external input (user query, external signal)

export interface AgentWorkflowNode {
  /** Stable id. For agents, matches the `agents.kind` or `agents.id` on the table. */
  id: string;
  /** Display label rendered on the node. */
  label: string;
  /** Node kind — drives color + shape in the renderer. */
  kind: AgentNodeKind;
  /**
   * Layout hints. Row/column are 1-indexed grid positions. The renderer
   * packs nodes into a grid based on these. Rows flow top-to-bottom (like
   * a Sankey); columns are decorative (allow parallel branches).
   */
  row: number;
  col: number;
  /**
   * Optional sublabel — e.g. "produces prompt" on an agent node, or a
   * metric name on a data node.
   */
  sublabel?: string;
  /**
   * Optional status — live-joined from agent_runs by the resolver. When
   * null, the node renders in its neutral state.
   */
  status?: "idle" | "running" | "done" | "failed" | null;
  /** Optional: what this node PRODUCES. Used for the edge label. */
  produces?: string;
  /** Optional: which ImprovementGoal.id this node's output is measured against. */
  serves_goal_id?: string | null;
}

// ── Edge ──────────────────────────────────────────────────────────────

export type AgentEdgeKind =
  | "produces"   // output → data
  | "consumes"   // data → next agent input
  | "evaluates"  // criteria → score
  | "feeds";     // data → criteria (input for evaluation)

export interface AgentWorkflowEdge {
  id: string;
  from: string; // source node id
  to: string;   // target node id
  kind: AgentEdgeKind;
  /**
   * Optional label rendered at the midpoint of the edge.
   * Most edges are self-explanatory from the node kinds; labels only shown
   * when meaningful ("Prompt Design", "Quality Score", etc.).
   */
  label?: string;
}

// ── Workflow ──────────────────────────────────────────────────────────

export interface AgentWorkflow {
  /** Stable id for the workflow itself — useful for templates + audit. */
  id: string;
  /** Display name — "Decomposition Prompt Optimization" etc. */
  name: string;
  /** Short description of what the experiment optimizes for. */
  description?: string;
  /** Nodes laid out by row/col. */
  nodes: AgentWorkflowNode[];
  /** Directed edges between nodes. */
  edges: AgentWorkflowEdge[];
  /** Where this workflow came from. */
  provenance?: {
    produced_by: "default_pipeline" | "use_case_template" | "agent" | "user";
    produced_at: string;
    template_id?: string;
  };
}

// ── Utility: widest + tallest dimensions for layout sizing ──

export function workflowDimensions(
  workflow: AgentWorkflow
): { rows: number; cols: number } {
  let maxRow = 1;
  let maxCol = 1;
  for (const n of workflow.nodes) {
    if (n.row > maxRow) maxRow = n.row;
    if (n.col > maxCol) maxCol = n.col;
  }
  return { rows: maxRow, cols: maxCol };
}
