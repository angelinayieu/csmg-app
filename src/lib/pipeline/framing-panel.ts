// ── Framing Panel pipeline library ───────────────────────────────────
//
// Piece 2 of the 2026-04-23 architectural review, extended post-audit
// to 5 lenses. Runs 5 parallel lens LLM calls (systems_analyst,
// skeptic, operator, engineer, historian) against the intake, then
// merges their opinions into a single SituationFrame via a consensus
// pass that:
//
//   1. Aggregates cell opinions (status votes per (layer, category)).
//   2. Aggregates intentional-empty layers (unanimity required —
//      harder to clear with 5 lenses, which is the point).
//   3. Aggregates axis proposals (dedup by axis_id, enforce
//      lens_support_count ≥ 2 for ad_hoc). Single-lens ad_hoc axes
//      are NOT dropped silently — they become `note` divergences so
//      legitimately-lens-specific proposals (e.g. historian naming
//      precedent_space on an FDA case where nobody else did) still
//      reach the user for promotion.
//   4. Detects divergences — cells where lenses disagree about status,
//      or axes proposed by only some lenses with conflicting target
//      cells. Divergences are preserved, NOT averaged away (see
//      situation-frame.ts §3 design rule).
//   5. Aggregates load-bearing assumptions with crediting (which
//      lenses independently named which assumption).
//   6. Computes layer_coverage via frame-helpers.computeLayerCoverage.
//   7. Derives framing_confidence and gate_status.
//
// Soft-fails throughout: a single lens failure falls back to an empty
// LensOutput with confidence 0, and the panel continues with whatever
// lenses succeeded. If all 5 lenses fail, the panel returns
// emptyFrame() so downstream code (frame-extractor) degrades to
// legacy behavior.
//
// Slot in the intake handoff:
//   intake/bootstrap
//     → rigor-intake
//     → classify-data-presence
//     → [THIS STAGE] frame-panel
//     → frame-extractor (reads spaces.situation_frame to derive axes)
//     → decompose-hierarchical, ...

import { llmJSON } from "@/lib/llm";
import {
  ALL_LENS_IDS,
  buildLensPrompt,
  validateLensOutput,
  type LensAxisOpinion,
  type LensCellOpinion,
  type LensId,
  type LensOutput,
} from "@/lib/prompts/framing-lenses";
import type { DataPresenceTags } from "@/lib/prompts/data-presence-classifier";
import {
  computeLayerCoverage,
  emptyFrame,
} from "@/lib/situation-frame/frame-helpers";
import type { KnowledgeLayer } from "@/types/layer";
import {
  type AxisProposal,
  type CellStatus,
  type EntityCategory,
  type FrameCell,
  type FrameGateStatus,
  type FramingDivergence,
  type LensWholeFraming,
  type LoadBearingAssumption,
  type SituationFrame,
} from "@/types/situation-frame";

// ── Public API ───────────────────────────────────────────────────────

