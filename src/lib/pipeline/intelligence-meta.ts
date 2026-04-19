/**
 * Meta-Intelligence Engine
 *
 * LLM-powered computation that extracts higher-order intelligence from
 * the knowledge graph:
 * 1. Decision specificity: converts signals → concrete v2 decision forks
 * 2. Core tension, unknowns, contradictions
 * 3. Structural patterns (triads, archetypes)
 *
 * Called from the intelligence-feedback API route after intersection
 * analysis completes. Results stored in synthesis_data.intelligence_radar_v2.
 */

import { llmGenerate } from "@/lib/llm";
import type { Entity, Edge, Cycle } from "@/types";
import type { IntelligenceSignal, ConnectionAnalysis } from "@/types/intelligence";
import type { SpaceIntersection } from "@/types/probability-space";
import type {
  PriorityDecisionV2,
  CoreTension,
  UnknownItem,
  ContradictionItem,
  TriadFinding,
  ArchetypeMatch,
  LandscapeCluster,
  IntelligenceRadarDataV2,
} from "@/types/intelligence-v2";
import type { IntelligenceNarrative } from "@/types/intelligence-v2";
import type { SignalExtractionResult } from "@/lib/intelligence/signal-extraction";
import {
  getDecisionSpecificityPrompt,
  getMetaIntelligencePrompt,
  getStructuralPatternsPrompt,
  getNarrativeSynthesisPrompt,
  getLandscapeClusteringPrompt,
} from "@/lib/prompts/intelligence-decisions";
import { getLayerLabel, isCrossLayer } from "@/lib/intelligence/layer-semantics";

// ── JSON parsing helper ──

function parseJSON(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch?.[1]) return JSON.parse(fenceMatch[1].trim());
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error(`Failed to parse JSON: ${raw.slice(0, 200)}`);
  }
}

// ── Context builders ──

function describeEntity(e: Entity): string {
  const tags: string[] = [];
  if (e.is_leverage_point) tags.push("leverage");
  if (e.is_risk_point) tags.push("risk");
  if (e.is_master_bottleneck) tags.push("bottleneck");
  if (e.importance) tags.push(e.importance);
  const layerLabel = getLayerLabel(e.knowledge_layer);
  const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
  return `[${layerLabel}] ${e.entity_id}: ${e.name} (${e.entity_type})${tagStr}`;
}

function describeEdge(
  edge: Edge,
  nameMap: Map<string, string>,
  entityLayerMap?: Map<string, string>,
): string {
  const src = nameMap.get(edge.source_entity_id) ?? edge.source_entity_id;
  const tgt = nameMap.get(edge.target_entity_id) ?? edge.target_entity_id;
  const conf = edge.confidence ? ` [conf: ${Math.round(edge.confidence * 100)}%]` : "";
  // Tag cross-layer edges
  let crossTag = "";
  if (entityLayerMap) {
    const srcLayer = entityLayerMap.get(edge.source_entity_id);
    const tgtLayer = entityLayerMap.get(edge.target_entity_id);
    if (srcLayer && tgtLayer && isCrossLayer(srcLayer, tgtLayer)) {
      crossTag = " [CROSS-LAYER]";
    }
  }
  return `${src} → ${tgt} (${edge.relationship_type ?? "connected"})${conf}${crossTag}`;
}

function describeSignal(s: IntelligenceSignal): string {
  return `[${s.severity}] ${s.entity_name}: ${s.description} (${s.type}, ${s.status ?? "active"})`;
}

function describeCycle(c: Cycle, nameMap: Map<string, string>): string {
  const names = c.entity_ids?.map((id: string) => nameMap.get(id) ?? id).join(" → ") ?? "unknown";
  return `${c.classification ?? "reinforcing_positive"} loop: ${c.name ?? names}`;
}

// ── Step 1: Decision Specificity ──

