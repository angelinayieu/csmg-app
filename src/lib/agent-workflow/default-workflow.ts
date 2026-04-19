// Default agent workflow — the standard pipeline graph every space gets
// until its use-case template or an agent produces a custom one.
//
// This is the visual vocabulary for the mockup's "Experiment Digital
// Twin": Agent C → Prompt Design → Quality Tracking → branches into
// Novel Insights + Utility Score → each evaluated by Agents A + B.
//
// Our default shape reflects the actual pipeline order so the user sees
// their own system's flow:
//
//   Input  →  Scope  →  Decompose  →  Research  →  Synthesize  ↘
//                                                              Strategize  →  Apps
//                                                Reasoner     ↗
//                                                Critic       ↗
//
// This is a *default* — templates can override via UseCaseTemplate.agent_workflow
// (matching the `app_seeds` pattern).

import type {
  AgentWorkflow,
  AgentWorkflowNode,
  AgentWorkflowEdge,
} from "@/types/agent-workflow";

const NODES: AgentWorkflowNode[] = [
  // Row 1: user input
  {
    id: "input",
    label: "User input",
    kind: "input",
    row: 1,
    col: 1,
    sublabel: "problem statement",
  },

  // Row 2: intake agents
  {
    id: "agent:scope",
    label: "Scope Mapper",
    kind: "agent",
    row: 2,
    col: 1,
    sublabel: "scopes the problem",
    produces: "Scoped domain",
  },
  {
    id: "data:scope",
    label: "Scoped domain",
    kind: "data",
    row: 2,
    col: 2,
  },

  // Row 3: decomposition + research in parallel
  {
    id: "agent:decompose",
    label: "Decomposer",
    kind: "agent",
    row: 3,
    col: 1,
    sublabel: "builds the KG",
    produces: "Knowledge graph",
  },
  {
    id: "agent:research",
    label: "Researcher",
    kind: "agent",
    row: 3,
    col: 3,
    sublabel: "deep research",
    produces: "External evidence",
  },

  // Row 4: knowledge artifacts
  {
    id: "data:kg",
    label: "Knowledge graph",
    kind: "data",
    row: 4,
    col: 1,
  },
  {
    id: "data:research",
    label: "External evidence",
    kind: "data",
    row: 4,
    col: 3,
  },

  // Row 5: synthesis
  {
    id: "agent:synthesize",
    label: "Synthesizer",
    kind: "agent",
    row: 5,
    col: 2,
    sublabel: "finds leverage + risks",
    produces: "Synthesis",
  },

  // Row 6: strategy
  {
    id: "agent:strategize",
    label: "Strategist",
    kind: "agent",
    row: 6,
    col: 2,
    sublabel: "generates recommendation",
    produces: "Strategy",
  },

  // Row 7: critique + evaluation
  {
    id: "agent:critic",
    label: "Critic",
    kind: "agent",
    row: 7,
    col: 1,
    sublabel: "quality review",
  },
  {
    id: "agent:reasoner",
    label: "Reasoner",
    kind: "agent",
    row: 7,
    col: 3,
    sublabel: "deep reasoning",
  },

  // Row 8: output — Apps materialized
  {
    id: "output:apps",
    label: "Apps",
    kind: "output",
    row: 8,
    col: 2,
    sublabel: "materialized deliverables",
  },
];

const EDGES: AgentWorkflowEdge[] = [
  // Input → Scope
  { id: "e1", from: "input", to: "agent:scope", kind: "consumes" },
  // Scope → scoped-domain data
  { id: "e2", from: "agent:scope", to: "data:scope", kind: "produces" },
  // Scoped domain → Decomposer + Researcher in parallel
  { id: "e3", from: "data:scope", to: "agent:decompose", kind: "consumes" },
  { id: "e4", from: "data:scope", to: "agent:research", kind: "consumes" },
  // Decomposer → KG; Researcher → Evidence
  { id: "e5", from: "agent:decompose", to: "data:kg", kind: "produces" },
  { id: "e6", from: "agent:research", to: "data:research", kind: "produces" },
  // KG + Evidence → Synthesizer
  { id: "e7", from: "data:kg", to: "agent:synthesize", kind: "feeds" },
  { id: "e8", from: "data:research", to: "agent:synthesize", kind: "feeds" },
  // Synthesizer → Strategist (direct — strategy consumes synthesis)
  { id: "e9", from: "agent:synthesize", to: "agent:strategize", kind: "consumes", label: "Synthesis" },
  // Strategist evaluated by Critic + Reasoner in parallel
  { id: "e10", from: "agent:strategize", to: "agent:critic", kind: "evaluates" },
  { id: "e11", from: "agent:strategize", to: "agent:reasoner", kind: "evaluates" },
  // Critic + Reasoner → Apps (output)
  { id: "e12", from: "agent:critic", to: "output:apps", kind: "produces" },
  { id: "e13", from: "agent:reasoner", to: "output:apps", kind: "produces" },
];

export function buildDefaultAgentWorkflow(
  spaceName?: string
): AgentWorkflow {
  return {
    id: "default:standard_pipeline",
    name: spaceName ? `${spaceName} — pipeline` : "Standard pipeline",
    description:
      "Default agent orchestration: scope → decompose + research → synthesize → strategize → critic + reasoner → apps.",
    nodes: NODES,
    edges: EDGES,
    provenance: {
      produced_by: "default_pipeline",
      produced_at: new Date().toISOString(),
    },
  };
}

/**
 * Apply a map of node-id → status onto a workflow (non-mutating).
 * Used to overlay live `agent_runs.status` on top of the static shape.
 */
export function applyAgentRunStatus(
  workflow: AgentWorkflow,
  statusById: Map<string, AgentWorkflowNode["status"]>
): AgentWorkflow {
  if (statusById.size === 0) return workflow;
  return {
    ...workflow,
    nodes: workflow.nodes.map((n) =>
      statusById.has(n.id) ? { ...n, status: statusById.get(n.id) } : n
    ),
  };
}
