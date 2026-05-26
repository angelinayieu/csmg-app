// ── Objective Canvas — sub-objective state helpers ──
//
// Extends the synthesis_data.objective_canvas slice (see
// clarifying-state.ts) with proposal + pick tracking.
//
// Shape:
//   synthesis_data.objective_canvas.sub_objectives = {
//     proposals: [{ id, title, summary, rationale, confidence,
//       recommended }],
//     picked_proposal_ids: [proposalId, ...],
//     picked_goal_ids: [improvement_goalId, ...],
//     generated_at: iso,
//   }
//
// `proposals` are pure AI artefacts (never written to the goals
// table). `picked_goal_ids` are the real improvement_goals rows
// inserted on confirm. `picked_proposal_ids` lets the UI re-mark
// proposals as picked when re-rendered after a refresh.

import {
  patchObjectiveCanvasState,
  readObjectiveCanvasState,
  type ObjectiveCanvasState,
} from "./clarifying-state";

/** Variant lab intents — the six directions the user can steer
 *  iterative regeneration. Each intent has a distinct prompt mixin
 *  and temperature (see decompose-prompt.ts). `initial` is the
 *  first-pass, no-context-from-existing baseline. */
export type SubObjectiveIntent =
  | "initial"
  | "creative"
  | "concrete"
  | "contrarian"
  | "gap_fill"
  | "ambitious"
  | "wildcard";

/** User disposition on a proposal. Mirrors the variation-disposition
 *  pattern in expand-item-detail. Drives confirm-eligibility +
 *  preference learning. */
export type SubObjectiveDisposition =
  | "elected"
  | "rejected"
  | "deferred"
  | null;

export interface SubObjectiveProposal {
  id: string;
  title: string;
  summary: string;
  rationale: string;
  /** 0–1, LLM self-reported. UI rounds + colors. */
  confidence: number;
  /** True for the top-3 the LLM judged most load-bearing. The picker
   *  pre-checks these. */
  recommended: boolean;
  /** Variant Lab — which batch this proposal came from. Older
   *  proposals predate batches; field is optional so legacy blocks
   *  still parse. The very first batch is intent: "initial". */
  batch_id?: string;
  /** Variant Lab — election state. The picker pre-selects elected
   *  proposals; confirm route falls through to picked_proposal_ids
   *  when no dispositions exist (back-compat). */
  disposition?: SubObjectiveDisposition;
  /** Variant Lab — 1-based indices into the parent objective's
   *  annotation lens (top-8 weight-sorted). Used to compute coverage
   *  / orphan flags + power the gap_fill intent prompt. Empty array
   *  when no annotation directly seeded the proposal. */
  lens_coverage?: number[];
}

export interface SubObjectiveBatch {
  /** Stable batch id (uuid). */
  id: string;
  /** Monotonic counter — 1 for the initial batch, 2 for the first
   *  variant-lab regen, etc. */
  generation_number: number;
  /** Which intent drove this batch (see SubObjectiveIntent). */
  intent: SubObjectiveIntent;
  /** Optional pointer to the batch this one was generated FROM, so
   *  the UI can show lineage if needed. */
  parent_batch_id?: string;
  /** LLM temperature actually used (intent-driven; surfaced for
   *  audit + A/B). */
  temperature: number;
  proposals: SubObjectiveProposal[];
  generated_at: string;
}

export interface SubObjectiveBlock {
  /** Backward-compat — flat proposal list. NEW WRITES mirror
   *  this from batches[]: it contains the union of all batch
   *  proposals, in batch order, so legacy readers keep working. */
  proposals: SubObjectiveProposal[];
  /** Variant Lab — full batch history. When present, this is the
   *  source of truth; `proposals` is a flattening for back-compat.
   *  Optional so legacy blocks (pre-batches) still parse and the
   *  picker can migrate them lazily on first regen. */
  batches?: SubObjectiveBatch[];
  picked_proposal_ids: string[];
  picked_goal_ids: string[];
  generated_at: string;
  /** Cluster analysis — Tier-2 LLM grouping of proposals into themed
   *  clusters. Computed on-demand by /api/brainstorm/sub-objectives/cluster.
   *  Survives reloads; invalidated when the proposal set changes (the
   *  proposals_hash inside ClusterAnalysis becomes stale and the
   *  picker offers to re-run). Untyped here to keep the state module
   *  decoupled from cluster-proposals.ts — the cluster route + UI
   *  cast it back to ClusterAnalysis when reading. */
  cluster_analysis?: unknown;
  /** Short noun phrase (≤3 words) naming what KIND of bucket these
   *  proposals are: "Features" for an app, "Lessons" for a course,
   *  "Bets" for a strategy, etc. LLM-supplied; shown in the picker
   *  header as "5 {category} proposed". Optional for back-compat
   *  with blocks generated before this field existed. */
  category?: string;
}

declare module "./clarifying-state" {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-unused-vars
  interface ObjectiveCanvasState {
    sub_objectives?: SubObjectiveBlock;
  }
}

export function readSubObjectiveBlock(
  state: ObjectiveCanvasState,
): SubObjectiveBlock | undefined {
  return state.sub_objectives;
}

