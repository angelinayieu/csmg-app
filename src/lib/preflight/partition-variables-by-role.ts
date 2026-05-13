// ── Variable-role partition — A3 ─────────────────────────────────────
//
// Pure function. Inspects entities + edges + goals + LLM proposals +
// user overrides and partitions every entity into one of the six
// experimental-design role columns:
//
//   independent / dependent / controls / confounders / mediators / moderators
//
// Plus an `unclassified` bucket for entities that don't fit any role yet.
//
// Priority order (deterministic):
//   1. User override     (environment_overrides.reclassify_variable)
//   2. LLM proposal       (variable_proposals.variable_role)
//   3. Heuristic rules:
//      a. independent — provenance.stop_reason = "user_controllable"
//                       or is_user_controllable flag
//      b. dependent    — entity is improvement_goals.metric_entity_id
//      c. confounder   — on a backdoor path between any IV and any DV
//                        (shared upstream ancestor)
//      d. mediator     — intermediate on a directed IV→DV path
//      e. moderator    — has interaction edges (deferred to synergy
//                        detection; bucket empty by default)
//      f. unclassified — none of the above
//
// Each VariableEntry carries a VariableRationale explaining why it
// landed in its bucket. The page renders this on hover/click for
// audit. role_inference_notes capture per-bucket gaps (e.g.,
// "Confounders empty because no DV identified yet").
//
// Pure / synchronous: no DB calls, no LLM calls. The aggregator
// (load-preflight.ts) does all I/O and hands this function the
// already-fetched data.

import type { Entity, Edge } from "@/types";
import type { ImprovementGoal } from "@/types/goals";
import type { VariableRole } from "@/types/variable-proposals";
import type {
  PreflightVariables,
  PreflightOverride,
  VariableEntry,
  VariableRationale,
  RoleInferenceNote,
} from "@/types/preflight";

// ── Public types ────────────────────────────────────────────────────

export interface PartitionVariablesByRoleArgs {
  entities: Entity[];
  edges: Edge[];
  goals: ImprovementGoal[];
  /** From variable_proposals — LLM-suggested role assignments. */
  variableProposals: Array<{ entity_id: string; variable_role: VariableRole }>;
  /** From environment_overrides — user-driven reclassifications. */
  overrides: PreflightOverride[];
  /** From metric_observations — used to set current_value on entries. */
  metricObservations: Array<{
    metric_entity_id: string;
    value: string | number | null;
    recorded_at: string;
  }>;
  /**
   * Sprint W6.8 — optional canonical_concept_id → canonical_code map.
   * When provided, partition entries carry both fields so UI surfaces
   * can render a CanonicalConceptBadge linking to the Tier 1 drawer.
   * Caller (load-preflight + redrive-app-variables + app-generator)
   * fetches this via a single `SELECT id, canonical_code FROM
   * canonical_concepts WHERE id IN (...)` before calling the
   * partition. Pure: function stays I/O-free.
   */
  canonicalCodeById?: Map<string, string>;
}

type RoleBucket =
  | "independent"
  | "dependent"
  | "controls"
  | "confounders"
  | "mediators"
  | "moderators"
  | "unclassified";

// ── Public function ─────────────────────────────────────────────────

