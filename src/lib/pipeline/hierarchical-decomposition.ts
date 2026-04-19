// ── Hierarchical decomposition orchestration ──
// Runs the three-pass layered flow: systems → domains → threads. Each pass
// produces entities + edges for one dimensional layer. Structural edges
// (composes) between layers are generated deterministically here — the LLM
// never has to emit them, which saves tokens and eliminates noise.
//
// The orchestrator does NOT write to the database. It produces a fully
// built-up graph shape that the route can pass through the existing sanitize
// + insert pipeline, preserving the topology-equal merge, fault
// materialization, and evidence-basis extraction that the flat decompose
// already uses.

import { llmJSON } from "@/lib/llm";
import {
  HIERARCHICAL_SYSTEMS_PROMPT,
  HIERARCHICAL_DOMAINS_PROMPT,
  HIERARCHICAL_THREADS_PROMPT,
  buildDomainsContext,
  buildThreadsContext,
} from "@/lib/prompts/hierarchical";

// ── LLM output shapes ──

interface SystemEntity {
  entity_id: string;
  name: string;
  description: string;
  layer: "system";
  importance?: string;
  confidence?: number;
  why_it_matters?: string;
}

interface CrossSystemTension {
  source_system_id: string;
  target_system_id: string;
  tension_description: string;
  relationship_type: string;
}

interface SystemsPassResult {
  systems: SystemEntity[];
  cross_system_tensions?: CrossSystemTension[];
  metadata: {
    name: string;
    description: string;
    synthesis_text?: string;
  };
}

interface DomainEntity {
  entity_id: string;
  name: string;
  description: string;
  layer: "domain";
  importance?: string;
  confidence?: number;
  parent_system_id: string;
}

interface IntraSystemEdge {
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  dimension?: string;
  reasoning?: string;
  topology?: string;
}

interface DomainsPassResult {
  domains: DomainEntity[];
  intra_system_edges?: IntraSystemEdge[];
}

interface ThreadEntity {
  entity_id: string;
  name: string;
  description: string;
  layer: "thread";
  importance?: string;
  confidence?: number;
  parent_domain_id: string;
  intervention_point?: string;
}

interface SemanticEdge {
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  dimension?: string;
  strength?: number;
  confidence?: number;
  reasoning?: string;
  polarity?: string;
  topology?: string;
}

interface CrossDomainEdge {
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  reasoning?: string;
}

interface ThreadContradiction {
  assumption_text?: string;
  conclusion_text?: string;
  severity?: string;
  description?: string;
  involved_entity_ids?: string[];
}

interface ThreadsPassResult {
  threads: ThreadEntity[];
  semantic_edges?: SemanticEdge[];
  cross_domain_edges?: CrossDomainEdge[];
  contradictions?: ThreadContradiction[];
}

// ── Public output shape ──

export interface HierarchicalGraph {
  metadata: {
    name: string;
    description: string;
    synthesis_text?: string;
  };
  // Flat list of all entities across all layers. Each carries a `layer` field.
  entities: Array<{
    entity_id: string;
    name: string;
    description: string;
    layer: "system" | "domain" | "thread";
    importance: string;
    confidence: number;
    entity_category: "concrete" | "abstract" | "process" | "relational" | "epistemic";
    entity_type: string;
    source_tag: "implicit" | "explicit";
    parent_entity_id?: string;
    knowledge_layer?: string;
    // Extra metadata we keep for downstream consumers.
    provenance?: Record<string, unknown>;
  }>;
  edges: Array<{
    source_entity_id: string;
    target_entity_id: string;
    relationship_type: string;
    dimension: string;
    source_tag: "inferred" | "stated";
    polarity: string;
    strength: number;
    confidence: number;
    topology?: string;
    reasoning?: string;
  }>;
  contradictions: Array<{
    assumption_text?: string;
    conclusion_text?: string;
    severity?: string;
    description?: string;
    involved_entity_ids?: string[];
  }>;
  stats: {
    systems: number;
    domains: number;
    threads: number;
    composes_edges: number;
    semantic_edges: number;
    cross_domain_edges: number;
    cross_system_edges: number;
    llm_calls: number;
    domain_calls_failed: number;
    thread_calls_failed: number;
  };
}

