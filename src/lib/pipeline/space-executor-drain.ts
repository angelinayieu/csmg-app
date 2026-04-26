// ── Space executor drain (shared) ─────────────────────────────────────
//
// Factored out of src/app/api/pipeline/space-executor/route.ts so the
// same dispatch logic can be invoked from:
//   • the user-facing POST (with a per-session Supabase client)
//   • the cron drain (with a service-role client, no user session)
//
// The file owns ONE contract: given a Supabase client + a space id,
// claim up to N pending work items and execute them. Soft-fail per
// item — the drain never throws.
//
// Supported kinds (v1): same as the route — signature_deepen is the
// only kind with a real executor; the other four (axis, edge_space,
// convergent_point, intersection_probe) get marked completed with a
// "[stub]" outcome so they don't pile up pending forever.

import {
  claimNextWorkItems,
  completeWorkItem,
  failWorkItem,
  requeueStaleItems,
  type SpaceWorkItem,
  type SpaceWorkKind,
} from "@/lib/pipeline/space-work-queue";
import {
  deepenNodeSignature,
  persistSignature,
  emitSignatureDeepened,
} from "@/lib/pipeline/signature-materializer";
import { runCanvasCombination } from "@/lib/canvas/combination";
import type { Entity, Edge } from "@/types";
import type { NodeSignature } from "@/types/node-signature";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface ItemResult {
  id: string;
  candidate_id: string;
  kind: SpaceWorkKind;
  status: "completed" | "failed" | "skipped";
  outcome: string;
}

export interface DrainOpts {
  spaceId: string;
  maxItems?: number;                // default 3, cap 10
  kinds?: SpaceWorkKind[];          // restrict to specific kinds
  runId?: string | null;            // attached to emitted events
  requeueStale?: boolean;           // sweep stuck in_progress first
  staleSeconds?: number;            // default 300
}

export interface DrainResult {
  space_id: string;
  claimed: number;
  results: ItemResult[];
  requeued_stale: number;
  run_id: string | null;
}

/**
 * Claim + execute up to `maxItems` pending rows for one space.
 *
 * Guarantees:
 * - Never throws. One poisoned item is marked failed and the drain
 *   continues through the remaining claimed items.
 * - Returns an empty `results` array when there is nothing pending —
 *   callers can use this as a cheap "no work" signal.
 */
export async function drainSpaceQueue(
  db: AnyDb,
  opts: DrainOpts,
): Promise<DrainResult> {
  const maxItems = Math.min(10, Math.max(1, opts.maxItems ?? 3));
  const runId = opts.runId ?? null;

  let requeued = 0;
  if (opts.requeueStale) {
    requeued = await requeueStaleItems(
      db,
      opts.spaceId,
      typeof opts.staleSeconds === "number" ? opts.staleSeconds : 300,
    );
  }

  const items = await claimNextWorkItems(db, {
    spaceId: opts.spaceId,
    kinds: opts.kinds,
    maxItems,
  });
  if (items.length === 0) {
    return {
      space_id: opts.spaceId,
      claimed: 0,
      results: [],
      requeued_stale: requeued,
      run_id: runId,
    };
  }

  const results: ItemResult[] = [];
  for (const item of items) {
    try {
      const r = await executeItem(db, item, runId);
      results.push(r);
    } catch (err) {
      // Last-resort guard: the dispatch itself threw. Mark failed so
      // the row doesn't sit in_progress forever.
      const reason = err instanceof Error ? err.message : String(err);
      await failWorkItem(db, item.id, reason);
      results.push({
        id: item.id,
        candidate_id: item.candidate_id,
        kind: item.kind,
        status: "failed",
        outcome: reason,
      });
    }
  }

  return {
    space_id: opts.spaceId,
    claimed: items.length,
    results,
    requeued_stale: requeued,
    run_id: runId,
  };
}

// ── Dispatch per kind ─────────────────────────────────────────────────