export function partitionVariablesByRole(
  args: PartitionVariablesByRoleArgs,
): PreflightVariables {
  const { entities, edges, goals, variableProposals, overrides, metricObservations, canonicalCodeById } = args;

  // ── Build lookup tables once ──────────────────────────────────────

  // Most-recent observation per metric_entity_id.
  const latestObsByEntity = new Map<string, { value: string; recorded_at: string }>();
  for (const obs of metricObservations) {
    const existing = latestObsByEntity.get(obs.metric_entity_id);
    if (!existing || obs.recorded_at > existing.recorded_at) {
      latestObsByEntity.set(obs.metric_entity_id, {
        value: String(obs.value ?? ""),
        recorded_at: obs.recorded_at,
      });
    }
  }

  // User-override map (highest priority).
  const overrideRoleByEntity = new Map<string, RoleBucket>();
  for (const o of overrides) {
    if (o.override_kind !== "reclassify_variable") continue;
    const v = o.value as { role?: string } | null;
    if (!v?.role) continue;
    const bucket = mapToBucket(v.role as VariableRole);
    if (bucket) overrideRoleByEntity.set(o.target_id, bucket);
  }

  // LLM-proposal map (second priority).
  const proposalRoleByEntity = new Map<string, RoleBucket>();
  for (const vp of variableProposals) {
    if (vp.variable_role === "unclassified") continue;
    const bucket = mapToBucket(vp.variable_role);
    if (bucket) proposalRoleByEntity.set(vp.entity_id, bucket);
  }

  // Goal-target set — every entity referenced by improvement_goals.
  // Sprint W5.7b: column landed on the live DB; type is properly
  // declared on ImprovementGoal.metric_entity_id (no more `(g as any)`).
  const dvSet = new Set<string>();
  for (const g of goals) {
    const metricEntityId = g.metric_entity_id ?? "";
    if (metricEntityId) dvSet.add(metricEntityId);
  }

  // IV set — provenance.stop_reason or is_user_controllable.
  const ivSet = new Set<string>();
  for (const e of entities) {
    if (isUserControllable(e)) ivSet.add(e.id);
  }

  // ── Graph adjacency for backdoor / mediator detection ─────────────
  const outgoing = new Map<string, Set<string>>(); // directed
  const incoming = new Map<string, Set<string>>(); // directed (reverse)
  for (const e of edges) {
    if (!e.source_entity_id || !e.target_entity_id) continue;
    if (e.source_entity_id === e.target_entity_id) continue;
    if (!outgoing.has(e.source_entity_id)) outgoing.set(e.source_entity_id, new Set());
    if (!incoming.has(e.target_entity_id)) incoming.set(e.target_entity_id, new Set());
    outgoing.get(e.source_entity_id)!.add(e.target_entity_id);
    incoming.get(e.target_entity_id)!.add(e.source_entity_id);
  }

  // For each entity: ancestors (everything that can reach it via incoming
  // edges). Cached on first compute.
  const ancestorsCache = new Map<string, Set<string>>();
  const computeAncestors = (entityId: string): Set<string> => {
    const cached = ancestorsCache.get(entityId);
    if (cached) return cached;
    const seen = new Set<string>();
    const queue: string[] = [entityId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const parents = incoming.get(cur);
      if (!parents) continue;
      for (const p of parents) {
        if (!seen.has(p) && p !== entityId) {
          seen.add(p);
          queue.push(p);
        }
      }
    }
    ancestorsCache.set(entityId, seen);
    return seen;
  };

  // Confounder candidates: entities that are ancestors of BOTH some
  // IV and some DV (shared upstream → backdoor path).
  const confounderCandidates = new Set<string>();
  if (ivSet.size > 0 && dvSet.size > 0) {
    // Compute union of IV ancestors and DV ancestors.
    const ivAncestorsUnion = new Set<string>();
    for (const iv of ivSet) {
      for (const a of computeAncestors(iv)) ivAncestorsUnion.add(a);
    }
    const dvAncestorsUnion = new Set<string>();
    for (const dv of dvSet) {
      for (const a of computeAncestors(dv)) dvAncestorsUnion.add(a);
    }
    // Intersection = nodes upstream of both → confounders.
    for (const a of ivAncestorsUnion) {
      if (dvAncestorsUnion.has(a) && !ivSet.has(a) && !dvSet.has(a)) {
        confounderCandidates.add(a);
      }
    }
  }

  // Mediator candidates: directed paths IV → … → DV. We mark all
  // intermediate (non-IV, non-DV) nodes that lie on such paths.
  const mediatorCandidates = new Set<string>();
  if (ivSet.size > 0 && dvSet.size > 0) {
    // For each IV, find descendants reachable via outgoing edges.
    // For each descendant that's also an ancestor of some DV, the
    // descendant is a mediator (it lies on at least one IV→DV path).
    const ivDescendantsUnion = new Set<string>();
    for (const iv of ivSet) {
      const queue: string[] = [iv];
      const seen = new Set<string>();
      while (queue.length > 0) {
        const cur = queue.shift()!;
        const children = outgoing.get(cur);
        if (!children) continue;
        for (const c of children) {
          if (!seen.has(c) && c !== iv) {
            seen.add(c);
            ivDescendantsUnion.add(c);
            queue.push(c);
          }
        }
      }
    }
    for (const candidate of ivDescendantsUnion) {
      if (ivSet.has(candidate) || dvSet.has(candidate)) continue;
      // Is `candidate` an ancestor of any DV?
      const ancestorsOfCandidateDescendants = new Set<string>();
      const queue: string[] = [candidate];
      const seen = new Set<string>();
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (dvSet.has(cur)) {
          ancestorsOfCandidateDescendants.add(candidate);
          break;
        }
        const children = outgoing.get(cur);
        if (!children) continue;
        for (const c of children) {
          if (!seen.has(c)) {
            seen.add(c);
            queue.push(c);
          }
        }
      }
      if (ancestorsOfCandidateDescendants.has(candidate)) {
        mediatorCandidates.add(candidate);
      }
    }
  }

  // ── Partition ─────────────────────────────────────────────────────

  const buckets: Record<RoleBucket, VariableEntry[]> = {
    independent: [],
    dependent: [],
    controls: [],
    confounders: [],
    mediators: [],
    moderators: [],
    unclassified: [],
  };

  for (const e of entities) {
    const { bucket, rationale } = classifyEntity({
      entity: e,
      ivSet,
      dvSet,
      confounderCandidates,
      mediatorCandidates,
      overrideRoleByEntity,
      proposalRoleByEntity,
    });

    // W6.8 — Tier 1 canonical link from entity row + caller-provided map.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const canonicalConceptId = ((e as any).canonical_concept_id as string | null | undefined) ?? null;
    const canonicalCode = canonicalConceptId
      ? canonicalCodeById?.get(canonicalConceptId) ?? null
      : null;

    const entry: VariableEntry = {
      entity_id: e.id,
      name: e.name,
      description: e.description,
      layer: e.layer,
      observability: deriveObservability(e),
      proxy_for: deriveProxyFor(e),
      current_value:
        latestObsByEntity.get(e.id)?.value ??
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (((e as any).measurement_protocol as Record<string, unknown> | undefined)
          ?.current_value as string | undefined) ??
        null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unit: ((e as any).measurement_unit as string | undefined) ?? null,
      importance: e.importance,
      rationale,
      canonical_concept_id: canonicalConceptId,
      canonical_code: canonicalCode,
    };

    buckets[bucket].push(entry);
  }

  // ── Notes for empty / sparse buckets ──────────────────────────────
  const role_inference_notes = computeRoleNotes({
    buckets,
    ivSet,
    dvSet,
    edgeCount: edges.length,
  });

  return {
    independent: buckets.independent,
    dependent: buckets.dependent,
    controls: buckets.controls,
    confounders: buckets.confounders,
    mediators: buckets.mediators,
    moderators: buckets.moderators,
    unclassified: buckets.unclassified,
    role_inference_notes,
  };
}

