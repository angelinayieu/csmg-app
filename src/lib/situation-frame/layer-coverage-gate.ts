// ── Layer Coverage Gate ──────────────────────────────────────────────
//
// Piece 4 of the 2026-04-23 architectural review: the step that
// promotes `layer_density` from a soft metric to a hard pre-synthesis
// gate.
//
// Given (situation_frame, kg entities) this tells synthesis:
//
//   - PASS  — every layer the panel REQUIRED has at least one entity
//             in the KG (or is intentionally_empty), and there are no
//             block-severity divergences.
//
//   - FAIL  — at least one required layer has zero entities, or the
//             panel explicitly set gate_status = needs_user_input.
//             Synthesis should return a structured 409 with the gap
//             report, letting the client offer the user either
//             (a) re-run the upstream stages, or (b) acknowledge and
//             force past the gate via bypassLayerGate=true.
//
// Soft-fail: a null / empty frame (legacy row, panel never ran) maps
// to pass with reason "no_frame" — exact pre-Piece-4 behavior.
//
// Pure function. No I/O, no globals. Call sites:
//   - /api/pipeline/synthesize            (multi-space fan-in)
//   - /api/pipeline/synthesize-layered    (single-space hierarchical)
//
// Adding a new call site = import + call; no side-effects to unwind.

import type { KnowledgeLayer } from "@/types/layer";
import { KNOWLEDGE_LAYERS } from "@/types/situation-frame";
import type {
  FrameGateStatus,
  SituationFrame,
} from "@/types/situation-frame";

// ── Input / output shapes ────────────────────────────────────────────

export interface LayerCoverageGateInput {
  /** Situation frame for this space; null/undefined for legacy rows
   *  where the framing panel never ran. Treat as pass in that case —
   *  the gate only applies when there's a frame to gate against. */
  frame: SituationFrame | null | undefined;
  /** Subset of Entity shape actually needed for the gate — just the
   *  knowledge_layer column. Typed loosely so callers can pass their
   *  existing Entity[] without narrowing. */
  entities: ReadonlyArray<{ knowledge_layer?: string | null }>;
  /** Space ID for telemetry — echoed back in the report. Optional so
   *  single-space callers can omit. */
  spaceId?: string;
}

export type LayerCoverageGapReason =
  /** Panel marked ≥1 cell in this layer `required`, but the KG holds
   *  zero entities tagged with that knowledge_layer. This is the
   *  primary gate condition — analysis of a layer the panel said we
   *  need would be vacuous. */
  | "panel_required_but_kg_empty"
  /** Panel's layer_coverage entry says status=`missing` (no required
   *  cells AND not intentionally empty — a layer the panel silently
   *  ignored) AND the KG also has no entities there. Signals a
   *  framing hole the user should know about. Softer than the above
   *  — synthesis may still be useful, but we flag it. */
  | "panel_status_missing_and_kg_empty";

export interface LayerCoverageGap {
  layer: KnowledgeLayer;
  reason: LayerCoverageGapReason;
  required_cell_count: number;
  permitted_cell_count: number;
  kg_entity_count: number;
  intentionally_empty: boolean;
  empty_rationale?: string;
}

/** Extended gate status including the "no frame" degenerate case so
 *  telemetry can distinguish "legacy pass" from "post-panel pass". */
export type LayerCoverageGateStatus = FrameGateStatus | "no_frame";

export interface LayerCoverageGateReport {
  pass: boolean;
  frame_gate_status: LayerCoverageGateStatus;
  /** Gaps the gate detected. Empty iff pass=true AND no panel block. */
  gaps: LayerCoverageGap[];
  /** Topics of any severity=block divergences the panel surfaced.
   *  Piece 2's consensusMerge doesn't emit block today, but surfacing
   *  these keeps us forward-compatible when a resolution pass is
   *  added. */
  panel_block_divergences: string[];
  /** Human-readable explanation the API can forward to the client
   *  verbatim. UI may render as-is or compose its own message from
   *  the structured fields. */
  message: string;
  /** How many KG entities were found in each canonical knowledge
   *  layer. Surfaced for UI rendering + debugging. */
  layer_entity_counts: Record<KnowledgeLayer, number>;
  /** Optional caller-supplied space id, for multi-space gate rollups. */
  space_id?: string;
}

// ── Public entry ─────────────────────────────────────────────────────