export interface RunFramingPanelOptions {
  inputText: string;
  dataPresence?: DataPresenceTags | null;
  rigorSummary?: string;
  /** Override the default panel composition. Useful for tests; in
   *  production leave unset to use all 5 canonical lenses
   *  (systems_analyst, skeptic, operator, engineer, historian). */
  lenses?: readonly LensId[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface RunFramingPanelResult {
  frame: SituationFrame;
  stats: {
    lenses_called: LensId[];
    lenses_failed: LensId[];
    fallback_used: boolean;
    duration_ms: number;
    per_lens_duration_ms: Partial<Record<LensId, number>>;
  };
}

export async function runFramingPanel(
  opts: RunFramingPanelOptions,
): Promise<RunFramingPanelResult> {
  const startedAt = Date.now();
  const lenses = opts.lenses?.length ? opts.lenses : ALL_LENS_IDS;
  const perLensDuration: Partial<Record<LensId, number>> = {};
  const failed: LensId[] = [];

  // Kick off all lens calls in parallel. Each call soft-fails to the
  // empty LensOutput on error so Promise.all never rejects.
  const lensOutputs = await Promise.all(
    lenses.map(async (lensId) => {
      const t0 = Date.now();
      try {
        const { system, user } = buildLensPrompt(lensId, {
          inputText: opts.inputText,
          dataPresence: opts.dataPresence ?? null,
          rigorSummary: opts.rigorSummary,
        });
        const raw = await llmJSON<unknown>({
          system,
          user,
          model: opts.model,
          maxTokens: opts.maxTokens ?? 2000,
          temperature: opts.temperature ?? 0.4,
          fallback: {},
        });
        const out = validateLensOutput(lensId, raw);
        perLensDuration[lensId] = Date.now() - t0;
        return out;
      } catch (err) {
        console.warn(`[framing-panel] lens=${lensId} failed:`, err);
        failed.push(lensId);
        perLensDuration[lensId] = Date.now() - t0;
        return validateLensOutput(lensId, null); // empty
      }
    }),
  );

  // If every lens effectively produced nothing, fall through to empty
  // frame so the pipeline can degrade to legacy behavior cleanly.
  const anyUsable = lensOutputs.some(
    (out) => out.cells.length > 0 || out.proposed_axes.length > 0,
  );
  if (!anyUsable) {
    const frame = emptyFrame();
    return {
      frame,
      stats: {
        lenses_called: [...lenses],
        lenses_failed: failed,
        fallback_used: true,
        duration_ms: Date.now() - startedAt,
        per_lens_duration_ms: perLensDuration,
      },
    };
  }

  const frame = consensusMerge(lensOutputs, lenses);
  return {
    frame,
    stats: {
      lenses_called: [...lenses],
      lenses_failed: failed,
      fallback_used: failed.length === lenses.length,
      duration_ms: Date.now() - startedAt,
      per_lens_duration_ms: perLensDuration,
    },
  };
}

// ── Consensus pass ───────────────────────────────────────────────────
//
// Pure function: takes lens outputs + lens id list, returns a merged
// SituationFrame. Exposed for testing; the pipeline entry is
// runFramingPanel above.

export function consensusMerge(
  lensOutputs: LensOutput[],
  lensesUsed: readonly LensId[],
): SituationFrame {
  const cells = mergeCells(lensOutputs);
  const intentionalEmpties = mergeIntentionalEmpties(lensOutputs);
  const axes = mergeAxes(lensOutputs);
  const divergences = detectDivergences(lensOutputs, axes);
  const loadBearing = mergeLoadBearing(lensOutputs);
  const candidateFramings = collectCandidateFramings(lensOutputs);
  const layerCoverage = computeLayerCoverage(cells, intentionalEmpties);

  const framingConfidence = computeFramingConfidence(
    lensOutputs,
    divergences,
  );
  const gateStatus = deriveGateStatus({
    lensOutputs,
    divergences,
    layerCoverage,
    framingConfidence,
  });

  return {
    version: 1,
    framed_at: new Date().toISOString(),
    lenses_used: lensesUsed.map((l) => String(l)),
    layer_coverage: layerCoverage,
    cells,
    axes,
    divergences,
    load_bearing_assumptions: loadBearing,
    candidate_framings: candidateFramings,
    framing_confidence: framingConfidence,
    gate_status: gateStatus,
  };
}

// ── Per-lens whole-framing collection (Phase 1 diverge-converge) ─────
//
// Unlike load-bearing assumptions (which dedupe + credit), candidate
// framings are kept VERBATIM as separate entries. The user is meant to
// see "the skeptic thinks the real problem is X; the engineer thinks
// it's Y" side-by-side, not "X and Y were merged into a hybrid Z."
//
// Two framings from different lenses can share a framing_id (snake_case
// slug) — that's signal that two stances independently arrived at the
// same framing. We preserve both rows so the picker UI can show "this
// framing was proposed by 2 lenses" without losing either lens's
// distinct chosen_approach phrasing.
//
// Sort: highest-confidence first, so chosen_rank=1 in the downstream
// problem_twin payload naturally lands on the most confident framing
// without further re-ranking work.

function collectCandidateFramings(
  lensOutputs: LensOutput[],
): LensWholeFraming[] {
  const framings: LensWholeFraming[] = [];
  for (const lens of lensOutputs) {
    if (lens.candidate_whole_framing) {
      framings.push(lens.candidate_whole_framing);
    }
  }
  // Stable sort: highest confidence first; ties broken by lens_id
  // alphabetically so re-runs on the same input produce the same
  // chosen_rank=1 winner.
  framings.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.lens_id.localeCompare(b.lens_id);
  });
  return framings;
}

