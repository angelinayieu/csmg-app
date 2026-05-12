// ── Proto-entity materialization at framing-approval time ────────────
//
// TIER: 2 (situation KG/ABox) — but populates Tier 1 hooks
//       (canonical_code, derived_from, conditional_context) so the
//       Week 6+ canonical_concepts backfill is cheap.
//
// What this library does:
//   At framing-approval time (proposed → approved flip), extract the
//   high-information artifacts from the chosen framing payload and
//   materialize them as `entities` rows. The downstream KG no longer
//   has to re-derive the framing's structure from prompt text;
//   decompose can LINK to these proto-entities and expand them with
//   mechanism intermediates.
//
// What gets persisted as proto-entities:
//   ✓ The chosen framing itself     → 1 entity, internal × epistemic
//   ✓ The chosen framing's sub_problems → N entities, internal × process
//   ✓ The chosen framing's load-bearing assumption → 1 entity, conceptual × epistemic
//     (only when non-empty)
//
// What is NOT persisted (intentional — keeps entity-table bloat
// proportional to information content):
//   ✗ Rejected options[] — not the user's commitment; noise.
//   ✗ Per-lens named_risks — the chosen framing already carries
//     the load-bearing assumption that captures the highest-value risk.
//   ✗ proposed_axes — already first-class via probability_space_runs.
//   ✗ Cell opinions — 75+ per intake; their rationales should anchor
//     to whichever decomposed entity they motivate, not be entities
//     themselves.
//
// Edges materialized:
//   ✓ framing → sub_problem (relationship: "decomposes_into")
//   ✓ framing → load_bearing_assumption (relationship: "depends_on")
//
// Soft-fail discipline:
//   ALL writes are wrapped in try/catch. A failed proto-entity insert
//   does NOT roll back the framing approval — the approval is the
//   user's intent and must persist regardless of derived-state
//   write success. Errors are logged + returned in the result so
//   the caller can surface them (e.g., the pipeline_error banner).
//
// Idempotency:
//   This library assumes it's called ONCE per twin_proposal approval
//   (the route's /approve flow flips status proposed → approved
//   exactly once due to RLS + idempotent guards). If you call it
//   twice on the same twin_proposal_id, you'll get duplicate
//   entity rows. Future enhancement: deterministic IDs based on
//   hash(twin_proposal_id, framing_id, source_type) to make
//   reinvocations safe.

import type { SupabaseClient } from "@supabase/supabase-js";
// W6.2 — replace the dead stampCanonicalCode (which wrote to a
// non-existent node_signatures table) with the matcher, which writes
// to the live entities.canonical_concept_id FK column.
import { linkEntityToCanonicalConcept } from "@/lib/kg/canonical-concept-matcher";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

// ── Frame payload shape (matches twin_proposals.frame_payload) ─────

export interface FrameOption {
  framing_id: string;
  framing_title: string;
  chosen_approach: string;
  load_bearing_assumption?: string;
  proposed_axes?: unknown[];
  supporting_lenses?: string[];
  why_this_framing?: string;
  when_it_wins?: string;
  when_it_fails?: string;
  sub_objectives?: string[];
  confidence?: number;
  lens_id?: string;
}

export interface FramePayload {
  options: FrameOption[];
  chosen_rank: number;
  rejected_options?: unknown[];
  framed_at?: string;
  smallest_first_step?: boolean;
}

// ── Public API ──────────────────────────────────────────────────────

export interface PersistFramingProtosInput {
  spaceId: string;
  userId: string;
  twinProposalId: string;
  framePayload: FramePayload;
  /** Optional context fingerprint from the upstream pipeline run.
   *  Stored on each entity's `conditional_context.intake_signature`
   *  so the future weighter (Week 6+) can adaptively weight a
   *  framing higher / lower based on similarity of the new intake
   *  to this one. */
  intakeSignature?: {
    data_presence_score?: number;
    framing_confidence?: number;
    lens_consensus_count?: number;
  };
}

export interface PersistFramingProtosResult {
  ok: boolean;
  inserted_entities: number;
  inserted_edges: number;
  framing_entity_id: string | null;
  sub_problem_entity_ids: string[];
  assumption_entity_id: string | null;
  errors: string[];
  skipped_reason?: string;
}

const EMPTY_RESULT: Omit<PersistFramingProtosResult, "ok"> = {
  inserted_entities: 0,
  inserted_edges: 0,
  framing_entity_id: null,
  sub_problem_entity_ids: [],
  assumption_entity_id: null,
  errors: [],
};

/**
 * Materialize the user-approved problem framing as `entities` rows.
 *
 * Call this from the framing/select (or framing/approve) route AT THE
 * MOMENT user_status flips from 'proposed' → 'approved'. Earlier
 * (before approval) would persist un-reviewed cognition; later (after
 * decompose) would race with the canonical decompose entity writes.
 */
