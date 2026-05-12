// ── App variable contract derivation (Sprint W5.2) ─────────────────
//
// TIER: 2/3 (situation KG + situation-specialized causal model) —
//       feeds the AppConfig.variables flat array that variable-
//       contract-card.tsx (W5.4) renders and that reasoning agents
//       read instead of joining persisted artifacts.
//
// What this library does:
//   Pure derivation. Given the same inputs preflight already fetches
//   (entities + edges + goals + variable_proposals + overrides +
//   metric_observations) PLUS each app's dominant-entity set, produce
//   a per-app AppVariableEntry[] tagged with role (independent,
//   dependent, mediator, etc.).
//
// Why this exists:
//   AppConfig.variables (W5.1) is the single source of truth for an
//   app's IV/DV/control/mediator/moderator contract. Storing it on
//   the App row keeps the contract co-located with the artifact it
//   describes — so a lab-pick cascade (W5.2.5) can bump variables AND
//   stale_reason='lab_regen' in one row update, and reasoning agents
//   don't have to join environment_overrides + variable_proposals +
//   improvement_goals every time they want to know "what variables
//   does this app touch?"
//
// Why pure / synchronous:
//   Mirrors partition-variables-by-role.ts. The caller (app-generator)
//   does all I/O; this function takes already-fetched data and returns
//   a derived array. No DB calls, no LLM calls — fast, testable,
//   re-runnable when the user changes overrides or picks a different
//   lab without round-tripping the DB.
//
// V1 scoping:
//   For each app, include in its variables:
//     • All independents whose entity_id is in app_dominant_entity_ids
//       OR all independents when the app has no explicit dominants
//       (rare; preserves "the app touches the whole IV set" semantics)
//     • The dependents whose entity_id matches the app's serves-goal
//       metric_entity_id (or all dependents when goal is null)
//     • All mediators / confounders that lie on a path between the
//       app's IVs and DV — V1 includes the full partition's mediators
//       and confounders for that bucket; finer per-app scoping is
//       deferred to W5.2.5 lab-pick reflow.
//     • All controls + moderators that are tagged via overrides for
//       any entity in the app's scope.
//
// Soft-fail:
//   Returns [] when the partition is empty or the app has no
//   resolvable dominants. Callers persist empty arrays as-is —
//   absence of variables on a legacy app means "contract not yet
//   derived," presence with role-tagged entries means "this is the
//   contract."

import type { AppVariableEntry } from "@/types/app";
import type { VariableRole } from "@/types/variable-proposals";
import type { PreflightVariables, VariableEntry } from "@/types/preflight";
import type { Edge } from "@/types";
import type { LoadedLab } from "./load-chosen-lab";

// ── Args ────────────────────────────────────────────────────────────

export interface DeriveAppVariablesArgs {
  /**
   * Result of `partitionVariablesByRole`. Caller computes once per
   * generate-apps run and re-uses across all apps in the batch.
   */
  partition: PreflightVariables;
  /**
   * UUIDs of this app's dominant entities. Sourced from
   * `apps.dominant_factor_uuids` or the proposal's source_components
   * resolved through codeToUuid.
   *
   * Empty array means "no dominant entities resolved" — function
   * degrades to including the full IV bucket so the app at least
   * surfaces something to the user.
   */
  appDominantEntityIds: string[];
  /**
   * The app's DV — typically the goal's metric_entity_id. Optional:
   * apps without a goal target still receive the full DV bucket so
   * the variable contract is non-empty.
   */
  appGoalMetricEntityId?: string | null;
  /**
   * Sprint W5.2.5 — the user-approved lab_twin (from
   * loadChosenLabForSpace). When present, the lab's primary_iv /
   * primary_dv override the partition's role assignment for those
   * specific entities, BUT only when the entity wasn't already
   * user-overridden (rationale.source === "user_override" wins).
   *
   * Priority becomes:
   *   1. User override   (already baked into partition entries)
   *   2. Chosen lab      (this step)
   *   3. LLM proposal    (already baked into partition entries)
   *   4. Heuristic       (already baked into partition entries)
   *
   * When the lab's IV/DV entity isn't already in the app's filtered
   * scope, it's hoisted into the output array so the app's contract
   * still reflects the user's lab pick. Pure: no I/O. Caller does
   * the lab load via loadChosenLabForSpace.
   */
  chosenLab?: LoadedLab | null;
  /**
   * Sprint W5.8c — when provided alongside an `appGoalMetricEntityId`,
   * mediators and confounders in the output are filtered to ONLY
   * those on the path between this app's IVs (appDominantEntityIds)
   * and the app's DV (appGoalMetricEntityId).
   *
   *   • Mediator: reachable downstream from some IV AND reaches the DV
   *   • Confounder: ancestor of both some IV and the DV (backdoor)
   *
   * Omit `edges` (or set the goal DV to null) to fall back to V1
   * behavior: include the full mediator + confounder buckets in
   * every app. Useful for apps that don't yet have a DV anchor.
   *
   * Pure: graph traversal is BFS over the edge list, no I/O.
   */
  edges?: Edge[];
}