async function executeItem(
  db: AnyDb,
  item: SpaceWorkItem,
  runId: string | null,
): Promise<ItemResult> {
  switch (item.kind) {
    case "signature_deepen":
      return executeSignatureDeepen(db, item, runId);

    case "intervention_combination":
      return executeInterventionCombination(db, item);

    case "axis":
    case "edge_space":
    case "convergent_point":
    case "intersection_probe":
      // Recognized but not yet implemented. Mark completed with a
      // stub so the queue drains. The calibration sweep can detect
      // these (outcome_summary contains "[stub]") and treat them as
      // neutral — neither paid off nor failed.
      await completeWorkItem(
        db,
        item.id,
        `[stub] ${item.kind} executor not yet implemented; planned reason: ${item.selection_reason.slice(0, 120)}`,
      );
      return {
        id: item.id,
        candidate_id: item.candidate_id,
        kind: item.kind,
        status: "skipped",
        outcome: "executor not implemented",
      };

    default: {
      // Defensive — enum exhaustiveness guard. If a new kind is added
      // to the schema without being added here, surface it loudly.
      const unknown: never = item.kind;
      await failWorkItem(db, item.id, `Unknown work kind: ${String(unknown)}`);
      return {
        id: item.id,
        candidate_id: item.candidate_id,
        kind: item.kind,
        status: "failed",
        outcome: `Unknown kind: ${String(unknown)}`,
      };
    }
  }
}

// ── signature_deepen executor ─────────────────────────────────────────
//
// Expects candidate_id format "sig:{entityId}" matching the planner's
// canonical id scheme (see space_plans.sql comment).
//
// Steps:
//   1. Parse entity id
//   2. Load entity + current signature
//   3. Load neighborhood (incoming/outgoing edges with named endpoints)
//   4. Call deepenNodeSignature (ONE llm call, ~400 tokens)
//   5. If a ring was added, persist + emit signature_deepened event
//   6. completeWorkItem with a human-readable outcome

