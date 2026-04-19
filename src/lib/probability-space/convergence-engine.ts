// ── Convergence Engine ──
//
// Orchestrates LLM calls to predict the convergent outcome of each planned
// (focal, interactor_set) combination. Bounded-parallel, resilient to
// individual call failures, and produces records ready for insert into the
// convergent_points table.
//
// This is the *outer loop* around your existing edge-level ProbabilitySpace —
// the engine enumerates which combinations are worth computing, then for each
// one emits a single LLM prediction. The edge-level space can still be used
// downstream to drill into the internal mechanism of any (focal, interactor)
// pair a user wants to inspect.

import { llmJSON } from "@/lib/llm";
import {
  CONVERGENCE_PREDICTION_SYSTEM_PROMPT,
  buildConvergencePredictionUserPrompt,
  type ConvergencePredictionContext,
} from "@/lib/prompts/convergence-prediction";
import type { Entity, Edge } from "@/types";
import type {
  ConvergentPoint,
  ConvergentOutcome,
  GenerationMethod,
  InteractorCandidate,
  Role,
  StructuralSignature,
  ConvergentEvidence,
  RetrievedPattern,
} from "@/types/convergent-point";
import { signaturePrefix } from "@/types/convergent-point";

// ── LLM response shape (what the prompt returns) ──

interface ConvergencePredictionResponse {
  outcome: ConvergentOutcome;
  probability: number;
  confidence: number;
  pattern_tag: string | null;
  evidence_basis: Array<{
    type: ConvergentEvidence["type"];
    claim: string;
  }>;
}

// ── Input to engine: a planned combination with all the graph context ──

export interface PlannedConvergence {
  interactor_ids: string[];         // UUIDs of interactor entities
  interactor_tiers: Array<1 | 2 | 3 | 4 | 5>; // parallel to ids
  combination_reason: string;       // why this combination was planned
  external_conditions: string[];    // caller-supplied external context
}

export interface EngineContext {
  focal: Entity;
  focal_roles: Role[];
  // UUID → Entity for interactors + neighborhood
  entitiesByUuid: Map<string, Entity>;
  // All edges in the space (used for filtering to relevant ones per combination)
  allEdges: Edge[];
  // All faults in the space (used to surface ones that implicate these entities)
  allFaults: Entity[];
  // Role-extraction function so we can get roles for interactors on demand.
  rolesFor: (entityUuid: string) => Role[];
  // User objectives (titles only for prompt; full objects used in ranker)
  userObjectives: Array<{ id: string; title: string }>;
  // Pattern library retrievals — keyed by signature prefix
  // (focal_role|sorted_interactor_roles). Phase 2 populates this from
  // retrievePatternsBatch; Phase 1 callers can pass an empty Map.
  retrievedPatterns: Map<string, RetrievedPattern[]>;
}

// ── Helpers ──

function filterRelevantEdges(
  focalUuid: string,
  interactorUuids: string[],
  allEdges: Edge[],
): Edge[] {
  const scope = new Set<string>([focalUuid, ...interactorUuids]);
  return allEdges.filter(
    (e) => scope.has(e.source_entity_id) && scope.has(e.target_entity_id),
  );
}

function filterRelevantFaults(
  scope: Set<string>,
  faults: Entity[],
  entitiesByUuid: Map<string, Entity>,
): Array<{ name: string; description: string }> {
  // Faults store their involved entity display_ids in provenance.involved_entity_ids.
  // We convert to the same scope check via display_id lookup.
  const displayIdsInScope = new Set<string>();
  for (const uuid of scope) {
    const e = entitiesByUuid.get(uuid);
    if (e?.entity_id) displayIdsInScope.add(e.entity_id);
  }
  const relevant: Array<{ name: string; description: string }> = [];
  for (const f of faults) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prov = (f as any).provenance as Record<string, unknown> | null;
    const involved = Array.isArray(prov?.involved_entity_ids)
      ? (prov?.involved_entity_ids as string[])
      : [];
    if (involved.some((id) => displayIdsInScope.has(id))) {
      relevant.push({ name: f.name, description: f.description ?? "" });
    }
  }
  return relevant;
}

function deriveGenerationMethod(tiers: Array<1 | 2 | 3 | 4 | 5>): GenerationMethod {
  // If any tier is 1, prefer empirical. Otherwise pick the lowest-tier label.
  if (tiers.includes(1)) return "empirical_edge";
  if (tiers.includes(2)) return "structural_derivation";
  if (tiers.includes(3)) return "analogical_mapping";
  if (tiers.includes(4)) return "domain_inference";
  return "adversarial";
}

