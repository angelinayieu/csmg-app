// ── D2 · Discovery materializer ──────────────────────────────────────
//
// D2 in docs/KG_DEPTH_CRITIQUE.md: closes the simulation→KG loop.
// Today the convergence engine writes `convergent_points` rows
// describing high-confidence interactor → focal-entity relationships,
// but those rows never become live KG edges — they sit in an
// auxiliary table that the canvas reads but the strategizer doesn't.
//
// This module is the bridge: it scans `convergent_points` rows above a
// confidence threshold and proposes them as `twin_proposals` entries
// (user_status='proposed', discovery_source='convergent_point') with
// an `action_list` of `add_edge` mutations that the user can approve
// in the existing twin proposal review UI. On approval (D2 phase 2,
// not in this first cut) the action_list flows through
// commit-scenario.ts and writes to the live `edges` table.
//
// Why we go through twin_proposals instead of writing to edges
// directly: docs/KG_DEPTH_CRITIQUE.md §5 — auto-promoting LLM-derived
// findings to live KG without explicit human approval is exactly the
// kind of structural commitment we're not yet ready to make. The
// proposal queue is the safety valve.
//
// First-cut scope (this module):
//   • only handles `convergent_point` discovery_source
//   • only generates `add_edge` actions (interactor → focal)
//   • idempotent: skips convergent points that already have a
//     non-rejected proposal row
//   • soft-fails per row: a single broken convergent point doesn't
//     halt the batch
//
// Future expansions (D2 phases 2+):
//   • mediator-entity extraction from outcome.mechanism prose
//   • what-if and combination discovery sources
//   • approval-to-commit-scenario route

import type {
  ConvergentPoint,
  OutcomePolarity,
  OutcomeTimeHorizon,
} from "@/types/convergent-point";
import type { AddEdgeAction, ScenarioAction } from "@/types/scenario";
import {
  DEFAULT_CONVERGENT_POINT_PROPOSE_THRESHOLDS,
  type ConvergentPointProposeThresholds,
  type DiscoveryProposalJustification,
} from "@/types/discovery-proposal";

// ── Public entry points ──────────────────────────────────────────────

export interface ProposeFromConvergentPointInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  point: ConvergentPoint;
  /** User who owns the space (twin_proposals.user_id is NOT NULL). */
  userId: string;
  /** Optional override; otherwise DEFAULT_CONVERGENT_POINT_PROPOSE_THRESHOLDS. */
  thresholds?: Partial<ConvergentPointProposeThresholds>;
}

export type ProposeOutcome =
  | { ok: true; proposalId: string; actionsProposed: number }
  | { ok: false; reason: string };

/**
 * Propose ONE convergent point as a discovery proposal. Idempotent:
 * if a non-rejected proposal already exists for this convergent
 * point, returns ok with the existing id.
 *
 * Soft-fails on:
 *   • below-threshold convergent point (returns reason="below_threshold")
 *   • zero interactors (no edges to propose)
 *   • DB write error (returns the error message)
 *
 * Throws on:
 *   • nothing — caller can treat ok=false as a no-op
 */
export async function proposeFromConvergentPoint(
  input: ProposeFromConvergentPointInput,
): Promise<ProposeOutcome> {
  const { db, point, userId } = input;
  const thresholds: ConvergentPointProposeThresholds = {
    ...DEFAULT_CONVERGENT_POINT_PROPOSE_THRESHOLDS,
    ...(input.thresholds ?? {}),
  };

  // ── Threshold gate ──
  if (!passesPropose(point, thresholds)) {
    return { ok: false, reason: "below_threshold" };
  }

  // ── Idempotency ──
  // Skip if a non-rejected proposal already exists for this point.
  // We allow re-proposing after rejection so the user can update
  // thresholds and re-run.
  const { data: existing, error: existingErr } = await db
    .from("twin_proposals")
    .select("id, user_status")
    .eq("convergent_point_id", point.id)
    .neq("user_status", "rejected")
    .limit(1);
  if (existingErr) {
    return { ok: false, reason: `idempotency_check_failed: ${existingErr.message ?? existingErr}` };
  }
  if (Array.isArray(existing) && existing.length > 0) {
    return {
      ok: true,
      proposalId: (existing[0] as { id: string }).id,
      actionsProposed: 0,
    };
  }

  // ── Build the action list ──
  const actionList = buildActionListForConvergentPoint(point);
  if (actionList.length === 0) {
    return { ok: false, reason: "no_actions_to_propose" };
  }

  // ── Build the justification JSONB ──
  const maxAlignment = topAlignment(point);
  const justification: DiscoveryProposalJustification = {
    discovery_source: "convergent_point",
    source_row_id: point.id,
    signal: {
      confidence: point.confidence,
      probability: point.probability,
      objective_alignment: maxAlignment,
      generation_method: point.generation_method,
      structural_signature: point.structural_signature,
    },
    rationale: buildRationale(point, maxAlignment),
    proposed_action_list: actionList,
    generated_at: new Date().toISOString(),
  };

  // ── Insert the twin_proposal row ──
  const { data: inserted, error: insertErr } = await db
    .from("twin_proposals")
    .insert({
      space_id: point.space_id,
      user_id: userId,
      justification,
      mechanism_ids: [],
      user_status: "proposed",
      discovery_source: "convergent_point",
      convergent_point_id: point.id,
    })
    .select("id")
    .single();
  if (insertErr) {
    return { ok: false, reason: `insert_failed: ${insertErr.message ?? insertErr}` };
  }
  if (!inserted || typeof (inserted as { id?: unknown }).id !== "string") {
    return { ok: false, reason: "insert_returned_no_id" };
  }
  return {
    ok: true,
    proposalId: (inserted as { id: string }).id,
    actionsProposed: actionList.length,
  };
}