async function executeSignatureDeepen(
  db: AnyDb,
  item: SpaceWorkItem,
  runId: string | null,
): Promise<ItemResult> {
  const entityId = parseEntityIdFromCandidateId(item.candidate_id);
  if (!entityId) {
    await failWorkItem(db, item.id, `Bad candidate_id format: ${item.candidate_id}`);
    return {
      id: item.id,
      candidate_id: item.candidate_id,
      kind: item.kind,
      status: "failed",
      outcome: "bad candidate_id",
    };
  }

  // Entity + current signature
  const { data: entRow, error: entErr } = await db
    .from("entities")
    .select("id, name, entity_category, importance, node_signature, space_id")
    .eq("id", entityId)
    .eq("space_id", item.space_id)
    .maybeSingle();
  if (entErr || !entRow) {
    await failWorkItem(db, item.id, `Entity not found: ${entityId}`);
    return {
      id: item.id,
      candidate_id: item.candidate_id,
      kind: item.kind,
      status: "failed",
      outcome: "entity not found",
    };
  }
  const entity = entRow as Entity & { node_signature: NodeSignature | null };
  const current = entity.node_signature;
  if (!current) {
    // No seed yet — tell the caller to run materialize-signatures
    // first. Fail the item rather than silently seed here, because
    // seeding mid-executor would muddle the cost accounting.
    await failWorkItem(
      db,
      item.id,
      "Entity has no seed signature; run materialize-signatures first",
    );
    return {
      id: item.id,
      candidate_id: item.candidate_id,
      kind: item.kind,
      status: "failed",
      outcome: "no seed signature",
    };
  }

  // Neighborhood — only the columns the deepen prompt reads.
  const { data: edgeRows } = await db
    .from("edges")
    .select("id, source_entity_id, target_entity_id, relationship_type, mechanism")
    .eq("space_id", item.space_id)
    .or(`source_entity_id.eq.${entityId},target_entity_id.eq.${entityId}`);
  const edges = (edgeRows ?? []) as Array<
    Pick<Edge, "id" | "source_entity_id" | "target_entity_id" | "relationship_type"> & {
      mechanism: string | null;
    }
  >;

  // Pull neighbor names in one batch
  const neighborIds = new Set<string>();
  for (const e of edges) {
    if (e.source_entity_id && e.source_entity_id !== entityId) neighborIds.add(e.source_entity_id);
    if (e.target_entity_id && e.target_entity_id !== entityId) neighborIds.add(e.target_entity_id);
  }
  const neighborNameMap = new Map<string, string>();
  if (neighborIds.size > 0) {
    const { data: nRows } = await db
      .from("entities")
      .select("id, name")
      .in("id", Array.from(neighborIds));
    for (const n of (nRows ?? []) as Array<{ id: string; name: string }>) {
      neighborNameMap.set(n.id, n.name);
    }
  }

  const incoming: Array<{ relation: string; from_name: string; mechanism: string | null }> = [];
  const outgoing: Array<{ relation: string; to_name: string; mechanism: string | null }> = [];
  for (const e of edges) {
    if (e.target_entity_id === entityId && e.source_entity_id) {
      incoming.push({
        relation: e.relationship_type ?? "relates_to",
        from_name: neighborNameMap.get(e.source_entity_id) ?? "(unknown)",
        mechanism: e.mechanism ?? null,
      });
    } else if (e.source_entity_id === entityId && e.target_entity_id) {
      outgoing.push({
        relation: e.relationship_type ?? "relates_to",
        to_name: neighborNameMap.get(e.target_entity_id) ?? "(unknown)",
        mechanism: e.mechanism ?? null,
      });
    }
  }

  // Axis memberships — scraped from source_axis on existing rings.
  // Cheap alternative to re-reading space_entity_added events per item.
  const axisSet = new Set<ProbabilitySpaceAxis>();
  for (const b of current.basis) {
    if (b.source_axis) axisSet.add(b.source_axis);
  }
  const axisMemberships = Array.from(axisSet);

  const { updated, added, stopReason } = await deepenNodeSignature({
    entity,
    currentSignature: current,
    neighborhood: { incoming, outgoing, axisMemberships },
  });

  if (!added) {
    // Pinned — persist updated resolution metadata (pinned_because)
    // so future strategizer cycles know not to re-propose this node.
    await persistSignature(db, entityId, updated);
    await completeWorkItem(db, item.id, `pinned: ${stopReason.slice(0, 200)}`);
    return {
      id: item.id,
      candidate_id: item.candidate_id,
      kind: item.kind,
      status: "completed",
      outcome: `pinned (${stopReason.slice(0, 80)})`,
    };
  }

  const persisted = await persistSignature(db, entityId, updated);
  if (!persisted) {
    await failWorkItem(db, item.id, "Persist failed after successful deepen");
    return {
      id: item.id,
      candidate_id: item.candidate_id,
      kind: item.kind,
      status: "failed",
      outcome: "persist failed",
    };
  }

  // Fire event — the canvas painter uses this to animate the new ring
  // into place. Soft-failing here would still leave the DB correct.
  await emitSignatureDeepened(db, runId, updated, added);

  const outcomeSummary =
    `deepened ring ${added.index} [${added.code}] "${added.label}" ` +
    `(+contribution ${added.contribution.toFixed(2)}, residual now ${updated.residual_uncertainty.toFixed(2)})`;
  await completeWorkItem(db, item.id, outcomeSummary);

  return {
    id: item.id,
    candidate_id: item.candidate_id,
    kind: item.kind,
    status: "completed",
    outcome: outcomeSummary,
  };
}

// ── helpers ───────────────────────────────────────────────────────────
//
// Canonical candidate id format for signature_deepen is "sig:{entityId}"
// as specified in the space_work_queue schema comment. Be lenient — if
// someone passes a bare UUID, accept it too.

function parseEntityIdFromCandidateId(candidateId: string): string | null {
  if (!candidateId) return null;
  if (candidateId.startsWith("sig:")) {
    const id = candidateId.slice(4).trim();
    return isUuidLike(id) ? id : null;
  }
  return isUuidLike(candidateId) ? candidateId : null;
}

function isUuidLike(s: string): boolean {
  return /^[0-9a-f-]{8,}$/i.test(s);
}

