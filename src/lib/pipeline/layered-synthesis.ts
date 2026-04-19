// ── Layered synthesis orchestrator ──
// Runs the 4-stage layered synthesis: fulcrum system → critical domain →
// load-bearing thread → final narrative. Each stage is a small-N decision
// with bounded context, so the LLM stays in its sweet spot at every step.
//
// Requires a hierarchical graph (entities with `layer` field and
// parent_entity_id provenance). For flat graphs, callers should fall back
// to the existing synthesis flow.

import { llmJSON } from "@/lib/llm";
import {
  SYNTHESIS_STAGE_FULCRUM_SYSTEM,
  SYNTHESIS_STAGE_CRITICAL_DOMAIN,
  SYNTHESIS_STAGE_LOAD_BEARING_THREAD,
  SYNTHESIS_STAGE_FINAL_NARRATIVE,
  buildFulcrumContext,
  buildCriticalDomainContext,
  buildLoadBearingThreadContext,
  buildFinalNarrativeContext,
  type SystemForSynthesis,
  type DomainForSynthesis,
  type ThreadForSynthesis,
  type EdgeForSynthesis,
} from "@/lib/prompts/layered-synthesis";
import type { Entity, Edge } from "@/types";

// ── LLM output shapes ──

interface FulcrumStageOutput {
  fulcrum_system_id: string;
  fulcrum_system_name: string;
  case_for_fulcrum: string[];
  systems_considered_and_rejected: Array<{
    system_id: string;
    system_name: string;
    reason_rejected: string;
  }>;
  cross_system_consequences: string;
  confidence: number;
}

interface DomainStageOutput {
  critical_domain_id: string;
  critical_domain_name: string;
  why_this_domain: string[];
  sibling_domains_rejected: Array<{
    domain_id: string;
    domain_name: string;
    reason_rejected: string;
  }>;
  tension_description: string;
  confidence: number;
}

interface ThreadStageOutput {
  load_bearing_thread_id: string;
  load_bearing_thread_name: string;
  intervention_point: string;
  why_this_thread: string[];
  sibling_threads_rejected: Array<{ thread_id: string; reason_rejected: string }>;
  testable_assumptions: string[];
  failure_mode: string;
  first_move: string;
  confidence: number;
}

interface FinalNarrativeOutput {
  headline: string;
  narrative: string;
  key_decision: string;
  opposing_view: string;
  confidence: number;
  open_questions: string[];
}

export interface LayeredSynthesisResult {
  stages: {
    fulcrum: FulcrumStageOutput;
    domain: DomainStageOutput;
    thread: ThreadStageOutput;
    final: FinalNarrativeOutput;
  };
  stats: {
    llm_calls: number;
    systems_considered: number;
    domains_considered: number;
    threads_considered: number;
    duration_ms: number;
  };
}

// ── Entity → synthesis-shape adapters ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parentOf(e: Entity): string | undefined { return (e as any).parent_entity_id; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function provenance(e: Entity): Record<string, unknown> | null { return (e as any).provenance as Record<string, unknown> | null; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function edgeTopology(e: Edge): string | undefined { return (e as any).topology as string | undefined; }

function toSystemShape(e: Entity): SystemForSynthesis {
  const prov = provenance(e);
  return {
    entity_id: e.entity_id,
    name: e.name,
    description: e.description ?? "",
    importance: e.importance ?? undefined,
    why_it_matters: typeof prov?.why_it_matters === "string" ? prov.why_it_matters : undefined,
  };
}

function toDomainShape(e: Entity, entityIdByUuid: Map<string, string>): DomainForSynthesis {
  const parentUuid = parentOf(e);
  const parentDisplay = parentUuid ? entityIdByUuid.get(parentUuid) ?? "" : "";
  return {
    entity_id: e.entity_id,
    name: e.name,
    description: e.description ?? "",
    importance: e.importance ?? undefined,
    parent_system_id: parentDisplay,
  };
}

function toThreadShape(e: Entity, entityIdByUuid: Map<string, string>): ThreadForSynthesis {
  const prov = provenance(e);
  const parentUuid = parentOf(e);
  const parentDisplay = parentUuid ? entityIdByUuid.get(parentUuid) ?? "" : "";
  return {
    entity_id: e.entity_id,
    name: e.name,
    description: e.description ?? "",
    importance: e.importance ?? undefined,
    parent_domain_id: parentDisplay,
    intervention_point: typeof prov?.intervention_point === "string" ? prov.intervention_point : undefined,
  };
}

function toEdgeShape(
  e: Edge,
  entityIdByUuid: Map<string, string>,
): EdgeForSynthesis {
  return {
    source_id: entityIdByUuid.get(e.source_entity_id) ?? "?",
    target_id: entityIdByUuid.get(e.target_entity_id) ?? "?",
    relationship_type: e.relationship_type,
    dimension: e.dimension,
    topology: edgeTopology(e),
    reasoning: typeof e.conditions === "string" ? e.conditions : null,
  };
}