async function computeDecisionSpecificity(params: {
  signals: IntelligenceSignal[];
  entities: Entity[];
  edges: Edge[];
  nameMap: Map<string, string>;
  strategyContext: string;
  maxDecisions: number;
}): Promise<PriorityDecisionV2[]> {
  const { signals, entities, edges, nameMap, strategyContext, maxDecisions } = params;

  // Only process actionable signals
  const actionable = signals.filter(
    (s) => s.status !== "dismissed" && s.status !== "resolved"
  );
  if (actionable.length === 0) return [];

  const signalDescriptions = actionable.slice(0, 10).map(describeSignal);

  // Build connection summaries for signal entities
  const connectionSummaries: string[] = [];
  for (const sig of actionable.slice(0, 6)) {
    const relatedEdges = edges.filter(
      (e) => e.source_entity_id === sig.entity_id || e.target_entity_id === sig.entity_id
    );
    if (relatedEdges.length > 0) {
      connectionSummaries.push(
        `${sig.entity_name}: ${relatedEdges.slice(0, 3).map((e) => describeEdge(e, nameMap)).join("; ")}`
      );
    }
  }

  const entityNames = [...new Set(actionable.map((s) => s.entity_name))];

  const prompt = getDecisionSpecificityPrompt({
    signalDescriptions,
    connectionSummaries,
    strategyContext,
    entityNames,
    maxDecisions: Math.min(maxDecisions, 6),
  });

  try {
    const raw = await llmGenerate({
      system: prompt.system,
      user: prompt.user,
      model: "gpt-4o-mini",
      temperature: 0.3,
      maxTokens: 4000,
    });

    const parsed = parseJSON(raw);
    const rawDecisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];

    return rawDecisions.map((d: Record<string, unknown>, i: number) => {
      const options = Array.isArray(d.options) ? d.options : [];
      return {
        id: `decision_v2_${i}`,
        entity_id: String(d.entity_id ?? ""),
        entity_name: String(d.entity_name ?? ""),
        decision_question: String(d.decision_question ?? ""),
        options: options.map((o: Record<string, unknown>) => ({
          id: String(o.id ?? `opt_${i}`),
          label: String(o.label ?? ""),
          description: String(o.description ?? ""),
          upside: o.upside ? String(o.upside) : undefined,
          downside: o.downside ? String(o.downside) : undefined,
          effort: (o.effort as "low" | "medium" | "high") ?? undefined,
          reversibility: (o.reversibility as "high" | "medium" | "low") ?? undefined,
        })),
        tradeoffs: Array.isArray(d.tradeoffs) ? d.tradeoffs.map(String) : [],
        recommended_option_id: String(d.recommended_option_id ?? options[0]?.id ?? ""),
        recommended_reason: String(d.recommended_reason ?? ""),
        next_action: String(d.next_action ?? ""),
        due_window: (d.due_window as "now" | "this_week" | "this_month") ?? "this_week",
        confidence: typeof d.confidence === "number" ? d.confidence : 0.5,
        evidence_level: (d.evidence_level as "stated" | "inferred" | "predicted") ?? "inferred",
        evidence_refs: Array.isArray(d.evidence_refs) ? d.evidence_refs.map(String) : [],
        affected_entities: Array.isArray(d.affected_entities) ? d.affected_entities.map(String) : [],
        core_tension_alignment: 0, // populated after core tension computation
      } satisfies PriorityDecisionV2;
    });
  } catch (err) {
    console.error("[intelligence-meta] Decision specificity failed:", err);
    return [];
  }
}

// ─�� Step 2: Meta-Intelligence (Core Tension + Unknowns + Contradictions) ──