// ── Cell merge ───────────────────────────────────────────────────────
//
// For each (layer, category) we collect the lens votes. Winning status:
//   - required if ≥2 lenses say required (cross-lens agreement
//     threshold; stays at 2 even when the panel has 5 lenses —
//     confidence math below handles the weakening from lower share)
//   - irrelevant if ≥2 lenses say irrelevant
//   - permitted otherwise (safer default — cells only become required
//     with genuine cross-lens support, guarding against one overreaching
//     lens marking everything required)
//
// Per-cell confidence blends lens count and avg lens self-rated
// confidence. A cell named by one low-confidence lens lands ~0.2;
// named by 2 of 5 high-confidence lenses lands ~0.6; named by all 5
// high-confidence lenses ~0.9. Cells below 0.4 are promoted from
// required → permitted, per the design rule in situation-frame.ts —
// this is what keeps the 2-of-5 threshold honest. Weak-support cells
// (2 lenses at low confidence) automatically fall back to permitted.

interface CellAccumulator {
  layer: KnowledgeLayer;
  category: EntityCategory;
  statusCounts: Record<CellStatus, number>;
  supportingLenses: Set<string>;
  rationales: string[];
  /** Sum of supporting-lens confidences, for averaging. */
  confidenceSum: number;
  /** How many lenses contributed a confidence value. */
  confidenceN: number;
}

function mergeCells(lensOutputs: LensOutput[]): FrameCell[] {
  const acc = new Map<string, CellAccumulator>();
  for (const lens of lensOutputs) {
    for (const op of lens.cells) {
      const key = `${op.layer}:${op.category}`;
      let entry = acc.get(key);
      if (!entry) {
        entry = {
          layer: op.layer,
          category: op.category,
          statusCounts: { required: 0, permitted: 0, irrelevant: 0 },
          supportingLenses: new Set(),
          rationales: [],
          confidenceSum: 0,
          confidenceN: 0,
        };
        acc.set(key, entry);
      }
      entry.statusCounts[op.status]++;
      entry.supportingLenses.add(lens.lens_id);
      if (op.rationale) entry.rationales.push(op.rationale);
      entry.confidenceSum += lens.confidence;
      entry.confidenceN += 1;
    }
  }

  const out: FrameCell[] = [];
  for (const entry of acc.values()) {
    const { required, permitted, irrelevant } = entry.statusCounts;
    let status: CellStatus;
    if (required >= 2) status = "required";
    else if (irrelevant >= 2) status = "irrelevant";
    else if (required === 1 && irrelevant === 0) status = "permitted";
    else if (permitted > 0) status = "permitted";
    else status = "permitted";

    const lensShare =
      entry.supportingLenses.size / Math.max(1, lensOutputs.length);
    const avgLensConf =
      entry.confidenceN > 0 ? entry.confidenceSum / entry.confidenceN : 0;
    // Blend: half from how many lenses agree, half from their own
    // self-rated confidence. Clamped to [0, 1].
    let confidence = 0.5 * lensShare + 0.5 * avgLensConf;
    confidence = clamp01(confidence);

    // Promote low-confidence required cells to permitted — matches the
    // design rule in situation-frame.ts (cells below 0.4 can't be
    // required unless explicitly overridden).
    if (status === "required" && confidence < 0.4) status = "permitted";

    out.push({
      layer: entry.layer,
      category: entry.category,
      status,
      rationale: entry.rationales[0] ?? "",
      supporting_lenses: Array.from(entry.supportingLenses).sort(),
      confidence,
    });
  }

  // Stable sort: required first, then by layer/category for UI
  // determinism.
  out.sort((a, b) => {
    const rank = (s: CellStatus) =>
      s === "required" ? 0 : s === "permitted" ? 1 : 2;
    const r = rank(a.status) - rank(b.status);
    if (r !== 0) return r;
    if (a.layer !== b.layer) return a.layer.localeCompare(b.layer);
    return a.category.localeCompare(b.category);
  });
  return out;
}

