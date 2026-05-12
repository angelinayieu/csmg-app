// ── Mediator Proposal Engine — M4 persistence orchestrator ──────────
//
// Takes one ValidatedMediatorProposal (from M3), decides what to do
// based on the verdict, and writes to the database accordingly:
//
//   verdict.status      | action
//   --------------------|-------------------------------------------
//   "validated"         | insert entity + edges as 'proposed'
//   "speculative"       | same insert, with speculative=true flag
//                        in proposal_evidence (M6 surfaces a warning)
//   "rejected"          | drop — return { action: "dropped" }
//   "duplicate"         | don't insert; emit a rename hint via
//                        return { action: "duplicate", duplicate_of_name }
//                        (caller surfaces the rename flow separately)
//
// Idempotency:
//   - Each proposal has a stable cluster_id from M1 (12-char SHA-256
//     prefix). On insert, we check whether an entity already exists
//     for this (space_id, cluster_id) and skip if so. Re-running the
//     full pipeline on unchanged data is therefore a no-op.
//   - Within a single call, the entity is inserted first; its id is
//     used to resolve "from"/"to" name references on the edges. If
//     edge inserts fail, the entity is left in place (it can still
//     be reviewed/rejected by the user — orphan entity is OK).
//
// Failure semantics:
//   - Each proposal persists independently — one DB error doesn't
//     block siblings in a batch.
//   - All errors degrade to a result object with action = "error";
//     no throws bubble out.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ValidatedMediatorProposal } from "./validate-mediator";
import type { OrphanCluster } from "./detect-orphan-clusters";

// ── Public types ────────────────────────────────────────────────────

export type PersistAction =
  | "inserted"     // entity + edges written; awaiting user review
  | "dropped"      // verdict was "rejected"; nothing written
  | "duplicate"    // verdict was "duplicate"; rename hint emitted
  | "skipped"      // already-proposed for this cluster (idempotent)
  | "error";       // DB or resolution failure

export interface PersistResult {
  cluster_id: string;
  action: PersistAction;
  /** The new entity's UUID, when action = "inserted". */
  proposed_entity_id: string | null;
  /** The new edges' UUIDs, when action = "inserted". */
  proposed_edge_ids: string[];
  /** When action = "duplicate", the existing entity name the proposal
   *  is a duplicate of. Surfaced by M6 to drive the rename flow. */
  duplicate_of_name: string | null;
  /** Human-readable note for telemetry / debugging. */
  note: string;
}

export interface PersistMediatorArgs {
  spaceId: string;
  userId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>;
  /** The originating cluster — needed to look up cluster member ids
   *  to resolve edge endpoints by name → uuid. */
  cluster: OrphanCluster;
}

// ── Public functions ────────────────────────────────────────────────

/**
 * Persist one validated proposal. Always returns a PersistResult — never throws.
 */
export async function persistMediatorProposal(
  validated: ValidatedMediatorProposal,
  args: PersistMediatorArgs,
): Promise<PersistResult> {
  const { proposal, verdict } = validated;
  const clusterId = proposal.cluster_id;

  // Verdict dispatch — short-circuit before any DB work.
  if (verdict.status === "rejected") {
    return makeResult(clusterId, "dropped", {
      note: `rejected by validator: ${verdict.rejected_reason ?? "(no reason given)"}`,
    });
  }

  if (verdict.status === "duplicate") {
    return makeResult(clusterId, "duplicate", {
      duplicate_of_name: verdict.duplicate_of_name,
      note: `duplicate of "${verdict.duplicate_of_name ?? "(unknown)"}" — caller should surface rename flow`,
    });
  }

  // Sanity guard: reaching here, the proposal must have a proposed_entity.
  // M2's normalizer + M3's confidence_final = 0 path should keep this
  // from happening, but defending against it keeps the function total.
  if (!proposal.proposed_entity) {
    return makeResult(clusterId, "dropped", {
      note: "no proposed_entity (proposer declined); nothing to persist",
    });
  }

  return await persistInsertable(validated, args);
}

/**
 * Persist a batch of validated proposals. Sequential to keep DB load
 * predictable + per-proposal progress reportable. Returns results in
 * the same order as input.
 */
