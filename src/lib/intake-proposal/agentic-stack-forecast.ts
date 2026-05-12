// buildAgenticStackForecast — derives the Agentic Stack pane payload
// purely from the canonical agent registry + the proposed reasoning
// settings. NO LLM CALLS.
//
// Why ground in the registry: the user wants to see "exactly which
// agents will work on my behalf" before approving. The 17 canonical
// agents in src/lib/agents/registry.ts always run during the pipeline
// (gated only by reasoning_settings.depth + lenses), so listing them
// pre-approval is honest — the user is not seeing a marketing forecast,
// they're seeing the actual deployment list.
//
// Phases mirror the registry's source-code grouping (see comments in
// registry.ts at line 32+): intake → enrichment → critical → strategy.
//
// Each agent gets a `runs_when` line that ties it to the reasoning
// setting that activates it (e.g. "always" vs. "depth=deep" vs.
// "lenses includes 'critic'"), so the user understands what their
// settings buy them.

import type { KgPlanReasoningSettingsProposed } from "@/types/kg-generation-plan";
import type { AgentId } from "@/lib/agents/registry";
import { AGENT_IDS } from "@/lib/agents/registry";

export type AgenticStackPhaseKey =
  | "intake"
  | "enrichment"
  | "critical"
  | "strategy";

export interface AgenticStackAgentCard {
  id: AgentId;
  /** User-facing title (rendered as the row heading). */
  title: string;
  /** One-sentence description of the agent's responsibility. */
  responsibility: string;
  /** Plain-English condition that triggers this agent in the run. */
  runs_when: string;
  /** True when the active reasoning_settings keep this agent active. */
  active_in_this_run: boolean;
}

export interface AgenticStackPhase {
  key: AgenticStackPhaseKey;
  /** UI title (e.g. "Intake & decomposition"). */
  title: string;
  /** One-sentence framing of what happens in this phase. */
  description: string;
  /** Hex accent for the phase header. */
  accent: string;
  agents: AgenticStackAgentCard[];
}

export interface AgenticStackForecast {
  phases: AgenticStackPhase[];
  /** Total agent count across all phases. */
  total_agents: number;
  /** How many agents will fire given the proposed reasoning settings. */
  active_in_run_count: number;
  /** The reasoning depth that drives which agents fire. */
  resolved_depth: "quick" | "standard" | "deep";
}

// ── Per-agent metadata ────────────────────────────────────────────
//
// Sourced from the registry's source-code comments (line 32+) and the
// pipeline orchestrator's stage-fire conditions. Keep this aligned
// with src/lib/agents/registry.ts when new agents land.

interface AgentMeta {
  phase: AgenticStackPhaseKey;
  title: string;
  responsibility: string;
  runs_when: string;
  /** Returns true when this agent fires under the given settings. */
  is_active(settings: ResolvedSettings): boolean;
}

interface ResolvedSettings {
  depth: "quick" | "standard" | "deep";
  lenses: string[];
  buildBaselineFirst: boolean;
}

const ALWAYS_ACTIVE = () => true;
const ACTIVE_AT_STANDARD_OR_DEEPER = (s: ResolvedSettings) =>
  s.depth !== "quick";
const ACTIVE_AT_DEEP_ONLY = (s: ResolvedSettings) => s.depth === "deep";