// ── Intentional-empty merge ──────────────────────────────────────────
//
// A layer is intentionally empty only when ALL calling lenses agree it
// is. Unanimity prevents one lens from silently zeroing out a layer
// the others cared about. The rationale we keep is the first non-empty
// one — UI surfaces the "why" alongside the pass/fail.

function mergeIntentionalEmpties(
  lensOutputs: LensOutput[],
): Partial<Record<KnowledgeLayer, { empty: boolean; rationale?: string }>> {
  const out: Partial<
    Record<KnowledgeLayer, { empty: boolean; rationale?: string }>
  > = {};
  const byLayer = new Map<KnowledgeLayer, { count: number; rationale?: string }>();

  for (const lens of lensOutputs) {
    for (const entry of lens.intentional_empty_layers) {
      const cur = byLayer.get(entry.layer) ?? { count: 0, rationale: undefined };
      cur.count += 1;
      if (!cur.rationale && entry.rationale) cur.rationale = entry.rationale;
      byLayer.set(entry.layer, cur);
    }
  }

  const n = lensOutputs.length;
  for (const [layer, agg] of byLayer) {
    if (agg.count === n) {
      out[layer] = { empty: true, rationale: agg.rationale };
    }
  }
  return out;
}

// ── Axis merge ───────────────────────────────────────────────────────
//
// Dedup by axis_id. Target cells unioned across lenses. lens_support_
// count = number of distinct lenses that named this axis. ad_hoc axes
// dropped when support_count < 2 (design rule: ad-hoc requires ≥2 lens
// support to be admitted, prevents single-lens hallucination leaking
// into the panel's output). Catalog axes kept at ≥1 because catalog
// quality is already curated.
//
// prompt_variant: if lenses disagree, we keep the most-frequently-
// named variant; ties broken by which lens named it first (stable).

interface AxisAccumulator {
  axis_id: string;
  source: "catalog" | "ad_hoc";
  supportingLenses: Set<string>;
  rationales: string[];
  targetCells: Map<string, { layer: KnowledgeLayer; category: EntityCategory }>;
  variantCounts: Map<string, number>;
}

function mergeAxes(lensOutputs: LensOutput[]): AxisProposal[] {
  const acc = new Map<string, AxisAccumulator>();
  for (const lens of lensOutputs) {
    for (const op of lens.proposed_axes) {
      let entry = acc.get(op.axis_id);
      if (!entry) {
        entry = {
          axis_id: op.axis_id,
          source: op.source,
          supportingLenses: new Set(),
          rationales: [],
          targetCells: new Map(),
          variantCounts: new Map(),
        };
        acc.set(op.axis_id, entry);
      }
      // If any lens marks it catalog we treat it as catalog — axis
      // catalog membership is objective (it's either in the registry
      // or not).
      if (op.source === "catalog") entry.source = "catalog";
      entry.supportingLenses.add(lens.lens_id);
      if (op.rationale) entry.rationales.push(op.rationale);
      for (const tc of op.target_cells) {
        entry.targetCells.set(`${tc.layer}:${tc.category}`, tc);
      }
      if (op.prompt_variant) {
        entry.variantCounts.set(
          op.prompt_variant,
          (entry.variantCounts.get(op.prompt_variant) ?? 0) + 1,
        );
      }
    }
  }

  const out: AxisProposal[] = [];
  for (const entry of acc.values()) {
    const support = entry.supportingLenses.size;
    // Ad-hoc: drop if <2 lenses named it.
    if (entry.source === "ad_hoc" && support < 2) continue;

    let promptVariant: string | undefined;
    if (entry.variantCounts.size > 0) {
      let topCount = -1;
      for (const [variant, count] of entry.variantCounts) {
        if (count > topCount) {
          topCount = count;
          promptVariant = variant;
        }
      }
    }

    out.push({
      axis_id: entry.axis_id,
      source: entry.source,
      rationale: entry.rationales[0] ?? "",
      target_cells: Array.from(entry.targetCells.values()),
      prompt_variant: promptVariant,
      lens_support_count: support,
    });
  }

  // Sort: catalog before ad_hoc, then by lens_support_count desc.
  out.sort((a, b) => {
    if (a.source !== b.source) return a.source === "catalog" ? -1 : 1;
    return b.lens_support_count - a.lens_support_count;
  });
  return out;
}