async function computeCoreMeta(params: {
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  signals: IntelligenceSignal[];
  nameMap: Map<string, string>;
  entityLayerMap?: Map<string, string>;
}): Promise<{
  core_tension: CoreTension | undefined;
  unknowns: UnknownItem[];
  contradictions: ContradictionItem[];
}> {
  const { entities, edges, cycles, signals, nameMap, entityLayerMap } = params;

  const entitySummaries = entities.slice(0, 25).map(describeEntity);
  const edgeSummaries = edges.slice(0, 20).map((e) => describeEdge(e, nameMap, entityLayerMap));
  const cycleSummaries = cycles.slice(0, 5).map((c) => describeCycle(c, nameMap));
  const signalSummaries = signals.slice(0, 8).map(describeSignal);

  const leveragePoints = entities
    .filter((e) => e.is_leverage_point)
    .map((e) => e.name);
  const riskPoints = entities
    .filter((e) => e.is_risk_point)
    .map((e) => e.name);

  const prompt = getMetaIntelligencePrompt({
    entitySummaries,
    edgeSummaries,
    signalSummaries,
    leveragePoints,
    riskPoints,
    cycleSummaries,
  });

  try {
    const raw = await llmGenerate({
      system: prompt.system,
      user: prompt.user,
      model: "gpt-4o-mini",
      temperature: 0.2,
      maxTokens: 3000,
    });

    const parsed = parseJSON(raw);

    // Core tension
    const rawTension = parsed.core_tension as Record<string, unknown> | undefined;
    const core_tension: CoreTension | undefined = rawTension
      ? {
          title: String(rawTension.title ?? ""),
          description: String(rawTension.description ?? ""),
          entity_ids: Array.isArray(rawTension.entity_ids)
            ? rawTension.entity_ids.map(String)
            : [],
        }
      : undefined;

    // Unknowns
    const rawUnknowns = Array.isArray(parsed.unknowns) ? parsed.unknowns : [];
    const unknowns: UnknownItem[] = rawUnknowns.map(
      (u: Record<string, unknown>, i: number) => ({
        id: String(u.id ?? `unk_${i}`),
        question: String(u.question ?? ""),
        impact: (u.impact as "low" | "medium" | "high") ?? "medium",
        next_probe: String(u.next_probe ?? ""),
        status: (u.status as "open" | "investigating" | "resolved") ?? "open",
      })
    );

    // Contradictions
    const rawContradictions = Array.isArray(parsed.contradictions) ? parsed.contradictions : [];
    const contradictions: ContradictionItem[] = rawContradictions.map(
      (c: Record<string, unknown>, i: number) => ({
        id: String(c.id ?? `contra_${i}`),
        a: String(c.a ?? ""),
        b: String(c.b ?? ""),
        why_it_matters: String(c.why_it_matters ?? ""),
        resolution_paths: Array.isArray(c.resolution_paths)
          ? c.resolution_paths.map(String)
          : [],
        confidence: typeof c.confidence === "number" ? c.confidence : undefined,
      })
    );

    return { core_tension, unknowns, contradictions };
  } catch (err) {
    console.error("[intelligence-meta] Meta-intelligence failed:", err);
    return { core_tension: undefined, unknowns: [], contradictions: [] };
  }
}

// ── Step 3: Structural Patterns ──