// ── Fault extraction ──
// Faults live as entities with category="fault" and provenance.involved_entity_ids.

function extractFaults(entities: Entity[]): Array<{
  id: string;
  name: string;
  description: string;
  involved_ids: string[];
}> {
  const faults: Array<{ id: string; name: string; description: string; involved_ids: string[] }> = [];
  for (const e of entities) {
    // See hierarchical-quality.ts — types lag schema migration 20260421.
    if ((e.entity_category as string) !== "fault") continue;
    const prov = provenance(e);
    const involved = Array.isArray(prov?.involved_entity_ids)
      ? (prov?.involved_entity_ids as string[])
      : [];
    faults.push({
      id: e.entity_id,
      name: e.name,
      description: e.description ?? "",
      involved_ids: involved,
    });
  }
  return faults;
}

// ── Scope helpers ──
// Given an entity graph, derive the entity → parent_system lineage.

function buildSystemLineage(entities: Entity[]): Map<string, string> {
  // Returns entity_id (display) → parent_system entity_id (display).
  const byUuid = new Map<string, Entity>();
  for (const e of entities) byUuid.set(e.id, e);
  const result = new Map<string, string>();
  for (const e of entities) {
    if (e.layer === "system") {
      result.set(e.entity_id, e.entity_id);
    } else if (e.layer === "domain") {
      const p = parentOf(e);
      if (p) {
        const parent = byUuid.get(p);
        if (parent) result.set(e.entity_id, parent.entity_id);
      }
    } else if (e.layer === "thread") {
      const domainUuid = parentOf(e);
      const domain = domainUuid ? byUuid.get(domainUuid) : undefined;
      const sysUuid = domain ? parentOf(domain) : undefined;
      const sys = sysUuid ? byUuid.get(sysUuid) : undefined;
      if (sys) result.set(e.entity_id, sys.entity_id);
    }
  }
  return result;
}

function buildDomainLineage(entities: Entity[]): Map<string, string> {
  // Returns thread entity_id → parent domain entity_id (display).
  const byUuid = new Map<string, Entity>();
  for (const e of entities) byUuid.set(e.id, e);
  const result = new Map<string, string>();
  for (const e of entities) {
    if (e.layer !== "thread") continue;
    const domainUuid = parentOf(e);
    const domain = domainUuid ? byUuid.get(domainUuid) : undefined;
    if (domain) result.set(e.entity_id, domain.entity_id);
  }
  return result;
}

// ── Main orchestrator ──