// ── Divergence detection ─────────────────────────────────────────────
//
// Two classes of divergence we surface:
//
//   (a) Cell-status divergence: same (layer, category) got required
//       from one lens and irrelevant from another. This is a real
//       framing conflict — required vs permitted is softer and rolled
//       into the cell confidence instead.
//
//   (b) Axis partial-support: an axis was proposed by exactly one lens
//       and dropped as ad_hoc (below threshold). We surface this as a
//       `note` divergence so the user can promote it if they agree.
//       (Axes that pass threshold aren't surfaced — they're already in
//       the frame.)
//
// Severity assignment:
//   - required↔irrelevant → `surface` (user sees it but we pick one)
//   - single-lens ad_hoc axis → `note`
//
// We deliberately avoid `block` in the MVP — the framing panel's whole
// point is to let divergence be informative rather than a stop sign.
// `block` is reserved for future resolution passes that can ask the
// user directly.

function detectDivergences(
  lensOutputs: LensOutput[],
  mergedAxes: AxisProposal[],
): FramingDivergence[] {
  const out: FramingDivergence[] = [];

  // (a) Cell-status clashes
  const byCell = new Map<
    string,
    Map<
      CellStatus,
      Array<{ lens: LensId; rationale: string }>
    >
  >();
  for (const lens of lensOutputs) {
    for (const op of lens.cells) {
      const key = `${op.layer}:${op.category}`;
      let statusMap = byCell.get(key);
      if (!statusMap) {
        statusMap = new Map();
        byCell.set(key, statusMap);
      }
      const list = statusMap.get(op.status) ?? [];
      list.push({ lens: lens.lens_id, rationale: op.rationale });
      statusMap.set(op.status, list);
    }
  }

  for (const [cellKey, statusMap] of byCell) {
    const required = statusMap.get("required") ?? [];
    const irrelevant = statusMap.get("irrelevant") ?? [];
    if (required.length > 0 && irrelevant.length > 0) {
      out.push({
        topic: `cell ${cellKey} status`,
        positions: [
          {
            stance: "required",
            supporting_lenses: required.map((r) => r.lens),
            implication_if_true:
              required[0]?.rationale
                ? `If required: ${required[0].rationale}`
                : "Cell must be populated or gate fails.",
          },
          {
            stance: "irrelevant",
            supporting_lenses: irrelevant.map((r) => r.lens),
            implication_if_true:
              irrelevant[0]?.rationale
                ? `If irrelevant: ${irrelevant[0].rationale}`
                : "Populating the cell would be padding or hallucination.",
          },
        ],
        severity: "surface",
      });
    }
  }

  // (b) Single-lens ad_hoc axes that didn't make the cut (lens support
  // < 2). These are worth surfacing because a strong idea from one
  // lens is worth the user's 30 seconds to consider.
  const admittedIds = new Set(mergedAxes.map((a) => a.axis_id));
  const droppedAdHoc = new Map<
    string,
    { lens: LensId; rationale: string; axis: LensAxisOpinion }
  >();
  for (const lens of lensOutputs) {
    for (const op of lens.proposed_axes) {
      if (op.source !== "ad_hoc") continue;
      if (admittedIds.has(op.axis_id)) continue;
      if (droppedAdHoc.has(op.axis_id)) continue;
      droppedAdHoc.set(op.axis_id, {
        lens: lens.lens_id,
        rationale: op.rationale,
        axis: op,
      });
    }
  }
  for (const { axis, lens, rationale } of droppedAdHoc.values()) {
    out.push({
      topic: `ad-hoc axis candidate: ${axis.axis_id}`,
      positions: [
        {
          stance: `propose ${axis.axis_id}`,
          supporting_lenses: [lens],
          implication_if_true:
            rationale || `Add axis ${axis.axis_id} to the analysis.`,
        },
        {
          stance: "skip",
          supporting_lenses: [],
          implication_if_true:
            "Other lenses did not see this axis as necessary.",
        },
      ],
      severity: "note",
    });
  }

  // Severity order for UI (block > surface > note). No `block` in MVP
  // but the sort preserves forward compatibility.
  out.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  return out;
}