async function computeStructuralPatterns(params: {
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  intersections: SpaceIntersection[];
  nameMap: Map<string, string>;
  entityLayerMap?: Map<string, string>;
  /** V1 signal extraction results — deterministic structural findings to enrich */
  signalExtractionResult?: SignalExtractionResult | null;
}): Promise<{
  triads: TriadFinding[];
  archetype_matches: ArchetypeMatch[];
}> {
  const { entities, edges, cycles, intersections, nameMap, entityLayerMap, signalExtractionResult } = params;

  // Only run if graph is rich enough
  if (entities.length < 5 || edges.length < 5) {
    return { triads: [], archetype_matches: [] };
  }

  const entitySummaries = entities.slice(0, 20).map(describeEntity);
  const edgeSummaries = edges.slice(0, 20).map((e) => describeEdge(e, nameMap, entityLayerMap));
  const cycleSummaries = cycles.slice(0, 5).map((c) => describeCycle(c, nameMap));
  const intersectionSummaries = intersections.slice(0, 8).map(
    (ix) => `${ix.space_a_label} ∩ ${ix.space_b_label}: ${ix.shared_nodes.map((n) => n.name).join(", ")} (novelty: ${ix.novelty_score.toFixed(2)}, impact: ${ix.impact_score.toFixed(2)})`
  );

  // Feed V1 deterministic findings as context to V2 LLM
  const v1Context: string[] = [];
  if (signalExtractionResult) {
    const { structural_holes, cascade_vulnerabilities, flip_prone_loops, hidden_variables } = signalExtractionResult;
    if (structural_holes.length > 0) {
      v1Context.push(
        `STRUCTURAL HOLES (deterministic detection):`,
        ...structural_holes.slice(0, 5).map(
          (h) => `  - ${h.entity_a_name} ↔ ${h.entity_b_name}: ${h.shared_neighbors} shared neighbors. ${h.reasoning}`
        ),
      );
    }
    if (cascade_vulnerabilities.length > 0) {
      v1Context.push(
        `CASCADE VULNERABILITIES (deterministic detection):`,
        ...cascade_vulnerabilities.slice(0, 5).map(
          (v) => `  - ${v.entity_name}: ${v.downstream_count} downstream, ${v.severity} severity, redundancy=${v.has_redundancy}`
        ),
      );
    }
    if (flip_prone_loops.length > 0) {
      v1Context.push(
        `FLIP-PRONE LOOPS (deterministic detection):`,
        ...flip_prone_loops.slice(0, 3).map(
          (l) => `  - ${l.cycle_entity_ids.join("→")}: ${l.current_type}, weakest edge confidence ${l.weakest_edge_confidence.toFixed(2)}`
        ),
      );
    }
    if (hidden_variables.length > 0) {
      v1Context.push(
        `HIDDEN VARIABLES (deterministic detection):`,
        ...hidden_variables.slice(0, 3).map(
          (h) => `  - Between ${h.between_entity_names[0]} and ${h.between_entity_names[1]}: inferred "${h.inferred_name}" — ${h.mediation_mechanism}`
        ),
      );
    }
  }

  const prompt = getStructuralPatternsPrompt({
    entitySummaries,
    edgeSummaries,
    cycleSummaries,
    intersectionSummaries,
    ...(v1Context.length > 0 ? { v1DetectorContext: v1Context } : {}),
  });

  try {
    const raw = await llmGenerate({
      system: prompt.system,
      user: prompt.user,
      model: "gpt-4o-mini",
      temperature: 0.2,
      maxTokens: 3000,
    });

    const parsed = parseJSON(raw);

    const rawTriads = Array.isArray(parsed.triads) ? parsed.triads : [];
    const triads: TriadFinding[] = rawTriads.map(
      (t: Record<string, unknown>, i: number) => ({
        id: String(t.id ?? `triad_${i}`),
        a: String(t.a ?? ""),
        b: String(t.b ?? ""),
        c: String(t.c ?? ""),
        pattern_type: (t.pattern_type as TriadFinding["pattern_type"]) ?? "mediator",
        confidence: typeof t.confidence === "number" ? t.confidence : 0.5,
        rationale: t.rationale ? String(t.rationale) : undefined,
      })
    );

    const rawArchetypes = Array.isArray(parsed.archetype_matches) ? parsed.archetype_matches : [];
    const archetype_matches: ArchetypeMatch[] = rawArchetypes.map(
      (a: Record<string, unknown>, i: number) => ({
        id: String(a.id ?? `arch_${i}`),
        name: (a.name as ArchetypeMatch["name"]) ?? "bottleneck",
        fit_score: typeof a.fit_score === "number" ? a.fit_score : 0.5,
        evidence: Array.isArray(a.evidence) ? a.evidence.map(String) : [],
        counterevidence: Array.isArray(a.counterevidence) ? a.counterevidence.map(String) : [],
      })
    );

    return { triads, archetype_matches };
  } catch (err) {
    console.error("[intelligence-meta] Structural patterns failed:", err);
    return { triads: [], archetype_matches: [] };
  }
}

// ── Step 4: Narrative Synthesis ──