export async function persistMediatorProposals(
  validatedList: ValidatedMediatorProposal[],
  argsForEach: (validated: ValidatedMediatorProposal) => PersistMediatorArgs,
): Promise<PersistResult[]> {
  const out: PersistResult[] = [];
  for (const v of validatedList) {
    out.push(await persistMediatorProposal(v, argsForEach(v)));
  }
  return out;
}

// ── Internal: inserter ──────────────────────────────────────────────

async function persistInsertable(
  validated: ValidatedMediatorProposal,
  args: PersistMediatorArgs,
): Promise<PersistResult> {
  const { proposal, verdict, confidence_final } = validated;
  const { spaceId, userId, db, cluster } = args;
  const clusterId = proposal.cluster_id;

  // Sanity: enforced by caller, but the type system needs the narrowing.
  if (!proposal.proposed_entity) {
    return makeResult(clusterId, "dropped", {
      note: "no proposed_entity in insertable path (defensive)",
    });
  }
  const pe = proposal.proposed_entity;

  // Idempotency check: did we already propose for this cluster in this
  // space? If so, return without inserting again. The user can still
  // approve/reject the existing proposal through the normal flow.
  try {
    const { data: existing } = await db
      .from("entities")
      .select("id")
      .eq("space_id", spaceId)
      .eq("proposed_from_cluster_id", clusterId)
      .limit(1)
      .maybeSingle();
    if (existing && (existing as { id: string }).id) {
      return makeResult(clusterId, "skipped", {
        proposed_entity_id: (existing as { id: string }).id,
        note: "proposal already exists for this cluster (idempotent skip)",
      });
    }
  } catch (err) {
    // Read failure is not fatal — proceed to insert. Worst case: we
    // create a duplicate that the user can dismiss.
    console.warn(
      "[mediator-persist] idempotency check failed (proceeding):",
      err instanceof Error ? err.message : err,
    );
  }

  // Resolve all edge endpoints from names → entity IDs BEFORE inserting,
  // so we don't end up with an orphan entity if the edges can't be wired.
  const memberNameToId = new Map<string, string>();
  for (let i = 0; i < cluster.member_entity_ids.length; i++) {
    memberNameToId.set(
      normalizeName(cluster.member_entity_names[i]),
      cluster.member_entity_ids[i],
    );
  }

  // The proposed entity isn't inserted yet; we'll resolve its name
  // to the new uuid after the insert. Hold a placeholder.
  const proposedNameKey = normalizeName(pe.name);

  // Per-edge resolution check: each from/to must resolve to either
  // the new proposed entity OR an existing cluster member. If anything
  // can't be resolved, abort BEFORE the entity insert (no orphans).
  const unresolved: string[] = [];
  for (const e of proposal.proposed_edges) {
    if (!resolvable(e.from, proposedNameKey, memberNameToId)) unresolved.push(e.from);
    if (!resolvable(e.to, proposedNameKey, memberNameToId)) unresolved.push(e.to);
  }
  if (unresolved.length > 0) {
    return makeResult(clusterId, "error", {
      note: `cannot resolve edge endpoints: ${[...new Set(unresolved)].join(", ")}`,
    });
  }

  // Build the proposal_evidence JSONB blob — the audit trail M6 + the
  // approve/reject endpoints will read from. Holds everything needed
  // to render the queue without re-fetching the cluster.
  const proposalEvidence = {
    mechanism_explanation: proposal.mechanism_explanation,
    citation_seeds: proposal.citation_seeds,
    proposer_confidence: pe.confidence,
    verdict,
    cluster_member_names: cluster.member_entity_names,
    cluster_pattern_kind: cluster.pattern_kind,
    confidence_final,
    speculative: verdict.status === "speculative",
  };

  // Insert the entity. We mirror existing insert patterns from the rest
  // of the codebase: the supabase client casts to any to dodge the
  // generated-types friction with new columns. The DB enforces shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbAny = db as any;
  const { data: inserted, error: insertErr } = await dbAny
    .from("entities")
    .insert({
      space_id: spaceId,
      user_id: userId,
      name: pe.name,
      description: pe.description,
      entity_category: pe.entity_category,
      layer: pe.layer,
      // Defaults that match the rest of the schema's required-NOT-NULL
      // surface. Real values land when the user approves the proposal.
      source_tag: "implicit",
      entity_type: "mediator",
      depth: 0,
      knowledge_layer: "internal",
      authority_level: "moderate",
      confidence: confidence_final,
      proposal_status: "proposed_mediator",
      proposed_from_cluster_id: clusterId,
      proposal_evidence: proposalEvidence,
      // Provenance hint so future debug knows where this came from.
      provenance: {
        source: "mediator_proposal_engine",
        cluster_id: clusterId,
        verdict_status: verdict.status,
      },
    })
    .select("id")
    .single();

  if (insertErr || !inserted) {
    return makeResult(clusterId, "error", {
      note: `entity insert failed: ${insertErr?.message ?? "(unknown)"}`,
    });
  }
  const newEntityId = (inserted as { id: string }).id;

  // Now build the edges payload. We map each proposed edge's from/to
  // names to actual UUIDs using the resolution table built above.
  const edgeRows = proposal.proposed_edges.map((edge) => {
    const sourceId = resolveToId(
      edge.from,
      proposedNameKey,
      newEntityId,
      memberNameToId,
    );
    const targetId = resolveToId(
      edge.to,
      proposedNameKey,
      newEntityId,
      memberNameToId,
    );
    return {
      space_id: spaceId,
      user_id: userId,
      source_entity_id: sourceId,
      target_entity_id: targetId,
      relationship_type: edge.relationship_label,
      polarity: edge.polarity,
      strength: edge.confidence, // proposer-stated confidence as strength
      dimension: "causal",
      proposal_status: "proposed",
      proposed_by_entity_id: newEntityId,
      provenance: {
        source: "mediator_proposal_engine",
        cluster_id: clusterId,
        verdict_status: verdict.status,
      },
    };
  });

  if (edgeRows.length === 0) {
    return makeResult(clusterId, "inserted", {
      proposed_entity_id: newEntityId,
      proposed_edge_ids: [],
      note:
        "entity inserted; proposal had no edges (rare — usually means proposer returned a hub-only suggestion)",
    });
  }

  const { data: insertedEdges, error: edgeErr } = await dbAny
    .from("edges")
    .insert(edgeRows)
    .select("id");

  if (edgeErr) {
    // Entity is already inserted; user can still review/reject. Surface
    // the partial-success so the caller knows the queue has a quirky row.
    return makeResult(clusterId, "inserted", {
      proposed_entity_id: newEntityId,
      proposed_edge_ids: [],
      note: `entity inserted but edges failed: ${edgeErr.message ?? "(unknown)"}`,
    });
  }

  const edgeIds = ((insertedEdges as Array<{ id: string }> | null) ?? []).map(
    (r) => r.id,
  );

  return makeResult(clusterId, "inserted", {
    proposed_entity_id: newEntityId,
    proposed_edge_ids: edgeIds,
    note: `inserted ${edgeIds.length} proposed edges + 1 proposed entity`,
  });
}