export async function persistFramingProtos(
  db: AnyDb,
  input: PersistFramingProtosInput,
): Promise<PersistFramingProtosResult> {
  const result: PersistFramingProtosResult = { ok: true, ...EMPTY_RESULT };

  // ── Resolve chosen option ────────────────────────────────────────
  const payload = input.framePayload;
  if (!payload || !Array.isArray(payload.options) || payload.options.length === 0) {
    return {
      ...result,
      ok: false,
      skipped_reason: "frame_payload has no options to materialize",
    };
  }

  const chosenIndex = Math.max(
    0,
    Math.min(payload.options.length - 1, (payload.chosen_rank ?? 1) - 1),
  );
  const chosen = payload.options[chosenIndex];
  if (!chosen) {
    return {
      ...result,
      ok: false,
      skipped_reason: `chosen_rank ${payload.chosen_rank} out of bounds`,
    };
  }

  // Skip materialization entirely when the framing was the synthetic
  // single-option fallback (no real divergence — nothing meaningful
  // to persist as proto-entities). The flag is set by frame-panel/
  // route.ts when usedDivergentPath was false.
  if (payload.smallest_first_step === true) {
    return {
      ...result,
      ok: true,
      skipped_reason:
        "frame_payload.smallest_first_step=true (fallback path; no divergent framings to persist)",
    };
  }

  // ── Build the conditional_context (Bareinboim selection-diagram) ─
  // Shared shape across all proto-entities for this framing. Each
  // entity's conditional_context.when_it_wins/fails is taken from
  // the framing's payload; the intake_signature is the same across
  // all proto-entities (they share the same situation context).
  const conditionalContext = {
    when_it_wins: chosen.when_it_wins ?? "",
    when_it_fails: chosen.when_it_fails ?? "",
    requires_data_presence: null,
    intake_signature: input.intakeSignature ?? {},
  };

  // ── 1. Persist the framing itself ───────────────────────────────
  // The framing entity carries: name = framing_title, description =
  // chosen_approach. category=epistemic (it's a stance/proposition,
  // not a measurable thing or a process). Importance is `primary`
  // because the chosen framing is THE anchor for the downstream KG.
  const framingDerivedFrom = {
    source_type: "lens_framing" as const,
    lens_id: chosen.lens_id ?? "unknown",
    framing_id: chosen.framing_id,
    twin_proposal_id: input.twinProposalId,
    source_text_excerpt: chosen.chosen_approach.slice(0, 200),
  };

  const framingRow = {
    space_id: input.spaceId,
    name: chosen.framing_title.slice(0, 200),
    description: chosen.chosen_approach.slice(0, 1000),
    category: "epistemic" as const,
    knowledge_layer: "internal" as const,
    importance: "primary" as const,
    confidence: clamp01(chosen.confidence ?? 0.5),
    derived_from: framingDerivedFrom,
    conditional_context: conditionalContext,
  };

  const { framingEntityId, error: framingErr } = await insertEntitySafe(
    db,
    framingRow,
  );
  if (framingErr) {
    result.errors.push(`framing insert failed: ${framingErr}`);
    result.ok = false;
    // Without the framing entity we can't link sub-problems to it
    // (the edges need a source). Return early with what we have.
    return result;
  }

  result.framing_entity_id = framingEntityId;
  result.inserted_entities += 1;

  // W6.2 — link to canonical_concepts. Replaces the old
  // stampCanonicalCode that wrote to the non-existent node_signatures
  // table. Soft-fails: a null return means we don't link (entity
  // still persists, canonical_concept_id stays NULL).
  await linkAndStamp(db, framingEntityId, chosen.framing_title, input.spaceId, input.userId);

  // ── 2. Persist sub-problems ──────────────────────────────────────
  const subProblems = Array.isArray(chosen.sub_objectives)
    ? chosen.sub_objectives.filter(
        (s): s is string => typeof s === "string" && s.trim().length > 0,
      )
    : [];

  for (let i = 0; i < subProblems.length; i++) {
    const subText = subProblems[i];
    const subRow = {
      space_id: input.spaceId,
      // Truncate to entity name max; full text in description.
      name: subText.slice(0, 120),
      description: subText.slice(0, 1000),
      category: "process" as const,
      knowledge_layer: "internal" as const,
      // Sub-problems are secondary to the framing itself but still
      // load-bearing — they're the concrete decomposition the user
      // is committing to chase.
      importance: "secondary" as const,
      confidence: clamp01(chosen.confidence ?? 0.5),
      derived_from: {
        source_type: "lens_subproblem" as const,
        lens_id: chosen.lens_id ?? "unknown",
        framing_id: chosen.framing_id,
        twin_proposal_id: input.twinProposalId,
        sub_problem_index: i,
        source_text_excerpt: subText.slice(0, 200),
      },
      conditional_context: conditionalContext,
    };

    const { framingEntityId: subId, error: subErr } = await insertEntitySafe(
      db,
      subRow,
    );
    if (subErr) {
      result.errors.push(`sub_problem[${i}] insert failed: ${subErr}`);
      continue;
    }
    result.sub_problem_entity_ids.push(subId);
    result.inserted_entities += 1;

    await linkAndStamp(db, subId, subText, input.spaceId, input.userId);

    // Edge: framing → sub_problem (decomposes_into)
    const edgeErr = await insertEdgeSafe(db, {
      space_id: input.spaceId,
      source_entity_id: framingEntityId,
      target_entity_id: subId,
      relationship_type: "decomposes_into",
      dimension: "structural",
      polarity: "positive",
      strength: 0.8,
      confidence: clamp01(chosen.confidence ?? 0.5),
      description: `Sub-problem ${i + 1} of "${chosen.framing_title}"`,
    });
    if (edgeErr) {
      result.errors.push(
        `framing→sub_problem[${i}] edge insert failed: ${edgeErr}`,
      );
      continue;
    }
    result.inserted_edges += 1;
  }

  // ── 3. Persist load-bearing assumption (if non-empty) ────────────
  const lba =
    typeof chosen.load_bearing_assumption === "string"
      ? chosen.load_bearing_assumption.trim()
      : "";

  if (lba.length > 0) {
    const lbaRow = {
      space_id: input.spaceId,
      // Name: first 80 chars (or the whole thing) as a hint; full
      // text in description.
      name: lba.slice(0, 80),
      description: lba.slice(0, 1000),
      category: "epistemic" as const,
      knowledge_layer: "conceptual" as const,
      importance: "secondary" as const,
      confidence: clamp01(chosen.confidence ?? 0.5),
      derived_from: {
        source_type: "lens_assumption" as const,
        lens_id: chosen.lens_id ?? "unknown",
        framing_id: chosen.framing_id,
        twin_proposal_id: input.twinProposalId,
        source_text_excerpt: lba.slice(0, 200),
      },
      conditional_context: conditionalContext,
    };

    const { framingEntityId: lbaId, error: lbaErr } = await insertEntitySafe(
      db,
      lbaRow,
    );
    if (lbaErr) {
      result.errors.push(`assumption insert failed: ${lbaErr}`);
    } else {
      result.assumption_entity_id = lbaId;
      result.inserted_entities += 1;

      await linkAndStamp(db, lbaId, lba, input.spaceId, input.userId);

      // Edge: framing → assumption (depends_on)
      const edgeErr = await insertEdgeSafe(db, {
        space_id: input.spaceId,
        source_entity_id: framingEntityId,
        target_entity_id: lbaId,
        relationship_type: "depends_on",
        dimension: "epistemic",
        polarity: "positive",
        strength: 0.9,
        confidence: clamp01(chosen.confidence ?? 0.5),
        description: `"${chosen.framing_title}" depends on this load-bearing assumption holding`,
      });
      if (edgeErr) {
        result.errors.push(
          `framing→assumption edge insert failed: ${edgeErr}`,
        );
      } else {
        result.inserted_edges += 1;
      }
    }
  }

  return result;
}