// ── Per-entity classifier ───────────────────────────────────────────

function classifyEntity(args: {
  entity: Entity;
  ivSet: Set<string>;
  dvSet: Set<string>;
  confounderCandidates: Set<string>;
  mediatorCandidates: Set<string>;
  overrideRoleByEntity: Map<string, RoleBucket>;
  proposalRoleByEntity: Map<string, RoleBucket>;
}): { bucket: RoleBucket; rationale: VariableRationale } {
  const { entity, ivSet, dvSet, confounderCandidates, mediatorCandidates, overrideRoleByEntity, proposalRoleByEntity } = args;

  // Priority 1 — user override.
  const override = overrideRoleByEntity.get(entity.id);
  if (override) {
    return {
      bucket: override,
      rationale: {
        source: "user_override",
        source_quote: null,
        evidence_ids: [],
        confidence: 1.0,
        reason: `User reclassified this variable as ${roleHuman(override)}.`,
      },
    };
  }

  // Priority 2 — LLM proposal.
  const proposed = proposalRoleByEntity.get(entity.id);
  if (proposed) {
    return {
      bucket: proposed,
      rationale: {
        source: "auto_classifier",
        source_quote: null,
        evidence_ids: [],
        confidence: 0.75,
        reason: `LLM variable_proposal classified this as ${roleHuman(proposed)}.`,
      },
    };
  }

  // Priority 3 — heuristic rules.

  // Independent: user-controllable.
  if (ivSet.has(entity.id)) {
    return {
      bucket: "independent",
      rationale: {
        source: "auto_classifier",
        source_quote: null,
        evidence_ids: [],
        confidence: 0.8,
        reason:
          "Entity flagged as user-controllable (you can manipulate it directly).",
      },
    };
  }

  // Dependent: target of an improvement_goal.
  if (dvSet.has(entity.id)) {
    return {
      bucket: "dependent",
      rationale: {
        source: "synthesis_inference",
        source_quote: null,
        evidence_ids: [],
        confidence: 0.95,
        reason:
          "Entity is the target metric of one of your goals — it's what you're optimizing for.",
      },
    };
  }

  // Confounder: on backdoor path.
  if (confounderCandidates.has(entity.id)) {
    return {
      bucket: "confounders",
      rationale: {
        source: "auto_classifier",
        source_quote: null,
        evidence_ids: [],
        confidence: 0.7,
        reason:
          "Detected as a common upstream cause of both an independent variable and an outcome — adjusting for this is required for valid causal estimates.",
      },
    };
  }

  // Mediator: on directed IV→DV path.
  if (mediatorCandidates.has(entity.id)) {
    return {
      bucket: "mediators",
      rationale: {
        source: "auto_classifier",
        source_quote: null,
        evidence_ids: [],
        confidence: 0.7,
        reason:
          "Lies on the causal path between an independent variable and an outcome — it carries (or partially carries) the effect.",
      },
    };
  }

  // Moderator detection deferred — bucket stays empty with a role
  // note. (Future: pull from `reactions` table for synergies.)

  // Else — unclassified.
  return {
    bucket: "unclassified",
    rationale: {
      source: "auto_classifier",
      source_quote: null,
      evidence_ids: [],
      confidence: 0.4,
      reason:
        "No role yet — this entity doesn't directly drive an outcome and isn't yet on a causal path. Synthesis may classify it later, or you can drag it into a role manually.",
    },
  };
}