async function computeNarrativeSynthesis(params: {
  decisions: PriorityDecisionV2[];
  core_tension: CoreTension | undefined;
  unknowns: UnknownItem[];
  contradictions: ContradictionItem[];
  triads: TriadFinding[];
  archetypes: ArchetypeMatch[];
  signalCount: number;
  entityCount: number;
}): Promise<IntelligenceNarrative | undefined> {
  const {
    decisions,
    core_tension,
    unknowns,
    contradictions,
    triads,
    archetypes,
    signalCount,
    entityCount,
  } = params;

  // Only run if there are enough findings to synthesize
  const findingsCount =
    (core_tension ? 1 : 0) +
    unknowns.length +
    contradictions.length +
    decisions.length +
    triads.length +
    archetypes.length;

  if (findingsCount < 2) return undefined;

  const prompt = getNarrativeSynthesisPrompt({
    coreTensionTitle: core_tension?.title ?? null,
    coreTensionDescription: core_tension?.description ?? null,
    unknownQuestions: unknowns.slice(0, 5).map((u) => u.question),
    contradictionSummaries: contradictions.slice(0, 4).map(
      (c) => `"${c.a}" vs "${c.b}" — ${c.why_it_matters}`
    ),
    decisionQuestions: decisions.slice(0, 5).map((d) => d.decision_question),
    triadDescriptions: triads.slice(0, 4).map(
      (t) => `${t.pattern_type}: ${t.a} → ${t.b} → ${t.c}${t.rationale ? ` (${t.rationale})` : ""}`
    ),
    archetypeDescriptions: archetypes.slice(0, 3).map(
      (a) => `${a.name} (fit: ${Math.round(a.fit_score * 100)}%): evidence=${a.evidence.join(", ")}`
    ),
    signalCount,
    entityCount,
  });

  try {
    const raw = await llmGenerate({
      system: prompt.system,
      user: prompt.user,
      model: "gpt-4o-mini",
      temperature: 0.3,
      maxTokens: 1500,
    });

    const parsed = parseJSON(raw);

    const rawAttentionItems = Array.isArray(parsed.attention_items) ? parsed.attention_items : [];

    return {
      executive_summary: String(parsed.executive_summary ?? ""),
      change_summary: parsed.change_summary ? String(parsed.change_summary) : null,
      attention_items: rawAttentionItems.slice(0, 5).map(
        (item: Record<string, unknown>) => ({
          title: String(item.title ?? ""),
          reason: String(item.reason ?? ""),
          entity_ids: Array.isArray(item.entity_ids) ? item.entity_ids.map(String) : [],
          source: (item.source as IntelligenceNarrative["attention_items"][number]["source"]) ?? "signal",
        })
      ),
      generated_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[intelligence-meta] Narrative synthesis failed:", err);
    return undefined;
  }
}

// ── Landscape Clustering ──

async function computeLandscapeClusters(params: {
  entities: Entity[];
  edges: Edge[];
  nameMap: Map<string, string>;
  entityLayerMap: Map<string, string>;
  coreTensionTitle: string | null;
}): Promise<LandscapeCluster[]> {
  const { entities, edges, nameMap, entityLayerMap, coreTensionTitle } = params;

  if (entities.length < 3) return [];

  const entityDescriptions = entities.slice(0, 60).map((e) => describeEntity(e));
  const edgeSummaries = edges.slice(0, 30).map((e) =>
    describeEdge(e, nameMap, entityLayerMap)
  );

  const prompt = getLandscapeClusteringPrompt({
    entityDescriptions,
    edgeSummaries,
    coreTensionTitle,
  });

  try {
    const raw = await llmGenerate({
      system: prompt.system,
      user: prompt.user,
      model: "gpt-4o-mini",
      temperature: 0.3,
      maxTokens: 1500,
    });

    const parsed = parseJSON(raw);
    const rawClusters = Array.isArray(parsed.clusters) ? parsed.clusters : [];

    return rawClusters
      .filter(
        (c: Record<string, unknown>) =>
          typeof c.id === "string" &&
          typeof c.label === "string" &&
          Array.isArray(c.entity_ids)
      )
      .map((c: Record<string, unknown>) => ({
        id: String(c.id),
        label: String(c.label),
        entity_ids: (c.entity_ids as unknown[]).map(String),
        signal_strength: typeof c.signal_strength === "number" ? c.signal_strength : 0.5,
      }));
  } catch (err) {
    console.error("[intelligence-meta] Landscape clustering failed:", err);
    return [];
  }
}

// ── Main Entry Point ──

export interface ComputeMetaIntelligenceParams {
  entities: Entity[];
  edges: Edge[];
  cycles: Cycle[];
  signals: IntelligenceSignal[];
  intersections: SpaceIntersection[];
  strategyContext: string;
  /** Existing v2 data to preserve fields not recomputed */
  existingV2?: IntelligenceRadarDataV2 | null;
  /** Max LLM-generated decisions (default 5) */
  maxDecisions?: number;
  /** V1 signal extraction results — fed into structural patterns for richer analysis */
  signalExtractionResult?: SignalExtractionResult | null;
}

/**
 * Compute all meta-intelligence in parallel.
 * Returns a full IntelligenceRadarDataV2 payload ready to store
 * in synthesis_data.intelligence_radar_v2.
 *
 * Runs 3 LLM calls in parallel (~$0.006 total at gpt-4o-mini rates).
 */
export async function computeMetaIntelligence(
  params: ComputeMetaIntelligenceParams
): Promise<IntelligenceRadarDataV2> {
  const {
    entities,
    edges,
    cycles,
    signals,
    intersections,
    strategyContext,
    existingV2,
    maxDecisions = 5,
    signalExtractionResult,
  } = params;

  const nameMap = new Map<string, string>();
  const entityLayerMap = new Map<string, string>();
  for (const e of entities) {
    nameMap.set(e.entity_id, e.name);
    nameMap.set(e.id, e.name);
    entityLayerMap.set(e.id, e.knowledge_layer ?? "internal");
    entityLayerMap.set(e.entity_id, e.knowledge_layer ?? "internal");
  }

  // Run all three stages in parallel
  const [decisions, meta, structural] = await Promise.all([
    computeDecisionSpecificity({
      signals,
      entities,
      edges,
      nameMap,
      strategyContext,
      maxDecisions,
    }),
    computeCoreMeta({
      entities,
      edges,
      cycles,
      signals,
      nameMap,
      entityLayerMap,
    }),
    computeStructuralPatterns({
      entities,
      edges,
      cycles,
      intersections,
      nameMap,
      entityLayerMap,
      signalExtractionResult,
    }),
  ]);

  // If core tension exists, align decisions to it
  if (meta.core_tension) {
    const tensionEntitySet = new Set(meta.core_tension.entity_ids);
    for (const d of decisions) {
      const overlap = d.affected_entities.filter((id) => tensionEntitySet.has(id)).length;
      d.core_tension_alignment = tensionEntitySet.size > 0
        ? Math.min(1, overlap / tensionEntitySet.size)
        : 0;
    }
  }

  // Step 4: Generate cross-finding narrative (runs after steps 1-3 complete)
  const narrative = await computeNarrativeSynthesis({
    decisions,
    core_tension: meta.core_tension,
    unknowns: meta.unknowns,
    contradictions: meta.contradictions,
    triads: structural.triads,
    archetypes: structural.archetype_matches,
    signalCount: signals.filter((s) => s.status !== "dismissed" && s.status !== "resolved").length,
    entityCount: entities.length,
  });

  // Step 5: Generate semantic landscape clusters for radar chart
  const landscape_clusters = await computeLandscapeClusters({
    entities,
    edges,
    nameMap,
    entityLayerMap,
    coreTensionTitle: meta.core_tension?.title ?? null,
  });

  return {
    // Preserve existing fields not recomputed
    ...(existingV2 ?? {}),
    // Overwrite computed fields
    priority_decisions_v2: decisions,
    core_tension: meta.core_tension,
    unknowns: meta.unknowns,
    contradictions: meta.contradictions,
    triads: structural.triads,
    archetype_matches: structural.archetype_matches,
    narrative,
    landscape_clusters: landscape_clusters.length > 0 ? landscape_clusters : undefined,
  };
}