// ── Batch entry ──────────────────────────────────────────────────────

export interface ProposeFromConvergentPointsBatchInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  spaceId: string;
  userId: string;
  thresholds?: Partial<ConvergentPointProposeThresholds>;
  /** Cap to avoid runaway proposals on huge spaces. Default 25. */
  maxProposals?: number;
}

export interface ProposeBatchResult {
  proposed: Array<{ convergentPointId: string; proposalId: string; actions: number }>;
  skipped: Array<{ convergentPointId: string; reason: string }>;
  totalConsidered: number;
}

/**
 * Scan all convergent_points for a space and propose every one above
 * threshold (up to maxProposals). Idempotent — re-running on the
 * same space is safe (existing proposals are detected by
 * convergent_point_id).
 *
 * Soft-fails per row, returns aggregate results.
 */
export async function proposeFromConvergentPointsBatch(
  input: ProposeFromConvergentPointsBatchInput,
): Promise<ProposeBatchResult> {
  const { db, spaceId, userId } = input;
  const maxProposals = input.maxProposals ?? 25;

  const proposed: ProposeBatchResult["proposed"] = [];
  const skipped: ProposeBatchResult["skipped"] = [];

  // Pull only candidates above the propose threshold to keep the
  // batch tight. Use the inputs.thresholds (or defaults) for the
  // SQL filter; threshold checks inside proposeFromConvergentPoint
  // remain authoritative for borderline cases.
  const t: ConvergentPointProposeThresholds = {
    ...DEFAULT_CONVERGENT_POINT_PROPOSE_THRESHOLDS,
    ...(input.thresholds ?? {}),
  };
  const { data: candidates, error: queryErr } = await db
    .from("convergent_points")
    .select("*")
    .eq("space_id", spaceId)
    .gte("confidence", t.confidence)
    .gte("probability", t.probability)
    .order("confidence", { ascending: false })
    .limit(maxProposals * 3); // overfetch for thresholds the SQL can't express (objective_alignment is JSONB)

  if (queryErr) {
    return {
      proposed: [],
      skipped: [
        {
          convergentPointId: "",
          reason: `query_failed: ${queryErr.message ?? queryErr}`,
        },
      ],
      totalConsidered: 0,
    };
  }

  const points = (candidates ?? []) as ConvergentPoint[];
  const totalConsidered = points.length;

  for (const p of points) {
    if (proposed.length >= maxProposals) break;
    const result = await proposeFromConvergentPoint({
      db,
      point: p,
      userId,
      thresholds: input.thresholds,
    });
    if (result.ok) {
      proposed.push({
        convergentPointId: p.id,
        proposalId: result.proposalId,
        actions: result.actionsProposed,
      });
    } else {
      skipped.push({ convergentPointId: p.id, reason: result.reason });
    }
  }

  return { proposed, skipped, totalConsidered };
}

// ── Internals: threshold check ────────────────────────────────────────

function passesPropose(
  point: ConvergentPoint,
  t: ConvergentPointProposeThresholds,
): boolean {
  if (point.confidence < t.confidence) return false;
  if (point.probability < t.probability) return false;
  // objective_alignment is array of ObjectiveAlignment rows. We
  // require at least ONE objective with score >= threshold (positive
  // alignment to SOME goal). A point with all-negative or all-zero
  // alignments shouldn't be promoted even if confidence is high.
  const top = topAlignmentScore(point);
  if (top < t.objective_alignment) return false;
  return true;
}

function topAlignmentScore(point: ConvergentPoint): number {
  if (!Array.isArray(point.objective_alignment)) return 0;
  let max = 0;
  for (const a of point.objective_alignment) {
    if (typeof a?.score === "number" && a.score > max) max = a.score;
  }
  return max;
}

function topAlignment(
  point: ConvergentPoint,
): { objective_id: string; objective_title: string; score: number } | null {
  if (!Array.isArray(point.objective_alignment)) return null;
  let best: { objective_id: string; objective_title: string; score: number } | null = null;
  for (const a of point.objective_alignment) {
    if (typeof a?.score !== "number") continue;
    if (best === null || a.score > best.score) {
      best = {
        objective_id: a.objective_id,
        objective_title: a.objective_title,
        score: a.score,
      };
    }
  }
  return best;
}

// ── Internals: action_list construction ──────────────────────────────