export function writeSubObjectiveBlock(
  synthesisData: unknown,
  block: SubObjectiveBlock,
): Record<string, unknown> {
  return patchObjectiveCanvasState(synthesisData, {
    sub_objectives: block,
  });
}

/**
 * Normalize a raw LLM payload into clean SubObjectiveProposal[].
 * Drops malformed entries; clamps confidence; trims strings; enforces
 * `recommended` to ≤3 even if the LLM marked more. Also pulls
 * lens_coverage when present (Variant Lab).
 */
export function normalizeProposals(
  raw: unknown,
): SubObjectiveProposal[] {
  const items = Array.isArray(raw) ? raw : [];
  const cleaned = items
    .map((p): SubObjectiveProposal | null => {
      if (!p || typeof p !== "object") return null;
      const rec = p as Record<string, unknown>;
      const id = typeof rec.id === "string" ? rec.id : "";
      const title = typeof rec.title === "string" ? rec.title.trim() : "";
      if (title.length === 0) return null;
      const summary =
        typeof rec.summary === "string" ? rec.summary.trim() : "";
      const rationale =
        typeof rec.rationale === "string" ? rec.rationale.trim() : "";
      const confidence =
        typeof rec.confidence === "number" && Number.isFinite(rec.confidence)
          ? Math.max(0, Math.min(1, rec.confidence))
          : 0.5;
      const recommended = Boolean(rec.recommended);

      // Variant Lab — lens_coverage: 1-based annotation indices.
      // Dedup + cap at 5 (matches lens cap).
      const rawCoverage = Array.isArray(rec.lens_coverage)
        ? (rec.lens_coverage as unknown[])
        : [];
      const coverageSet = new Set<number>();
      for (const v of rawCoverage) {
        if (typeof v === "number" && Number.isFinite(v) && v >= 1) {
          coverageSet.add(Math.floor(v));
        }
      }
      const lens_coverage = Array.from(coverageSet).slice(0, 5);

      const batch_id =
        typeof rec.batch_id === "string" ? rec.batch_id : undefined;

      // Disposition is user-controlled, never LLM-emitted, but
      // preserve on re-normalize so server-side mutations don't drop
      // existing dispositions.
      const dispositionRaw = rec.disposition;
      const disposition: SubObjectiveDisposition =
        dispositionRaw === "elected" ||
        dispositionRaw === "rejected" ||
        dispositionRaw === "deferred"
          ? dispositionRaw
          : null;

      return {
        id,
        title,
        summary,
        rationale,
        confidence,
        recommended,
        ...(batch_id ? { batch_id } : {}),
        ...(lens_coverage.length > 0 ? { lens_coverage } : {}),
        disposition,
      };
    })
    .filter((p): p is SubObjectiveProposal => p !== null)
    .slice(0, 8);

  // Cap recommended to top-3 by confidence.
  const sortedByConf = [...cleaned].sort(
    (a, b) => b.confidence - a.confidence,
  );
  const recommendedIds = new Set(
    sortedByConf.slice(0, 3).map((p) => p.id),
  );
  return cleaned.map((p) => ({
    ...p,
    recommended: recommendedIds.has(p.id),
  }));
}

/** Flatten a block's batches into a single proposal list (in batch
 *  order, newest last). Used to compute the legacy `proposals` mirror
 *  field + power UI rendering of the full history. */
export function flattenBatchProposals(
  batches: SubObjectiveBatch[],
): SubObjectiveProposal[] {
  const out: SubObjectiveProposal[] = [];
  for (const b of batches) {
    for (const p of b.proposals) {
      out.push({ ...p, batch_id: b.id });
    }
  }
  return out;
}

/** Read every proposal across all batches when batches exist;
 *  otherwise fall through to the flat list (legacy block). */
export function allBlockProposals(
  block: SubObjectiveBlock,
): SubObjectiveProposal[] {
  if (block.batches && block.batches.length > 0) {
    return flattenBatchProposals(block.batches);
  }
  return block.proposals;
}

/** Coverage report — which lens indices (1..lensSize) are touched
 *  by any ELECTED proposal in the block, and which are uncovered.
 *  Used by the variant lab strip + gap_fill intent prompt. */
export function computeLensCoverage(
  block: SubObjectiveBlock,
  lensSize: number,
): { covered: number[]; uncovered: number[] } {
  const all = allBlockProposals(block);
  const covered = new Set<number>();
  for (const p of all) {
    if (p.disposition !== "elected") continue;
    if (!Array.isArray(p.lens_coverage)) continue;
    for (const idx of p.lens_coverage) {
      if (idx >= 1 && idx <= lensSize) covered.add(idx);
    }
  }
  const uncovered: number[] = [];
  for (let i = 1; i <= lensSize; i++) {
    if (!covered.has(i)) uncovered.push(i);
  }
  return {
    covered: Array.from(covered).sort((a, b) => a - b),
    uncovered,
  };
}

// Re-export so call sites can import from a single module.
export { readObjectiveCanvasState, patchObjectiveCanvasState };