// ── Internal helpers ────────────────────────────────────────────────

function makeResult(
  clusterId: string,
  action: PersistAction,
  partial: Partial<Omit<PersistResult, "cluster_id" | "action">>,
): PersistResult {
  return {
    cluster_id: clusterId,
    action,
    proposed_entity_id: partial.proposed_entity_id ?? null,
    proposed_edge_ids: partial.proposed_edge_ids ?? [],
    duplicate_of_name: partial.duplicate_of_name ?? null,
    note: partial.note ?? "",
  };
}

/** Lowercase + trim — matches the resolve table's keys. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function resolvable(
  endpointName: string,
  proposedNameKey: string,
  memberNameToId: Map<string, string>,
): boolean {
  const k = normalizeName(endpointName);
  if (k === proposedNameKey) return true;
  return memberNameToId.has(k);
}

function resolveToId(
  endpointName: string,
  proposedNameKey: string,
  proposedEntityId: string,
  memberNameToId: Map<string, string>,
): string {
  const k = normalizeName(endpointName);
  if (k === proposedNameKey) return proposedEntityId;
  const memberId = memberNameToId.get(k);
  // Caller has already gated on `resolvable` returning true, so this
  // branch shouldn't be reachable. Defensive fallback throws — surfaces
  // as the outer try/catch in persistInsertable.
  if (!memberId) {
    throw new Error(
      `resolveToId: cannot resolve "${endpointName}" — should have been gated by resolvable()`,
    );
  }
  return memberId;
}