/**
 * Convert one ConvergentPoint into a list of `add_edge` actions
 * proposing edges from each interactor to the focal entity.
 *
 * Rationale for THIS specific shape (interactor → focal, not focal →
 * interactor): the convergence engine generates points from the
 * focal entity's role + interactors that activate that role. The
 * outcome describes how the focal IS SHAPED BY the interactors. So
 * the natural causal direction is interactor → focal.
 *
 * For the FIRST CUT we generate one edge per interactor. A future
 * pass can collapse multi-interactor points into hyperedges
 * (D4 territory) or extract mediator entities from outcome.mechanism
 * prose (D2 phase 2).
 */
export function buildActionListForConvergentPoint(
  point: ConvergentPoint,
): ScenarioAction[] {
  if (!Array.isArray(point.interactor_entity_ids)) return [];
  if (point.interactor_entity_ids.length === 0) return [];
  if (!point.focal_entity_id) return [];

  const polarity = mapPolarity(point.outcome?.polarity);
  const dynamics = mapDynamics(point.outcome?.time_horizon);
  const relationshipType = relationshipTypeFromOutcome(
    point.outcome?.polarity,
    point.outcome?.mechanism,
  );

  const actions: AddEdgeAction[] = [];
  for (const interactorId of point.interactor_entity_ids) {
    if (!interactorId) continue;
    if (interactorId === point.focal_entity_id) continue; // self-edges blocked
    actions.push({
      kind: "add_edge",
      // Client-generated UUID inserted directly into edges.id by
      // commit-scenario's add_edge handler (no DB-side default
      // applied when the action provides an id). MUST be a real UUID
      // — Postgres rejects malformed strings on uuid columns. We
      // generate a fresh one per call; idempotency at the proposal
      // level is handled by twin_proposals.convergent_point_id, so
      // re-running the materializer on the same point doesn't
      // create duplicate edges (the idempotency check short-circuits
      // before action_list construction).
      edgeId: randomUUID(),
      source_entity_id: interactorId,
      target_entity_id: point.focal_entity_id,
      relationship_type: relationshipType,
      polarity,
      strength: clamp01(point.confidence),
      confidence: clamp01(point.confidence),
      dynamics,
      rationale: buildEdgeRationale(point),
    });
  }
  return actions;
}

function mapPolarity(p: OutcomePolarity | undefined): AddEdgeAction["polarity"] {
  if (p === "positive" || p === "negative" || p === "neutral" || p === "conditional") {
    return p;
  }
  return "neutral";
}

function mapDynamics(h: OutcomeTimeHorizon | undefined): string | undefined {
  // Maps the outcome time horizon onto an edge dynamics taxonomy
  // value. Not exhaustive — leave unknowns as undefined so the
  // existing default ("linear") applies on DB write.
  switch (h) {
    case "immediate":
    case "hours":
      return "linear";
    case "days":
    case "months":
      return "delayed";
    case "years":
      return "compounding";
    default:
      return undefined;
  }
}

function relationshipTypeFromOutcome(
  polarity: OutcomePolarity | undefined,
  _mechanism: string | undefined,
): string {
  // Conservative mapping. The mechanism prose is too noisy to derive a
  // robust verb without an LLM call, so we use polarity as a proxy.
  // Future work: have the convergence engine emit a structured
  // relationship_type alongside the polarity.
  if (polarity === "positive") return "amplifies";
  if (polarity === "negative") return "inhibits";
  if (polarity === "conditional") return "moderates";
  return "shapes";
}

function buildEdgeRationale(point: ConvergentPoint): string {
  const desc = (point.outcome?.description ?? "").trim();
  return desc.length > 0
    ? `${desc} [D2:convergent_point:${point.id}]`
    : `Discovered via convergent point ${point.id}`;
}

function buildRationale(
  point: ConvergentPoint,
  topAlign: { objective_title: string; score: number } | null,
): string {
  const parts: string[] = [];
  parts.push(
    `Convergent point with confidence ${(point.confidence * 100).toFixed(0)}% and probability ${(point.probability * 100).toFixed(0)}%.`,
  );
  if (point.outcome?.description) parts.push(point.outcome.description);
  if (topAlign && topAlign.score > 0) {
    parts.push(
      `Aligned with objective "${topAlign.objective_title}" (score ${(topAlign.score * 100).toFixed(0)}%).`,
    );
  }
  parts.push(
    `Promoting ${point.interactor_entity_ids?.length ?? 0} interactor → focal edge${
      point.interactor_entity_ids?.length === 1 ? "" : "s"
    } for review.`,
  );
  return parts.join(" ");
}

/**
 * Generate a fresh UUID for client-side action ID assignment. Uses
 * the Web Crypto API which is available in Node 20+ and Edge runtimes.
 * Wrapped in a tiny helper so the call site reads naturally and
 * tests can mock it if needed.
 */
function randomUUID(): string {
  // crypto.randomUUID is global in Node 20+ and the Web Crypto API.
  return crypto.randomUUID();
}

function clamp01(x: number | null | undefined): number {
  if (typeof x !== "number" || Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
