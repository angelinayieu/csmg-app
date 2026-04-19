/**
 * Declarative metadata for each agent kind — used by seeding + UI.
 * Any new kind must be added to the DB CHECK constraint in migration
 * 20260418_agent_runtime.sql as well.
 */

import type { AgentKind } from "@/types";

export interface AgentKindMeta {
  kind: AgentKind;
  name: string;        // long human-readable name
  callsign: string;    // short display handle (ATLAS-04 style)
  specialty: string;   // 1-line descriptor
  focus_areas: string[];
}

/** The canonical registry. Order here = seeding order + UI default sort. */
export const AGENT_KINDS: AgentKindMeta[] = [
  {
    kind: "decomposer",
    name: "Decomposer",
    callsign: "ATLAS-D",
    specialty: "Decomposes input into tiered entities + relationships",
    focus_areas: ["decomposition", "entity_extraction"],
  },
  {
    kind: "critic",
    name: "Structural Critic",
    callsign: "VEGA-C",
    specialty: "Audits graph structure, finds orphans + missing cycles",
    focus_areas: ["quality", "orphans", "cycles"],
  },
  {
    kind: "augmenter",
    name: "Graph Augmenter",
    callsign: "VEGA-A",
    specialty: "Applies critic corrections — adds missing edges, fixes centrality",
    focus_areas: ["augmentation", "corrections"],
  },
  {
    kind: "researcher",
    name: "Domain Researcher",
    callsign: "ATLAS-R",
    specialty: "External web research + domain expertise",
    focus_areas: ["external_research", "web_search"],
  },
  {
    kind: "synthesizer",
    name: "Synthesizer",
    callsign: "ORION-S",
    specialty: "Produces leverage / risk / bottleneck synthesis",
    focus_areas: ["synthesis", "leverage_points", "risk_points"],
  },
  {
    kind: "strategist",
    name: "Strategist",
    callsign: "ORION-X",
    specialty: "Generates strategic recommendations + action plans",
    focus_areas: ["strategy", "recommendations"],
  },
  {
    kind: "twin",
    name: "Twin Computer",
    callsign: "TWIN-Ψ",
    specialty: "Computes digital twin state + health score",
    focus_areas: ["twin", "health_score"],
  },
  {
    kind: "bridge",
    name: "Bridge Discoverer",
    callsign: "NEXUS-B",
    specialty: "Finds connections between internal + external entities",
    focus_areas: ["bridges", "cross_context"],
  },
  {
    kind: "expansion",
    name: "Expansion Agent",
    callsign: "DEPTH-E",
    specialty: "Decomposes entities into sub-components",
    focus_areas: ["expansion", "sub_components"],
  },
  {
    kind: "coordinator",
    name: "Coordinator",
    callsign: "ORCHESTRATOR-Ω",
    specialty: "Schedules and prioritizes other agents",
    focus_areas: ["scheduling", "prioritization"],
  },
  {
    kind: "reasoner",
    name: "Reasoner",
    callsign: "LOGOS-R",
    specialty: "Graph reasoning — centrality, cycles, cascade, path prediction",
    focus_areas: ["reasoning", "centrality", "paths"],
  },
  {
    kind: "reevaluator",
    name: "Reevaluator",
    callsign: "LOGOS-V",
    specialty: "Revisits existing analysis with new context",
    focus_areas: ["reevaluation", "deep_refresh"],
  },
  {
    kind: "incremental_analyzer",
    name: "Incremental Analyzer",
    callsign: "FLUX-I",
    specialty: "Fast chat-triggered delta analysis",
    focus_areas: ["incremental", "chat_analysis"],
  },
  {
    kind: "chat",
    name: "Chat Assistant",
    callsign: "ECHO-C",
    specialty: "Conversational graph navigation + proposals",
    focus_areas: ["chat", "exploration"],
  },
];

export const AGENT_KIND_MAP: Record<AgentKind, AgentKindMeta> = Object.fromEntries(
  AGENT_KINDS.map((a) => [a.kind, a])
) as Record<AgentKind, AgentKindMeta>;

export function getAgentKindMeta(kind: AgentKind): AgentKindMeta {
  return AGENT_KIND_MAP[kind];
}