export function checkLayerCoverageGate(
  input: LayerCoverageGateInput,
): LayerCoverageGateReport {
  const counts = countEntitiesByLayer(input.entities);

  // Degenerate case: no frame (legacy row or panel soft-failed). We
  // don't have enough information to gate — pre-Piece-4 behavior was
  // "always pass synthesis on entity presence alone", and we preserve
  // that to avoid regressing existing spaces.
  if (!input.frame || isEmptyFrame(input.frame)) {
    return {
      pass: true,
      frame_gate_status: "no_frame",
      gaps: [],
      panel_block_divergences: [],
      message:
        "No situation frame available — layer-coverage gate not applicable.",
      layer_entity_counts: counts,
      space_id: input.spaceId,
    };
  }

  const frame = input.frame;
  const gaps: LayerCoverageGap[] = [];

  for (const cov of frame.layer_coverage) {
    const kgCount = counts[cov.layer] ?? 0;

    // Primary gate condition: panel said required, KG has nothing.
    if (
      cov.required_cell_count > 0 &&
      kgCount === 0 &&
      !cov.intentionally_empty
    ) {
      gaps.push({
        layer: cov.layer,
        reason: "panel_required_but_kg_empty",
        required_cell_count: cov.required_cell_count,
        permitted_cell_count: cov.permitted_cell_count,
        kg_entity_count: 0,
        intentionally_empty: false,
        empty_rationale: cov.empty_rationale,
      });
      continue;
    }

    // Secondary: panel status == missing AND KG also empty. Softer
    // signal than the above but worth flagging. We include these in
    // the report so the UI can render them as warnings; individual
    // consumers decide whether to treat as hard-block or soft-warn.
    if (cov.status === "missing" && kgCount === 0) {
      gaps.push({
        layer: cov.layer,
        reason: "panel_status_missing_and_kg_empty",
        required_cell_count: cov.required_cell_count,
        permitted_cell_count: cov.permitted_cell_count,
        kg_entity_count: 0,
        intentionally_empty: false,
        empty_rationale: cov.empty_rationale,
      });
    }
  }

  const panelBlockDivergences = frame.divergences
    .filter((d) => d.severity === "block")
    .map((d) => d.topic);

  const panelBlocked = frame.gate_status === "needs_user_input";
  const hasHardGap = gaps.some(
    (g) => g.reason === "panel_required_but_kg_empty",
  );
  const pass = !panelBlocked && !hasHardGap;

  return {
    pass,
    frame_gate_status: frame.gate_status,
    gaps,
    panel_block_divergences: panelBlockDivergences,
    message: buildMessage(pass, gaps, panelBlocked, panelBlockDivergences),
    layer_entity_counts: counts,
    space_id: input.spaceId,
  };
}

// ── Multi-space rollup ───────────────────────────────────────────────
//
// Convenience for the multi-space synthesize route: run the gate per
// space, return `{ pass: all pass, reports: [...] }`. Pass iff every
// individual report passes. Any mix of `no_frame` and real reports is
// handled — no_frame spaces can't fail.

export interface LayerCoverageGateRollup {
  pass: boolean;
  reports: LayerCoverageGateReport[];
}

export function rollupLayerCoverageGates(
  inputs: LayerCoverageGateInput[],
): LayerCoverageGateRollup {
  const reports = inputs.map(checkLayerCoverageGate);
  return {
    pass: reports.every((r) => r.pass),
    reports,
  };
}

// ── Internals ────────────────────────────────────────────────────────

function countEntitiesByLayer(
  entities: ReadonlyArray<{ knowledge_layer?: string | null }>,
): Record<KnowledgeLayer, number> {
  const counts: Record<KnowledgeLayer, number> = {
    internal: 0,
    conceptual: 0,
    external: 0,
    bridge: 0,
  };
  for (const e of entities) {
    const layer = e.knowledge_layer;
    if (isCanonicalLayer(layer)) counts[layer] += 1;
  }
  return counts;
}

function isCanonicalLayer(x: unknown): x is KnowledgeLayer {
  return (
    typeof x === "string" &&
    (KNOWLEDGE_LAYERS as readonly string[]).includes(x)
  );
}

// emptyFrame() in frame-helpers sets framed_at to epoch 0. We use that
// sentinel to distinguish a real frame from the neutral-default frame
// that validateFrame returns on garbage input. Avoid importing the
// constructor to keep this module import-light (type file + constants
// only).
const EPOCH_ZERO_ISO = new Date(0).toISOString();

function isEmptyFrame(frame: SituationFrame): boolean {
  if (frame.framed_at === EPOCH_ZERO_ISO) return true;
  if (frame.cells.length === 0 && frame.axes.length === 0) return true;
  return false;
}

function buildMessage(
  pass: boolean,
  gaps: LayerCoverageGap[],
  panelBlocked: boolean,
  blockDivergences: string[],
): string {
  if (pass) {
    if (gaps.length === 0) return "Layer coverage gate passed.";
    return `Gate passed with ${gaps.length} soft warning(s) — ${gaps
      .map((g) => g.layer)
      .join(", ")} layer(s) are status=missing but not strictly required.`;
  }

  const parts: string[] = [];
  const hard = gaps.filter(
    (g) => g.reason === "panel_required_but_kg_empty",
  );
  if (hard.length > 0) {
    parts.push(
      `Required layer(s) have no entities: ${hard
        .map((g) => `${g.layer} (panel required ${g.required_cell_count} cell${g.required_cell_count === 1 ? "" : "s"})`)
        .join("; ")}.`,
    );
  }
  if (panelBlocked) {
    parts.push(
      blockDivergences.length > 0
        ? `Panel flagged unresolved framing conflicts: ${blockDivergences.join("; ")}.`
        : "Framing panel requires user input before synthesis can proceed.",
    );
  }
  return `Synthesis blocked — ${parts.join(" ")}`;
}