// ── intervention_combination executor ────────────────────────────────
//
// Phase 4 §5.3 nominates pair-of-levers candidates with the canonical
// candidate_id "combo:{aId}+{bId}" (ids sorted lexicographically). The
// strategizer picks the highest-value pairs and the executor's job is
// to actually ASK what their joint effect implies — using the same
// combination interpreter that powers the canvas's combination card.
//
// Without this branch the strategizer's combination work would have no
// payoff: the LLM-generated joint analysis is the visible artifact.
//
// Persistence strategy: write a `space_combination_results` row keyed
// on (plan_id, work_item_id) so calibration + the plan drawer can find
// it later. Soft-fail if the table doesn't exist (matches the
// soft-fail philosophy in space_intersections / other JSONB-backed
// strategy artifacts) — the outcome_summary itself carries enough of
// the result that the queue strip is still informative.

async function executeInterventionCombination(
  db: AnyDb,
  item: SpaceWorkItem,
): Promise<ItemResult> {
  const pair = parseComboCandidateId(item.candidate_id);
  if (!pair) {
    await failWorkItem(db, item.id, `Bad combo candidate_id: ${item.candidate_id}`);
    return {
      id: item.id,
      candidate_id: item.candidate_id,
      kind: item.kind,
      status: "failed",
      outcome: "bad combo candidate_id",
    };
  }

  const result = await runCanvasCombination(db, [pair.a, pair.b]);
  if (!result) {
    await failWorkItem(
      db,
      item.id,
      `Combination interpretation failed (entities not resolved): ${pair.a} + ${pair.b}`,
    );
    return {
      id: item.id,
      candidate_id: item.candidate_id,
      kind: item.kind,
      status: "failed",
      outcome: "entities not resolved",
    };
  }

  // Persist the full result so downstream surfaces (plan drawer,
  // calibration sweep, future canvas-painter) can find it. Soft-fail —
  // the queue's outcome_summary carries the headline so the user still
  // sees something even if persistence is offline.
  try {
    const { error: insErr } = await db.from("space_combination_results").insert({
      space_id: item.space_id,
      user_id: item.user_id,
      plan_id: item.plan_id,
      work_item_id: item.id,
      candidate_id: item.candidate_id,
      entity_a_id: pair.a,
      entity_b_id: pair.b,
      title: result.title,
      implication: result.implication,
      novelty: result.novelty,
      mechanism: result.mechanism,
      probes: result.probes,
    });
    if (insErr) {
      // Likely table missing — log + continue; the outcome_summary
      // still carries the headline.
      console.warn("[combo-exec] persist combination result failed:", insErr);
    }
  } catch (persistErr) {
    console.warn("[combo-exec] persist threw:", persistErr);
  }

  // The outcome_summary doubles as the calibration sweep's
  // payoff-detection signal: if it doesn't start with "[stub]" the
  // calibrator counts the work item as having paid off. Including the
  // novelty + headline keeps the queue strip informative without
  // pulling the whole result down.
  const noveltyTag =
    result.novelty === "emergent"
      ? "EMERGENT"
      : result.novelty === "tension"
        ? "TENSION"
        : result.novelty === "reinforcing"
          ? "REINFORCING"
          : "TRIVIAL";
  const outcomeSummary = `[${noveltyTag}] ${result.title} — ${result.implication.slice(0, 200)}`;
  await completeWorkItem(db, item.id, outcomeSummary);

  return {
    id: item.id,
    candidate_id: item.candidate_id,
    kind: item.kind,
    status: "completed",
    outcome: outcomeSummary.slice(0, 200),
  };
}

// Parse "combo:{aId}+{bId}" → {a, b}. Tolerant of either order; the
// strategizer sorts before emitting but we don't rely on that.
function parseComboCandidateId(candidateId: string): { a: string; b: string } | null {
  if (!candidateId.startsWith("combo:")) return null;
  const body = candidateId.slice(6);
  const plusIdx = body.indexOf("+");
  if (plusIdx <= 0 || plusIdx >= body.length - 1) return null;
  const a = body.slice(0, plusIdx).trim();
  const b = body.slice(plusIdx + 1).trim();
  if (!isUuidLike(a) || !isUuidLike(b)) return null;
  return { a, b };
}