export async function runLayeredSynthesis(params: {
  userInput: string;
  spaceName: string;
  entities: Entity[];
  edges: Edge[];
}): Promise<LayeredSynthesisResult> {
  const startedAt = Date.now();
  let llmCalls = 0;

  const entityIdByUuid = new Map<string, string>();
  for (const e of params.entities) entityIdByUuid.set(e.id, e.entity_id);

  const systems = params.entities.filter((e) => e.layer === "system");
  const domains = params.entities.filter((e) => e.layer === "domain");
  const threads = params.entities.filter((e) => e.layer === "thread");

  if (systems.length === 0) {
    throw new Error("Layered synthesis requires a hierarchical graph — no system-layer entities found.");
  }
  if (domains.length === 0) {
    throw new Error("Layered synthesis requires a hierarchical graph — no domain-layer entities found.");
  }

  const systemLineage = buildSystemLineage(params.entities);
  const domainLineage = buildDomainLineage(params.entities);
  const allFaults = extractFaults(params.entities);

  // ── Stage 1: Fulcrum system ──

  // Cross-system edges: both endpoints are systems, or endpoints in different systems.
  const crossSystemEdges = params.edges.filter((e) => {
    const src = entityIdByUuid.get(e.source_entity_id);
    const tgt = entityIdByUuid.get(e.target_entity_id);
    if (!src || !tgt) return false;
    const srcSys = systemLineage.get(src);
    const tgtSys = systemLineage.get(tgt);
    return !!srcSys && !!tgtSys && srcSys !== tgtSys;
  });

  // Deduplicate cross-system edges TO their system level (collapse many
  // thread-level cross-system edges into one system-to-system edge per
  // relationship_type, for the Stage 1 prompt).
  const crossSystemAggregated = new Map<string, EdgeForSynthesis>();
  for (const e of crossSystemEdges) {
    const src = entityIdByUuid.get(e.source_entity_id);
    const tgt = entityIdByUuid.get(e.target_entity_id);
    if (!src || !tgt) continue;
    const srcSys = systemLineage.get(src);
    const tgtSys = systemLineage.get(tgt);
    if (!srcSys || !tgtSys) continue;
    const key = `${srcSys}→${tgtSys}→${e.relationship_type}`;
    if (!crossSystemAggregated.has(key)) {
      crossSystemAggregated.set(key, {
        source_id: srcSys,
        target_id: tgtSys,
        relationship_type: e.relationship_type,
        topology: edgeTopology(e),
        reasoning: typeof e.conditions === "string" ? e.conditions : null,
      });
    }
  }

  // System-level faults: faults whose involved entities span systems.
  const systemLevelFaults = allFaults.filter((f) => {
    const sysSet = new Set(f.involved_ids.map((id) => systemLineage.get(id)).filter(Boolean));
    return sysSet.size >= 2;
  });

  const fulcrumContext = buildFulcrumContext({
    userInput: params.userInput,
    spaceName: params.spaceName,
    systems: systems.map(toSystemShape),
    crossSystemEdges: Array.from(crossSystemAggregated.values()),
    systemLevelFaults,
  });

  llmCalls++;
  console.log(`[layered-synthesis] Stage 1: fulcrum system (${systems.length} candidates)`);
  const fulcrum = await llmJSON<FulcrumStageOutput>({
    system: SYNTHESIS_STAGE_FULCRUM_SYSTEM,
    user: fulcrumContext,
    maxTokens: 2500,
    temperature: 0.3,
    fallback: {
      fulcrum_system_id: systems[0].entity_id,
      fulcrum_system_name: systems[0].name,
      case_for_fulcrum: ["Fallback: first system — LLM synthesis failed"],
      systems_considered_and_rejected: [],
      cross_system_consequences: "",
      confidence: 0.3,
    },
  });
  console.log(`[layered-synthesis] Stage 1 → fulcrum=${fulcrum.fulcrum_system_id} (${fulcrum.fulcrum_system_name})`);

  // ── Stage 2: Critical domain ──

  const fulcrumSystem = systems.find((s) => s.entity_id === fulcrum.fulcrum_system_id);
  if (!fulcrumSystem) {
    throw new Error(`Fulcrum system ${fulcrum.fulcrum_system_id} not found in graph`);
  }
  const domainsInFulcrum = domains.filter((d) => {
    const p = parentOf(d);
    return p === fulcrumSystem.id;
  });
  if (domainsInFulcrum.length === 0) {
    throw new Error(`No domains found under fulcrum system ${fulcrumSystem.entity_id}`);
  }

  // Intra-system edges: both endpoints are domains in the fulcrum system.
  const domainIds = new Set(domainsInFulcrum.map((d) => d.entity_id));
  const intraSystemEdges = params.edges.filter((e) => {
    const src = entityIdByUuid.get(e.source_entity_id);
    const tgt = entityIdByUuid.get(e.target_entity_id);
    return src && tgt && domainIds.has(src) && domainIds.has(tgt);
  });

  // Faults implicating entities in the fulcrum system.
  const fulcrumSystemEntityIds = new Set<string>([fulcrumSystem.entity_id]);
  for (const [eid, sysId] of systemLineage.entries()) {
    if (sysId === fulcrumSystem.entity_id) fulcrumSystemEntityIds.add(eid);
  }
  const faultsInFulcrumSystem = allFaults.filter((f) =>
    f.involved_ids.some((id) => fulcrumSystemEntityIds.has(id)),
  );

  const domainContext = buildCriticalDomainContext({
    fulcrumSystem: toSystemShape(fulcrumSystem),
    domainsInSystem: domainsInFulcrum.map((d) => toDomainShape(d, entityIdByUuid)),
    intraSystemEdges: intraSystemEdges.map((e) => toEdgeShape(e, entityIdByUuid)),
    faultsInScope: faultsInFulcrumSystem,
  });

  llmCalls++;
  console.log(`[layered-synthesis] Stage 2: critical domain (${domainsInFulcrum.length} candidates)`);
  const domainPick = await llmJSON<DomainStageOutput>({
    system: SYNTHESIS_STAGE_CRITICAL_DOMAIN,
    user: domainContext,
    maxTokens: 2500,
    temperature: 0.3,
    fallback: {
      critical_domain_id: domainsInFulcrum[0].entity_id,
      critical_domain_name: domainsInFulcrum[0].name,
      why_this_domain: ["Fallback: first domain — LLM synthesis failed"],
      sibling_domains_rejected: [],
      tension_description: "",
      confidence: 0.3,
    },
  });
  console.log(`[layered-synthesis] Stage 2 → domain=${domainPick.critical_domain_id} (${domainPick.critical_domain_name})`);

  // ── Stage 3: Load-bearing thread ──

  const criticalDomain = domainsInFulcrum.find((d) => d.entity_id === domainPick.critical_domain_id);
  if (!criticalDomain) {
    throw new Error(`Critical domain ${domainPick.critical_domain_id} not found under fulcrum system`);
  }
  const threadsInDomain = threads.filter((t) => {
    const p = parentOf(t);
    return p === criticalDomain.id;
  });

  // Intra-domain edges: both endpoints are threads in the critical domain.
  const threadIdsInDomain = new Set(threadsInDomain.map((t) => t.entity_id));
  const intraDomainEdges = params.edges.filter((e) => {
    const src = entityIdByUuid.get(e.source_entity_id);
    const tgt = entityIdByUuid.get(e.target_entity_id);
    return src && tgt && threadIdsInDomain.has(src) && threadIdsInDomain.has(tgt);
  });

  // Cross-domain edges: source is thread in domain, target is outside domain.
  const crossDomainEdges = params.edges.filter((e) => {
    const src = entityIdByUuid.get(e.source_entity_id);
    const tgt = entityIdByUuid.get(e.target_entity_id);
    if (!src || !tgt) return false;
    const srcIn = threadIdsInDomain.has(src);
    const tgtIn = threadIdsInDomain.has(tgt);
    return (srcIn && !tgtIn) || (!srcIn && tgtIn);
  });

  // Faults whose involved entities include anything in this domain.
  const domainEntityIds = new Set<string>([criticalDomain.entity_id]);
  for (const [tid, did] of domainLineage.entries()) {
    if (did === criticalDomain.entity_id) domainEntityIds.add(tid);
  }
  const faultsInDomain = allFaults.filter((f) =>
    f.involved_ids.some((id) => domainEntityIds.has(id)),
  );

  const threadContext = buildLoadBearingThreadContext({
    fulcrumSystem: toSystemShape(fulcrumSystem),
    criticalDomain: toDomainShape(criticalDomain, entityIdByUuid),
    threadsInDomain: threadsInDomain.map((t) => toThreadShape(t, entityIdByUuid)),
    intraDomainEdges: intraDomainEdges.map((e) => toEdgeShape(e, entityIdByUuid)),
    crossDomainEdges: crossDomainEdges.map((e) => toEdgeShape(e, entityIdByUuid)),
    faultsInScope: faultsInDomain,
  });

  llmCalls++;
  console.log(`[layered-synthesis] Stage 3: load-bearing thread (${threadsInDomain.length} candidates)`);
  const threadPick = await llmJSON<ThreadStageOutput>({
    system: SYNTHESIS_STAGE_LOAD_BEARING_THREAD,
    user: threadContext,
    maxTokens: 3000,
    temperature: 0.3,
    fallback: {
      load_bearing_thread_id: threadsInDomain[0]?.entity_id ?? "",
      load_bearing_thread_name: threadsInDomain[0]?.name ?? "",
      intervention_point: "",
      why_this_thread: ["Fallback: first thread — LLM synthesis failed"],
      sibling_threads_rejected: [],
      testable_assumptions: [],
      failure_mode: "",
      first_move: "",
      confidence: 0.3,
    },
  });
  console.log(`[layered-synthesis] Stage 3 → thread=${threadPick.load_bearing_thread_id} (${threadPick.load_bearing_thread_name})`);

  // ── Stage 4: Final narrative ──

  const narrativeContext = buildFinalNarrativeContext({
    userInput: params.userInput,
    fulcrumDecision: {
      id: fulcrum.fulcrum_system_id,
      name: fulcrum.fulcrum_system_name,
      case_for: fulcrum.case_for_fulcrum,
    },
    domainDecision: {
      id: domainPick.critical_domain_id,
      name: domainPick.critical_domain_name,
      why: domainPick.why_this_domain,
      tension: domainPick.tension_description,
    },
    threadDecision: {
      id: threadPick.load_bearing_thread_id,
      name: threadPick.load_bearing_thread_name,
      intervention_point: threadPick.intervention_point,
      testable_assumptions: threadPick.testable_assumptions,
      failure_mode: threadPick.failure_mode,
      first_move: threadPick.first_move,
    },
  });

  llmCalls++;
  console.log(`[layered-synthesis] Stage 4: final narrative`);
  const final = await llmJSON<FinalNarrativeOutput>({
    system: SYNTHESIS_STAGE_FINAL_NARRATIVE,
    user: narrativeContext,
    maxTokens: 3500,
    temperature: 0.4,
    fallback: {
      headline: "Synthesis fallback — LLM narrative stage failed",
      narrative: "The layered synthesis reached stage 4 but the narrative generation failed.",
      key_decision: "",
      opposing_view: "",
      confidence: 0.3,
      open_questions: [],
    },
  });

  return {
    stages: { fulcrum, domain: domainPick, thread: threadPick, final },
    stats: {
      llm_calls: llmCalls,
      systems_considered: systems.length,
      domains_considered: domainsInFulcrum.length,
      threads_considered: threadsInDomain.length,
      duration_ms: Date.now() - startedAt,
    },
  };
}