export interface HierarchicalOptions {
  userInput: string;
  spaceConfig?: { name?: string; description?: string };
  // Safety caps so a runaway LLM can't balloon the graph.
  maxSystems: number;    // default 12
  maxDomainsPerSystem: number; // default 5
  maxThreadsPerDomain: number; // default 4
  // LLM model overrides (optional)
  systemsModel?: string;
  domainsModel?: string;
  threadsModel?: string;
}

const DEFAULT_OPTS = {
  maxSystems: 12,
  maxDomainsPerSystem: 5,
  maxThreadsPerDomain: 4,
};

// ── Helper: infer entity_category from layer + name keywords ──
// At the layer level every entity is abstract-by-default. This only exists
// so sanitize.ts gets something non-null; the LLM can override per entity.

function inferCategoryForLayer(
  layer: "system" | "domain" | "thread",
  description: string,
): "concrete" | "abstract" | "process" | "relational" | "epistemic" {
  const d = description.toLowerCase();
  if (layer === "thread") {
    // Threads often describe processes, tensions, or causal chains.
    if (/tension|tradeoff|conflict|balance/.test(d)) return "relational";
    if (/chain|pipeline|workflow|process|cycle|flow/.test(d)) return "process";
    if (/assumption|unknown|belief|hypothesis|risk/.test(d)) return "epistemic";
    return "process";
  }
  // Systems and domains are typically abstract organizing concepts.
  return "abstract";
}

// ── Main orchestrator ──