// ── Role notes for empty / sparse buckets ────────────────────────────

function computeRoleNotes(args: {
  buckets: Record<RoleBucket, VariableEntry[]>;
  ivSet: Set<string>;
  dvSet: Set<string>;
  edgeCount: number;
}): RoleInferenceNote[] {
  const notes: RoleInferenceNote[] = [];
  const { buckets, ivSet, dvSet, edgeCount } = args;

  if (buckets.independent.length === 0) {
    notes.push({
      role: "independent",
      reason:
        "No user-controllable entities detected from the prompt or template seed.",
      resolved_by:
        "Manually flag at least one variable as independent, or refine the prompt to clarify what you can change.",
      severity: "warn",
    });
  }

  if (buckets.dependent.length === 0) {
    notes.push({
      role: "dependent",
      reason:
        "No outcome metric attached to any goal yet — synthesis hasn't identified what you're optimizing for.",
      resolved_by:
        "Filled by synthesis after KG decomposes; you can also set a goal target manually below.",
      severity: "warn",
    });
  }

  if (buckets.controls.length === 0) {
    notes.push({
      role: "controls",
      reason:
        "No variables explicitly marked for control. Controls are typically set during experimental design.",
      resolved_by:
        "Drag a variable into Controls or wait for the strategy generator to suggest controls.",
      severity: "info",
    });
  }

  if (buckets.confounders.length === 0) {
    if (ivSet.size === 0 || dvSet.size === 0) {
      notes.push({
        role: "confounders",
        reason:
          "Confounder detection requires at least one IV and one DV in the graph. " +
          (ivSet.size === 0 ? "No IVs detected. " : "") +
          (dvSet.size === 0 ? "No DVs detected. " : ""),
        resolved_by: "Will populate after IVs and DVs are confirmed.",
        severity: "info",
      });
    } else if (edgeCount < 5) {
      notes.push({
        role: "confounders",
        reason: `Only ${edgeCount} edges in the graph — confounder detection needs richer connectivity.`,
        resolved_by: "Will populate after research adds more edges.",
        severity: "info",
      });
    } else {
      notes.push({
        role: "confounders",
        reason:
          "No backdoor paths detected. Either the graph is genuinely free of confounders, or upstream causes haven't been mapped yet.",
        resolved_by:
          "Run deep research pass or mediator proposal engine to expand the upstream layer.",
        severity: "info",
      });
    }
  }

  if (buckets.mediators.length === 0 && (ivSet.size === 0 || dvSet.size === 0)) {
    notes.push({
      role: "mediators",
      reason: "Mediator detection needs both an IV and a DV to find paths.",
      resolved_by: "Will populate after IVs and DVs are confirmed.",
      severity: "info",
    });
  }

  // Moderators always note — bucket detection is deferred to synergy.
  if (buckets.moderators.length === 0) {
    notes.push({
      role: "moderators",
      reason:
        "Moderators (effect-modifying variables) come from the synergy detection / 3-way ANOVA pass.",
      resolved_by:
        "Opt-in to the Synergy Detection plan item or manually classify.",
      severity: "info",
    });
  }

  return notes;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Maps the broader VariableRole enum (10 values) to the 6-bucket
 *  experimental-design partition the preflight uses.
 *
 *  Notes:
 *  - "outcome" → dependent (semantically equivalent)
 *  - "controlled" → controls
 *  - "confounding" → confounders
 *  - "modifier" → moderators (alternate term for the same concept)
 *  - "instrument" → independent (instruments are causal-inference tools
 *    but the user manipulates them, so they sit with IVs in the
 *    six-bucket partition)
 *  - "condition" → controls (boundary conditions are held constant)
 *  - "unclassified" → null (caller skips)
 */
function mapToBucket(role: VariableRole): RoleBucket | null {
  switch (role) {
    case "independent":
    case "instrument":
      return "independent";
    case "dependent":
    case "outcome":
      return "dependent";
    case "controlled":
    case "condition":
      return "controls";
    case "confounding":
      return "confounders";
    case "mediator":
      return "mediators";
    case "modifier":
      return "moderators";
    case "unclassified":
      return null;
    default:
      return null;
  }
}

function roleHuman(bucket: RoleBucket): string {
  return bucket.replace(/^./, (c) => c.toUpperCase());
}

function isUserControllable(e: Entity): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provenance = (e as any).provenance as Record<string, unknown> | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provSource = (provenance?.source as Record<string, unknown> | undefined) ?? null;

  const stopReasonA = (provenance?.stop_reason as string | undefined) ?? null;
  const stopReasonB = (provSource?.stop_reason as string | undefined) ?? null;
  if (stopReasonA === "user_controllable") return true;
  if (stopReasonB === "user_controllable") return true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((e as any).is_user_controllable === true) return true;

  // Templates often tag interventions with this entity_type.
  if (e.entity_type === "intervention") return true;
  if (e.entity_type === "lever") return true;

  return false;
}

function deriveObservability(
  e: Entity,
): VariableEntry["observability"] {
  // Schema-pending: when entities.observability column exists, use it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const explicit = (e as any).observability as string | undefined;
  if (
    explicit === "directly_observable" ||
    explicit === "latent" ||
    explicit === "inferable_via_proxy"
  ) {
    return explicit;
  }

  // Fallback 1: legacy boolean flag on some seeds.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obs = (e as any).observable as boolean | undefined;
  if (obs === true) return "directly_observable";
  if (obs === false) return "latent";

  // Fallback 2: layer hint — pathways layer typically latent.
  if (e.layer && /pathway/i.test(e.layer)) return "latent";

  return "unknown";
}

function deriveProxyFor(e: Entity): VariableEntry["proxy_for"] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proxyForId = (e as any).proxy_for as string | undefined;
  if (!proxyForId) return null;
  // We don't have the target entity name in this pure helper; the
  // aggregator can enrich this post-partition by joining names. Until
  // then, surface the id and let the UI resolve.
  return { entity_id: proxyForId, entity_name: "" };
}