function severityRank(s: "block" | "surface" | "note"): number {
  return s === "block" ? 0 : s === "surface" ? 1 : 2;
}

// ── Load-bearing assumptions merge ───────────────────────────────────
//
// Each lens names 0–1 load-bearing assumption (a single string). We
// normalize via lowercased whitespace-collapsed key and credit every
// lens that produced something similar. In the MVP "similar" is
// "exact string match after normalization" — good enough to credit
// when two lenses happen to converge on wording, which itself is
// meaningful signal. Future: embed + cluster.

function mergeLoadBearing(
  lensOutputs: LensOutput[],
): LoadBearingAssumption[] {
  const byKey = new Map<
    string,
    { assumption: string; named_by: Set<string> }
  >();
  for (const lens of lensOutputs) {
    const raw = lens.load_bearing_assumption?.trim();
    if (!raw) continue;
    const key = normalizeKey(raw);
    const entry = byKey.get(key) ?? { assumption: raw, named_by: new Set() };
    entry.named_by.add(lens.lens_id);
    byKey.set(key, entry);
  }
  return Array.from(byKey.values()).map((e) => ({
    assumption: e.assumption,
    named_by: Array.from(e.named_by).sort(),
    if_false_implication: "",
  }));
}

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// ── Framing confidence ───────────────────────────────────────────────
//
// Composite of:
//   - average per-lens self-rated confidence
//   - divergence penalty: each surfaced divergence costs 0.05, each
//     block costs 0.15. Notes are free.
//
// Clamped to [0, 1]. Low confidence across the panel (≤ 0.35) is what
// drives gate_status = "needs_more_lenses".

function computeFramingConfidence(
  lensOutputs: LensOutput[],
  divergences: FramingDivergence[],
): number {
  if (lensOutputs.length === 0) return 0;
  const avg =
    lensOutputs.reduce((sum, l) => sum + l.confidence, 0) /
    lensOutputs.length;
  let penalty = 0;
  for (const d of divergences) {
    if (d.severity === "block") penalty += 0.15;
    else if (d.severity === "surface") penalty += 0.05;
  }
  return clamp01(avg - penalty);
}

// ── Gate status ──────────────────────────────────────────────────────
//
// Orchestrator recommendation:
//   - needs_user_input: any `block` divergence present
//   - needs_more_lenses: avg confidence ≤ 0.35 OR all lenses failed
//   - pass: otherwise
//
// Note we deliberately DO NOT gate on "missing" layer coverage here —
// that's the job of checkLayerCoverage (called by frame-extractor /
// synthesis). A "missing" layer may be fine on a pure-idea intake; the
// panel's gate is about confidence in the FRAMING, not completeness
// of the eventual KG.

function deriveGateStatus(input: {
  lensOutputs: LensOutput[];
  divergences: FramingDivergence[];
  layerCoverage: ReturnType<typeof computeLayerCoverage>;
  framingConfidence: number;
}): FrameGateStatus {
  if (input.divergences.some((d) => d.severity === "block")) {
    return "needs_user_input";
  }
  if (input.framingConfidence <= 0.35) return "needs_more_lenses";
  // Zero contentful lens outputs → also needs more.
  const anyContent = input.lensOutputs.some(
    (l) => l.cells.length > 0 || l.proposed_axes.length > 0,
  );
  if (!anyContent) return "needs_more_lenses";
  return "pass";
}

// ── Utility ──────────────────────────────────────────────────────────

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