export async function runHierarchicalDecomposition(
  options: HierarchicalOptions,
): Promise<HierarchicalGraph> {
  const opts = { ...DEFAULT_OPTS, ...options };
  const stats = {
    systems: 0,
    domains: 0,
    threads: 0,
    composes_edges: 0,
    semantic_edges: 0,
    cross_domain_edges: 0,
    cross_system_edges: 0,
    llm_calls: 0,
    domain_calls_failed: 0,
    thread_calls_failed: 0,
  };

  const entities: HierarchicalGraph["entities"] = [];
  const edges: HierarchicalGraph["edges"] = [];
  const contradictions: HierarchicalGraph["contradictions"] = [];

  // ── Pass A: Systems ──

  console.log(`[hierarchical] Pass A (systems): starting`);
  stats.llm_calls++;
  const systemsResult = await llmJSON<SystemsPassResult>({
    system: HIERARCHICAL_SYSTEMS_PROMPT,
    user: `INPUT TO DECOMPOSE:\n${opts.userInput}${opts.spaceConfig?.name ? `\n\nSpace name hint: ${opts.spaceConfig.name}` : ""}${opts.spaceConfig?.description ? `\nSpace description hint: ${opts.spaceConfig.description}` : ""}`,
    model: opts.systemsModel,
    maxTokens: 6000,
    temperature: 0.3,
    fallback: { systems: [], metadata: { name: opts.spaceConfig?.name ?? "Analysis", description: opts.spaceConfig?.description ?? "" } },
  });

  const systems = (systemsResult.systems ?? [])
    .filter((s) => s && typeof s.entity_id === "string" && typeof s.name === "string")
    .slice(0, opts.maxSystems);

  if (systems.length === 0) {
    console.warn(`[hierarchical] Pass A produced 0 systems — aborting`);
    return {
      metadata: systemsResult.metadata ?? { name: "Analysis", description: "" },
      entities: [],
      edges: [],
      contradictions: [],
      stats,
    };
  }

  stats.systems = systems.length;
  console.log(`[hierarchical] Pass A produced ${systems.length} systems`);

  for (const s of systems) {
    entities.push({
      entity_id: s.entity_id,
      name: s.name,
      description: s.description,
      layer: "system",
      importance: s.importance ?? "critical",
      confidence: typeof s.confidence === "number" ? s.confidence : 0.8,
      entity_category: "abstract",
      entity_type: "system",
      source_tag: "implicit",
      knowledge_layer: "internal",
      provenance: {
        source_type: "hierarchical_pass_a",
        why_it_matters: s.why_it_matters,
      },
    });
  }

  // Cross-system tensions → direct edges between systems.
  for (const t of systemsResult.cross_system_tensions ?? []) {
    if (!t.source_system_id || !t.target_system_id) continue;
    edges.push({
      source_entity_id: t.source_system_id,
      target_entity_id: t.target_system_id,
      relationship_type: t.relationship_type ?? "in_tension_with",
      dimension: "logical",
      source_tag: "inferred",
      polarity: "negative",
      strength: 0.6,
      confidence: 0.7,
      reasoning: t.tension_description,
      topology: t.relationship_type === "contradicts" ? "disjoint" : "meets",
    });
    stats.cross_system_edges++;
  }

  // ── Pass B: Domains (parallel across systems) ──

  console.log(`[hierarchical] Pass B (domains): running ${systems.length} parallel calls`);
  const domainsResults = await Promise.allSettled(
    systems.map(async (parent) => {
      stats.llm_calls++;
      const result = await llmJSON<DomainsPassResult>({
        system: HIERARCHICAL_DOMAINS_PROMPT,
        user: buildDomainsContext({
          userInput: opts.userInput,
          spaceName: systemsResult.metadata?.name ?? "Analysis",
          spaceDescription: systemsResult.metadata?.description ?? "",
          parentSystem: parent,
          siblingSystems: systems,
        }),
        model: opts.domainsModel,
        maxTokens: 4000,
        temperature: 0.3,
        fallback: { domains: [] },
      });
      return { parent, result };
    }),
  );

  for (const r of domainsResults) {
    if (r.status === "rejected") {
      stats.domain_calls_failed++;
      console.warn(`[hierarchical] Domain pass failed:`, r.reason);
      continue;
    }
    const { parent, result } = r.value;
    const kept = (result.domains ?? [])
      .filter((d) => d && typeof d.entity_id === "string" && typeof d.name === "string")
      .slice(0, opts.maxDomainsPerSystem);

    for (const d of kept) {
      entities.push({
        entity_id: d.entity_id,
        name: d.name,
        description: d.description,
        layer: "domain",
        importance: d.importance ?? "important",
        confidence: typeof d.confidence === "number" ? d.confidence : 0.75,
        entity_category: "abstract",
        entity_type: "domain",
        source_tag: "implicit",
        parent_entity_id: parent.entity_id,
        knowledge_layer: "internal",
        provenance: { source_type: "hierarchical_pass_b", parent_system_id: parent.entity_id },
      });
      // Deterministic structural edge: parent system composes child domain.
      edges.push({
        source_entity_id: parent.entity_id,
        target_entity_id: d.entity_id,
        relationship_type: "has_component",
        dimension: "structural",
        source_tag: "inferred",
        polarity: "positive",
        strength: 1.0,
        confidence: 1.0,
        topology: "composes",
      });
      stats.composes_edges++;
      stats.domains++;
    }

    // Intra-system edges between domains emitted by the LLM.
    for (const e of result.intra_system_edges ?? []) {
      if (!e.source_entity_id || !e.target_entity_id) continue;
      edges.push({
        source_entity_id: e.source_entity_id,
        target_entity_id: e.target_entity_id,
        relationship_type: e.relationship_type ?? "related_to",
        dimension: e.dimension ?? "functional",
        source_tag: "inferred",
        polarity: "neutral",
        strength: 0.6,
        confidence: 0.7,
        reasoning: e.reasoning,
        topology: e.topology,
      });
      stats.semantic_edges++;
    }
  }

  if (stats.domains === 0) {
    console.warn(`[hierarchical] Pass B produced 0 domains — returning systems-only graph`);
    return {
      metadata: systemsResult.metadata,
      entities,
      edges,
      contradictions,
      stats,
    };
  }
  console.log(`[hierarchical] Pass B produced ${stats.domains} domains across ${systems.length} systems`);

  // ── Pass C: Threads (parallel across domains) ──

  const domainEntities = entities.filter((e): e is typeof e & { layer: "domain" } => e.layer === "domain");
  const domainsBySystem = new Map<string, typeof domainEntities>();
  for (const d of domainEntities) {
    const key = d.parent_entity_id ?? "unknown";
    const arr = domainsBySystem.get(key) ?? [];
    arr.push(d);
    domainsBySystem.set(key, arr);
  }

  console.log(`[hierarchical] Pass C (threads): running ${domainEntities.length} parallel calls`);
  const threadsResults = await Promise.allSettled(
    domainEntities.map(async (parentDomain) => {
      stats.llm_calls++;
      const parentSys = systems.find((s) => s.entity_id === parentDomain.parent_entity_id);
      if (!parentSys) return null;

      const siblings = (domainsBySystem.get(parentDomain.parent_entity_id ?? "") ?? [])
        .filter((d) => d.entity_id !== parentDomain.entity_id)
        .map((d) => ({ entity_id: d.entity_id, name: d.name }));

      const result = await llmJSON<ThreadsPassResult>({
        system: HIERARCHICAL_THREADS_PROMPT,
        user: buildThreadsContext({
          userInput: opts.userInput,
          spaceName: systemsResult.metadata?.name ?? "Analysis",
          parentSystem: parentSys,
          parentDomain: {
            entity_id: parentDomain.entity_id,
            name: parentDomain.name,
            description: parentDomain.description,
          },
          siblingDomains: siblings,
        }),
        model: opts.threadsModel,
        maxTokens: 4000,
        temperature: 0.3,
        fallback: { threads: [] },
      });
      return { parentDomain, result };
    }),
  );

  for (const r of threadsResults) {
    if (r.status === "rejected" || !r.value) {
      stats.thread_calls_failed++;
      if (r.status === "rejected") console.warn(`[hierarchical] Thread pass failed:`, r.reason);
      continue;
    }
    const { parentDomain, result } = r.value;
    const kept = (result.threads ?? [])
      .filter((t) => t && typeof t.entity_id === "string" && typeof t.name === "string")
      .slice(0, opts.maxThreadsPerDomain);

    for (const t of kept) {
      entities.push({
        entity_id: t.entity_id,
        name: t.name,
        description: t.description,
        layer: "thread",
        importance: t.importance ?? "important",
        confidence: typeof t.confidence === "number" ? t.confidence : 0.75,
        entity_category: inferCategoryForLayer("thread", t.description ?? ""),
        entity_type: "thread",
        source_tag: "implicit",
        parent_entity_id: parentDomain.entity_id,
        knowledge_layer: "internal",
        provenance: {
          source_type: "hierarchical_pass_c",
          parent_domain_id: parentDomain.entity_id,
          intervention_point: t.intervention_point,
        },
      });
      // Deterministic structural edge: domain composes thread.
      edges.push({
        source_entity_id: parentDomain.entity_id,
        target_entity_id: t.entity_id,
        relationship_type: "has_component",
        dimension: "structural",
        source_tag: "inferred",
        polarity: "positive",
        strength: 1.0,
        confidence: 1.0,
        topology: "composes",
      });
      stats.composes_edges++;
      stats.threads++;
    }

    // Semantic edges between threads in this domain.
    for (const e of result.semantic_edges ?? []) {
      if (!e.source_entity_id || !e.target_entity_id) continue;
      edges.push({
        source_entity_id: e.source_entity_id,
        target_entity_id: e.target_entity_id,
        relationship_type: e.relationship_type ?? "related_to",
        dimension: e.dimension ?? "causal",
        source_tag: "inferred",
        polarity: e.polarity ?? "positive",
        strength: typeof e.strength === "number" ? e.strength : 0.6,
        confidence: typeof e.confidence === "number" ? e.confidence : 0.7,
        reasoning: e.reasoning,
        topology: e.topology,
      });
      stats.semantic_edges++;
    }

    // Cross-domain edges — added as-is; validity is checked at edge insert time
    // by sanitizeEdge which drops any edge referencing a non-existent entity.
    for (const e of result.cross_domain_edges ?? []) {
      if (!e.source_entity_id || !e.target_entity_id) continue;
      edges.push({
        source_entity_id: e.source_entity_id,
        target_entity_id: e.target_entity_id,
        relationship_type: e.relationship_type ?? "related_to",
        dimension: "functional",
        source_tag: "inferred",
        polarity: "neutral",
        strength: 0.5,
        confidence: 0.6,
        reasoning: e.reasoning,
      });
      stats.cross_domain_edges++;
    }

    for (const c of result.contradictions ?? []) {
      contradictions.push(c);
    }
  }

  console.log(`[hierarchical] Pass C produced ${stats.threads} threads; ${stats.semantic_edges} semantic + ${stats.cross_domain_edges} cross-domain edges; ${contradictions.length} contradictions`);
  console.log(`[hierarchical] Totals — entities=${entities.length} edges=${edges.length} llm_calls=${stats.llm_calls} failed(domain/thread)=${stats.domain_calls_failed}/${stats.thread_calls_failed}`);

  return {
    metadata: systemsResult.metadata,
    entities,
    edges,
    contradictions,
    stats,
  };
}