// ── Function ────────────────────────────────────────────────────────

/**
 * Derive the variable contract for one app from a pre-computed
 * preflight partition. Pure — no I/O.
 *
 * Returns a flat AppVariableEntry[] (VariableEntry + role
 * discriminator). Caller persists into `apps.config.variables`.
 */
export function deriveAppVariables(
  args: DeriveAppVariablesArgs,
): AppVariableEntry[] {
  const { partition, appDominantEntityIds, appGoalMetricEntityId, chosenLab, edges } = args;

  const dominantSet = new Set(appDominantEntityIds);
  const hasDominants = dominantSet.size > 0;

  // Sprint W5.8c — per-app mediator + confounder scoping.
  // Compute the per-app mediator/confounder sets ONCE so the
  // bucket-loop below is just a cheap membership check. Falls back
  // to "include all" (universal scoping) when edges are absent or
  // the app has no DV — preserves W5.2 V1 behavior in those cases.
  const scoping = computePerAppScoping({
    edges,
    appDominantEntityIds: dominantSet,
    appGoalMetricEntityId: appGoalMetricEntityId ?? null,
    partition,
  });

  const out: AppVariableEntry[] = [];

  // ── Independents — IVs the app controls ───────────────────────────
  // V1 rule: include all independents in the app's dominant set. When
  // an app has no resolvable dominants (rare), include the full
  // independent bucket so the contract isn't empty.
  for (const v of partition.independent) {
    if (!hasDominants || dominantSet.has(v.entity_id)) {
      out.push(tagWithRole(v, "independent"));
    }
  }

  // ── Dependents — DVs the app targets ──────────────────────────────
  // Prefer the goal metric entity when present; otherwise include all
  // dependents. Many spaces have a single DV so the two paths converge.
  for (const v of partition.dependent) {
    if (appGoalMetricEntityId == null) {
      out.push(tagWithRole(v, "dependent"));
    } else if (v.entity_id === appGoalMetricEntityId) {
      out.push(tagWithRole(v, "dependent"));
    }
  }

  // ── Mediators — on this app's IV→DV path (W5.8c). ─────────────────
  // When per-app scoping is active (edges + DV present), only
  // entities lying on at least one IV → DV directed path appear.
  // When inactive (legacy fallback), include the full bucket.
  for (const v of partition.mediators) {
    if (!scoping.active || scoping.mediatorScope.has(v.entity_id)) {
      out.push(tagWithRole(v, "mediator"));
    }
  }

  // ── Confounders — backdoor adjustments scoped to this IV/DV pair. ─
  for (const v of partition.confounders) {
    if (!scoping.active || scoping.confounderScope.has(v.entity_id)) {
      out.push(tagWithRole(v, "confounding"));
    }
  }

  // ── Controls — held constant during analysis. Full bucket. ────────
  for (const v of partition.controls) {
    out.push(tagWithRole(v, "controlled"));
  }

  // ── Moderators — effect modifiers. Full bucket. ───────────────────
  for (const v of partition.moderators) {
    out.push(tagWithRole(v, "modifier"));
  }

  // Unclassified entities are intentionally excluded — they're not
  // part of an app's contract until they earn a role.

  // ── Sprint W5.2.5: chosen-lab IV/DV override ──────────────────────
  // Apply lab's primary_iv → role='independent' and primary_dv →
  // role='dependent', respecting user-override priority. Entities not
  // yet in `out` get hoisted from the partition so the lab pick is
  // always reflected in the app's variable contract.
  if (chosenLab?.option) {
    const labIvId = chosenLab.option.primary_iv?.entity_id ?? null;
    const labDvId = chosenLab.option.primary_dv?.entity_id ?? null;
    if (labIvId) overrideOrHoist(out, partition, labIvId, "independent");
    if (labDvId) overrideOrHoist(out, partition, labDvId, "dependent");
  }

  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────

function tagWithRole(v: VariableEntry, role: VariableRole): AppVariableEntry {
  return { ...v, role };
}

/**
 * Set `role` on the entry matching `entityId` in `out`. If none
 * matches, find the entity in any partition bucket and push it onto
 * `out` with the lab-mandated role. Skips entries whose rationale
 * source is "user_override" — user override beats lab.
 */
function overrideOrHoist(
  out: AppVariableEntry[],
  partition: PreflightVariables,
  entityId: string,
  labRole: VariableRole,
): void {
  for (const entry of out) {
    if (entry.entity_id !== entityId) continue;
    if (entry.rationale.source === "user_override") return;
    entry.role = labRole;
    return;
  }
  const hoisted = findInPartition(partition, entityId);
  if (!hoisted) return;
  if (hoisted.rationale.source === "user_override") {
    // Respect user override even on hoist: keep the entry but don't
    // re-tag the role. We push using whichever bucket the override
    // landed it in — re-derived by inspecting which bucket holds it.
    const userRole = bucketOf(partition, entityId);
    out.push({ ...hoisted, role: userRole ?? labRole });
    return;
  }
  out.push({ ...hoisted, role: labRole });
}

function findInPartition(
  partition: PreflightVariables,
  entityId: string,
): VariableEntry | null {
  const buckets: VariableEntry[][] = [
    partition.independent,
    partition.dependent,
    partition.controls,
    partition.confounders,
    partition.mediators,
    partition.moderators,
    partition.unclassified,
  ];
  for (const b of buckets) {
    const hit = b.find((e) => e.entity_id === entityId);
    if (hit) return hit;
  }
  return null;
}

function bucketOf(
  partition: PreflightVariables,
  entityId: string,
): VariableRole | null {
  if (partition.independent.some((e) => e.entity_id === entityId)) return "independent";
  if (partition.dependent.some((e) => e.entity_id === entityId)) return "dependent";
  if (partition.controls.some((e) => e.entity_id === entityId)) return "controlled";
  if (partition.confounders.some((e) => e.entity_id === entityId)) return "confounding";
  if (partition.mediators.some((e) => e.entity_id === entityId)) return "mediator";
  if (partition.moderators.some((e) => e.entity_id === entityId)) return "modifier";
  return null;
}

// ── Sprint W5.8c — per-app mediator/confounder scoping ─────────────
//
// Computes which entities count as "on this app's IV → DV path" and
// "in this app's IV-DV backdoor set." Used to filter the global
// partition's mediator + confounder buckets down to entities that
// actually matter for THIS app, not the whole space.
//
// Algorithm:
//   1. Build outgoing + incoming adjacency from `edges` (one pass)
//   2. Mediator scope = entities reachable downstream from any IV
//      AND from which the DV is reachable (i.e. on at least one
//      directed IV → … → DV path)
//   3. Confounder scope = entities whose downstream contains BOTH
//      some IV AND the DV (= ancestor of both = backdoor source)
//
// Returns `{ active: false }` when edges aren't provided or the app
// has no DV anchor — callers fall back to the universal V1 buckets.
//
// Self-loops, dup edges, and missing endpoints are silently skipped.

interface PerAppScoping {
  active: boolean;
  mediatorScope: Set<string>;
  confounderScope: Set<string>;
}

function computePerAppScoping(args: {
  edges: Edge[] | undefined;
  appDominantEntityIds: Set<string>;
  appGoalMetricEntityId: string | null;
  partition: PreflightVariables;
}): PerAppScoping {
  const { edges, appDominantEntityIds, appGoalMetricEntityId } = args;

  // Inactive when we can't compute the path — fall through to V1
  // "include all" behavior in the caller.
  if (
    !edges ||
    edges.length === 0 ||
    appDominantEntityIds.size === 0 ||
    !appGoalMetricEntityId
  ) {
    return {
      active: false,
      mediatorScope: new Set(),
      confounderScope: new Set(),
    };
  }

  // Build adjacency once.
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!e.source_entity_id || !e.target_entity_id) continue;
    if (e.source_entity_id === e.target_entity_id) continue;
    if (!outgoing.has(e.source_entity_id)) outgoing.set(e.source_entity_id, new Set());
    if (!incoming.has(e.target_entity_id)) incoming.set(e.target_entity_id, new Set());
    outgoing.get(e.source_entity_id)!.add(e.target_entity_id);
    incoming.get(e.target_entity_id)!.add(e.source_entity_id);
  }

  // Forward BFS from any IV → set of all downstream reachable nodes.
  const downstreamFromIvs = bfs(appDominantEntityIds, outgoing);
  // Reverse BFS from DV → set of all upstream nodes (ancestors of DV).
  const ancestorsOfDv = bfs(new Set([appGoalMetricEntityId]), incoming);

  // Mediator scope = intersection of (reachable from some IV) and
  // (reaches the DV = ancestor of DV). Exclude IVs themselves +
  // the DV itself (they're not mediators).
  const mediatorScope = new Set<string>();
  for (const id of downstreamFromIvs) {
    if (appDominantEntityIds.has(id)) continue;
    if (id === appGoalMetricEntityId) continue;
    if (ancestorsOfDv.has(id)) mediatorScope.add(id);
  }

  // Confounder scope = entities whose descendants include BOTH some
  // IV and the DV. Same as: ancestor of some IV AND ancestor of DV.
  const ancestorsOfIvs = bfs(appDominantEntityIds, incoming);
  const confounderScope = new Set<string>();
  for (const id of ancestorsOfIvs) {
    if (appDominantEntityIds.has(id)) continue;
    if (id === appGoalMetricEntityId) continue;
    if (ancestorsOfDv.has(id)) confounderScope.add(id);
  }

  return { active: true, mediatorScope, confounderScope };
}

/** Generic BFS over an adjacency map. Starting from `roots`, returns
 *  the set of all reachable nodes (excluding the roots themselves). */
function bfs(
  roots: Set<string>,
  adj: Map<string, Set<string>>,
): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = Array.from(roots);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const next = adj.get(cur);
    if (!next) continue;
    for (const n of next) {
      if (!seen.has(n) && !roots.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen;
}