// ── Internals ───────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

/**
 * Insert a single entity row + return its id. Returns { error: string }
 * on failure so the caller can accumulate errors without throwing.
 */
async function insertEntitySafe(
  db: AnyDb,
  row: Record<string, unknown>,
): Promise<{ framingEntityId: string; error: null } | { framingEntityId: ""; error: string }> {
  try {
    const { data, error } = await db
      .from("entities")
      .insert(row)
      .select("id")
      .single();
    if (error) {
      return { framingEntityId: "", error: error.message ?? "(unknown)" };
    }
    if (!data) {
      return { framingEntityId: "", error: "insert returned no row" };
    }
    return {
      framingEntityId: (data as { id: string }).id,
      error: null,
    };
  } catch (err) {
    return {
      framingEntityId: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Insert a single edge row. Returns null on success, error message
 * on failure. We don't need the edge's id back today (proto-entity
 * edges are write-and-forget; the future weighter reads them
 * by source_entity_id).
 */
async function insertEdgeSafe(
  db: AnyDb,
  row: Record<string, unknown>,
): Promise<string | null> {
  try {
    const { error } = await db.from("edges").insert(row);
    if (error) {
      return error.message ?? "(unknown)";
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * W6.2 — Link a newly-inserted entity to its canonical_concepts row,
 * then write entities.canonical_concept_id. Replaces the dead
 * stampCanonicalCode function that wrote to a non-existent
 * node_signatures table.
 *
 * Soft-fail: a null match (un-normalizable source text) or DB failure
 * leaves canonical_concept_id as NULL — the entity is still
 * persisted; downstream tolerates the null.
 */
async function linkAndStamp(
  db: AnyDb,
  entityId: string,
  sourceText: string,
  spaceId: string,
  userId: string,
): Promise<void> {
  try {
    const conceptId = await linkEntityToCanonicalConcept(db, {
      sourceText,
      displayName: sourceText,
      spaceId,
      userId,
    });
    if (!conceptId) return;

    await db
      .from("entities")
      .update({ canonical_concept_id: conceptId })
      .eq("id", entityId);
  } catch (err) {
    console.warn(
      "[persist-framing-protos] canonical link failed (entity persisted, link NULL):",
      err instanceof Error ? err.message : err,
    );
  }
}