const AGENT_META: Record<AgentId, AgentMeta> = {
  // ── Intake / decomposition phase ────────────────────────────────
  hierarchical_systems: {
    phase: "intake",
    title: "Hierarchical systems decomposer",
    responsibility:
      "Pass A — break the prompt into top-level systems and subsystems.",
    runs_when: "Always — first pass of the decomposition stack.",
    is_active: ALWAYS_ACTIVE,
  },
  hierarchical_domains: {
    phase: "intake",
    title: "Hierarchical domains decomposer",
    responsibility:
      "Pass B — re-decompose the systems into domain-aligned families.",
    runs_when: "Standard or Deep — adds domain-flavored variants.",
    is_active: ACTIVE_AT_STANDARD_OR_DEEPER,
  },
  hierarchical_threads: {
    phase: "intake",
    title: "Hierarchical threads decomposer",
    responsibility:
      "Pass C — surface long thematic threads that cross domains.",
    runs_when: "Deep only — the third decomposition pass.",
    is_active: ACTIVE_AT_DEEP_ONLY,
  },
  flat_decomposer: {
    phase: "intake",
    title: "Flat decomposer (fallback)",
    responsibility:
      "Single-pass decomposition used when the hierarchical stack is gated off.",
    runs_when: "Quick depth — lighter alternative to the hierarchical passes.",
    is_active: (s) => s.depth === "quick",
  },
  why_chain_deepener: {
    phase: "intake",
    title: "Why-chain deepener",
    responsibility:
      "Recursively pulls upstream causal drivers behind each surfaced node.",
    runs_when: "Always — every pipeline run includes one why-chain pass.",
    is_active: ALWAYS_ACTIVE,
  },
  frame_extractor: {
    phase: "intake",
    title: "Frame extractor",
    responsibility:
      "Identifies the probability-space axes (timeline / actors / risk / ...) that frame this prompt.",
    runs_when: "Always — produces the axis spine for the rest of the pipeline.",
    is_active: ALWAYS_ACTIVE,
  },
  axis_generator: {
    phase: "intake",
    title: "Per-axis generator",
    responsibility:
      "For each selected axis, generates the entities + sub-graph that populate it.",
    runs_when: "Always — fans out one job per active axis.",
    is_active: ALWAYS_ACTIVE,
  },

  // ── Enrichment phase ────────────────────────────────────────────
  bridge_discoverer: {
    phase: "enrichment",
    title: "Cross-axis bridge discoverer",
    responsibility:
      "Spots structural analogs that connect entities across axes / spaces.",
    runs_when: "Standard or Deep — bridges aren't computed at quick depth.",
    is_active: ACTIVE_AT_STANDARD_OR_DEEPER,
  },
  intelligence_feedback: {
    phase: "enrichment",
    title: "Intelligence feedback loop",
    responsibility:
      "Folds discovery-sourced additions back into the graph as new entities.",
    runs_when: "Always — runs whenever a discovery surface yields new content.",
    is_active: ALWAYS_ACTIVE,
  },
  expansion_materializer: {
    phase: "enrichment",
    title: "Expansion materializer",
    responsibility:
      "Materializes on-demand sub-component expansions when an entity gets attention.",
    runs_when: "Always — invoked lazily as the user explores nodes.",
    is_active: ALWAYS_ACTIVE,
  },
  ground_objectives: {
    phase: "enrichment",
    title: "Objective grounder",
    responsibility:
      "Anchors the prompt's stated goals to concrete entities in the graph.",
    runs_when: "Always — produces the focal-outcome nodes the strategy ranks against.",
    is_active: ALWAYS_ACTIVE,
  },
  gap_analyzer: {
    phase: "enrichment",
    title: "Gap analyzer",
    responsibility:
      "Surfaces missing pieces — entities the model expected but didn't find.",
    runs_when: "Standard or Deep — gap analysis isn't run at quick depth.",
    is_active: ACTIVE_AT_STANDARD_OR_DEEPER,
  },

  // ── Critical / consensus phase ──────────────────────────────────
  edge_auditor: {
    phase: "critical",
    title: "Edge auditor",
    responsibility:
      "Endorses or disputes each proposed edge, building a consensus signal.",
    runs_when: "Standard or Deep — edge audits add latency that quick skips.",
    is_active: ACTIVE_AT_STANDARD_OR_DEEPER,
  },
  critic: {
    phase: "critical",
    title: "Post-hoc graph critic",
    responsibility:
      "Reviews the assembled graph for over-confidence, missed contradictions, and stale assumptions.",
    runs_when:
      "Active when 'critic' is in lenses, or when depth=deep (always).",
    is_active: (s) =>
      s.depth === "deep" || s.lenses.includes("critic"),
  },
  causal_auditor: {
    phase: "critical",
    title: "Causal-direction auditor",
    responsibility:
      "Audits each edge for direction-of-causation errors (effect → cause flips).",
    runs_when: "Standard or Deep — causal audit has nontrivial cost.",
    is_active: ACTIVE_AT_STANDARD_OR_DEEPER,
  },

  // ── Strategy phase ──────────────────────────────────────────────
  space_strategizer: {
    phase: "strategy",
    title: "Space strategizer",
    responsibility:
      "Produces candidate strategy plans, scored under multiple agent-weight profiles.",
    runs_when: "Always — every run terminates with at least one strategy.",
    is_active: ALWAYS_ACTIVE,
  },
  strategy_engine: {
    phase: "strategy",
    title: "Strategy engine (intervention planner)",
    responsibility:
      "Selects the best strategy + assembles infrastructure proposals + agent specs that staff each app.",
    runs_when: "Always — terminal stage that hands off to twin generation.",
    is_active: ALWAYS_ACTIVE,
  },
};

const PHASE_META: Record<
  AgenticStackPhaseKey,
  { title: string; description: string; accent: string }
> = {
  intake: {
    title: "Intake & decomposition",
    description:
      "Break the prompt into systems, axes, and the upstream drivers behind them.",
    accent: "#6366F1",
  },
  enrichment: {
    title: "Enrichment & grounding",
    description:
      "Connect related entities, fold in discovery, anchor to concrete outcomes.",
    accent: "#0EA5E9",
  },
  critical: {
    title: "Critique & consensus",
    description:
      "Audit edges, flag over-confidence, validate causal directions.",
    accent: "#F59E0B",
  },
  strategy: {
    title: "Strategy synthesis",
    description:
      "Score candidate strategies, propose the apps + agents that will execute them.",
    accent: "#10B981",
  },
};

interface BuildArgs {
  /** Proposed reasoning settings on the kg_generation_plan. */
  reasoning_settings: KgPlanReasoningSettingsProposed | null;
}

export function buildAgenticStackForecast({
  reasoning_settings,
}: BuildArgs): AgenticStackForecast {
  const resolved: ResolvedSettings = {
    depth: reasoning_settings?.depth ?? "standard",
    lenses: reasoning_settings?.lenses ?? [],
    buildBaselineFirst: reasoning_settings?.buildBaselineFirst ?? false,
  };

  const phasesByKey: Record<AgenticStackPhaseKey, AgenticStackAgentCard[]> = {
    intake: [],
    enrichment: [],
    critical: [],
    strategy: [],
  };

  let active_in_run_count = 0;
  for (const id of AGENT_IDS) {
    const meta = AGENT_META[id];
    if (!meta) continue;
    const active = meta.is_active(resolved);
    if (active) active_in_run_count++;
    phasesByKey[meta.phase].push({
      id,
      title: meta.title,
      responsibility: meta.responsibility,
      runs_when: meta.runs_when,
      active_in_this_run: active,
    });
  }

  const phases: AgenticStackPhase[] = (
    ["intake", "enrichment", "critical", "strategy"] as AgenticStackPhaseKey[]
  ).map((key) => ({
    key,
    title: PHASE_META[key].title,
    description: PHASE_META[key].description,
    accent: PHASE_META[key].accent,
    agents: phasesByKey[key],
  }));

  return {
    phases,
    total_agents: AGENT_IDS.length,
    active_in_run_count,
    resolved_depth: resolved.depth,
  };
}