function buildStructuralSignature(
  focalRoles: Role[],
  interactorRoles: Role[][],
  outcome: ConvergentOutcome,
): StructuralSignature {
  // Take the highest-evidence role from focal + each interactor.
  const focalRole = focalRoles[0]?.key ?? "unspecified";
  const interactorRoleKeys = interactorRoles.map((rs) => rs[0]?.key ?? "unspecified");
  return {
    focal_role: focalRole,
    interactor_roles: interactorRoleKeys.sort(),
    outcome_polarity: outcome.polarity,
    outcome_reversibility: outcome.reversibility,
    outcome_time_horizon: outcome.time_horizon,
  };
}

// ── Core predict function ──

export async function predictConvergence(
  planned: PlannedConvergence,
  ctx: EngineContext,
): Promise<{
  focal_entity_id: string;
  interactor_entity_ids: string[];
  external_conditions: string[];
  outcome: ConvergentOutcome;
  probability: number;
  confidence: number;
  generation_method: GenerationMethod;
  pattern_tag: string | null;
  structural_signature: StructuralSignature;
  evidence_basis: ConvergentEvidence[];
} | null> {
  const focalUuid = ctx.focal.id;
  const interactors = planned.interactor_ids
    .map((uuid) => ctx.entitiesByUuid.get(uuid))
    .filter((e): e is Entity => !!e);
  if (interactors.length === 0) return null;

  const scope = new Set<string>([focalUuid, ...planned.interactor_ids]);
  const relevantEdges = filterRelevantEdges(focalUuid, planned.interactor_ids, ctx.allEdges);
  const relevantFaults = filterRelevantFaults(scope, ctx.allFaults, ctx.entitiesByUuid);

  // Per-interactor role extraction (lazy via ctx.rolesFor).
  const interactorRolesList: Role[][] = interactors.map((i) => ctx.rolesFor(i.id));

  // Pattern lookup — use this combination's structural prefix (focal's top role
  // + each interactor's top role). Match against pre-loaded pattern map.
  const focalTopRole = ctx.focal_roles[0]?.key ?? "unspecified";
  const interactorTopRoles = interactorRolesList.map((rs) => rs[0]?.key ?? "unspecified");
  const comboPrefix = signaturePrefix(focalTopRole, interactorTopRoles);
  const matchedPatterns = ctx.retrievedPatterns.get(comboPrefix) ?? [];

  // Edge summaries for the prompt
  const edgeSummaries = relevantEdges.map((e) => {
    const src = ctx.entitiesByUuid.get(e.source_entity_id)?.name ?? "?";
    const tgt = ctx.entitiesByUuid.get(e.target_entity_id)?.name ?? "?";
    return {
      source_name: src,
      target_name: tgt,
      relationship_type: e.relationship_type,
      dimension: e.dimension,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      topology: (e as any).topology as string | null,
      reasoning: typeof e.conditions === "string" ? e.conditions : null,
      confidence: typeof e.confidence === "number" ? e.confidence : undefined,
    };
  });

  const promptCtx: ConvergencePredictionContext = {
    focal: {
      entity_id: ctx.focal.entity_id,
      name: ctx.focal.name,
      description: ctx.focal.description ?? "",
      layer: ctx.focal.layer ?? null,
      roles: ctx.focal_roles.map((r) => ({ key: r.key, label: r.label, question: r.question })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      manifold: (ctx.focal as any).manifold ?? null,
    },
    interactors: interactors.map((i, idx) => ({
      entity_id: i.entity_id,
      name: i.name,
      description: i.description ?? "",
      layer: i.layer ?? null,
      tier: planned.interactor_tiers[idx] ?? 1,
      role_keys: interactorRolesList[idx]?.slice(0, 3).map((r) => r.key),
    })),
    external_conditions: planned.external_conditions,
    relevant_edges: edgeSummaries,
    relevant_faults: relevantFaults,
    known_patterns: matchedPatterns.map((p) => ({
      tag: p.tag,
      canonical_mechanism: p.canonical_mechanism,
      typical_polarity: p.typical_polarity,
    })),
    user_objectives: ctx.userObjectives.map((o) => ({ title: o.title })),
  };

  const fallback: ConvergencePredictionResponse = {
    outcome: {
      description: "LLM prediction failed; no convergent point generated.",
      polarity: "neutral",
      mechanism: "",
      time_horizon: "immediate",
      reversibility: "easily_reversible",
      propagation: "local",
    },
    probability: 0.3,
    confidence: 0.1,
    pattern_tag: null,
    evidence_basis: [],
  };

  let result: ConvergencePredictionResponse;
  try {
    result = await llmJSON<ConvergencePredictionResponse>({
      system: CONVERGENCE_PREDICTION_SYSTEM_PROMPT,
      user: buildConvergencePredictionUserPrompt(promptCtx),
      maxTokens: 1500,
      temperature: 0.3,
      fallback,
    });
  } catch (err) {
    console.warn(`[convergence-engine] Prediction failed for combination ${planned.interactor_ids.join(",")}:`, err);
    return null;
  }

  // Guard against obviously broken responses (empty description or mechanism)
  if (!result.outcome?.description || result.outcome.description.length < 10) {
    console.warn(`[convergence-engine] Response has empty/too-short description; skipping`);
    return null;
  }

  const signature = buildStructuralSignature(ctx.focal_roles, interactorRolesList, result.outcome);

  // Build evidence basis. The LLM contributes claims; we attach concrete
  // source refs for edge-backed ones by matching claim type to edges in scope.
  const evidenceBasis: ConvergentEvidence[] = (result.evidence_basis ?? []).map((ev) => ({
    type: ev.type,
    claim: ev.claim,
    source_entity_ids: [focalUuid, ...planned.interactor_ids],
    source_edge_ids: ev.type === "direct_edge" ? relevantEdges.map((e) => e.id) : undefined,
  }));

  return {
    focal_entity_id: focalUuid,
    interactor_entity_ids: planned.interactor_ids,
    external_conditions: planned.external_conditions,
    outcome: result.outcome,
    probability: Math.max(0, Math.min(1, result.probability ?? 0.5)),
    confidence: Math.max(0, Math.min(1, result.confidence ?? 0.5)),
    generation_method: deriveGenerationMethod(planned.interactor_tiers),
    pattern_tag: result.pattern_tag,
    structural_signature: signature,
    evidence_basis: evidenceBasis,
  };
}

// ── Bounded-parallel engine runner ──

const PARALLELISM = 4; // concurrent LLM calls to the convergence prompt

export async function runConvergenceEngine(
  plans: PlannedConvergence[],
  ctx: EngineContext,
  maxPoints: number,
): Promise<{
  generated: Awaited<ReturnType<typeof predictConvergence>>[];
  stats: { attempted: number; succeeded: number; failed: number };
}> {
  const capped = plans.slice(0, maxPoints);
  const results: Awaited<ReturnType<typeof predictConvergence>>[] = [];
  let succeeded = 0;
  let failed = 0;

  // Run in batches of PARALLELISM
  for (let i = 0; i < capped.length; i += PARALLELISM) {
    const batch = capped.slice(i, i + PARALLELISM);
    const batchResults = await Promise.all(
      batch.map((plan) => predictConvergence(plan, ctx).catch(() => null)),
    );
    for (const r of batchResults) {
      if (r) {
        results.push(r);
        succeeded++;
      } else {
        failed++;
      }
    }
  }

  return {
    generated: results,
    stats: { attempted: capped.length, succeeded, failed },
  };
}

// ── Final shape adapter: make result ready for DB insert ──

export function toConvergentPointRow(
  generated: NonNullable<Awaited<ReturnType<typeof predictConvergence>>>,
  spaceId: string,
): Omit<ConvergentPoint, "id" | "objective_alignment" | "generated_at"> & {
  space_id: string;
  objective_alignment: [];
  generated_at: string;
} {
  return {
    space_id: spaceId,
    focal_entity_id: generated.focal_entity_id,
    interactor_entity_ids: generated.interactor_entity_ids,
    external_conditions: generated.external_conditions,
    outcome: generated.outcome,
    probability: generated.probability,
    confidence: generated.confidence,
    generation_method: generated.generation_method,
    pattern_tag: generated.pattern_tag,
    structural_signature: generated.structural_signature,
    evidence_basis: generated.evidence_basis,
    objective_alignment: [], // filled in by objective-ranker
    generated_at: new Date().toISOString(),
  };
}
