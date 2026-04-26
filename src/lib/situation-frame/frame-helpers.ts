// ── SituationFrame helpers ───────────────────────────────────────────
//
// Pure utilities over the SituationFrame shape (src/types/situation-
// frame.ts). Callable from both the framing-panel (when it builds a
// fresh frame) and downstream consumers (frame-extractor, layer-
// coverage gate, synthesis).
//
// Split out from the type file so the type file stays import-free and
// safe to pull into client bundles. This file may grow to import LLM
// or DB utilities; the type file must not.
//
// All functions here are pure — no I/O, no globals. Side-effects live
// in the pipeline stages that call these.

import type { KnowledgeLayer } from "@/types/layer";
import {
  ENTITY_CATEGORIES,
  KNOWLEDGE_LAYERS,
  isEntityCategory,
  isKnowledgeLayer,
  type AxisProposal,
  type CellStatus,
  type EntityCategory,
  type FrameCell,
  type FrameGateStatus,
  type FramingDivergence,
  type LayerCoverage,
  type LoadBearingAssumption,
  type SituationFrame,
} from "@/types/situation-frame";

// ── Empty / neutral frame ────────────────────────────────────────────
//
// Returned when the framing-panel soft-fails entirely OR when a legacy
// row is read before the panel has run. Gate status `pass` is
// deliberate: the empty frame shouldn't block legacy behavior. The
// frame-extractor treats an empty frame exactly like a null
// situation_frame column and falls back to the legacy (type, domain,
// data_presence) axis selection.

export function emptyFrame(): SituationFrame {
  return {
    version: 1,
    framed_at: new Date(0).toISOString(),
    lenses_used: [],
    layer_coverage: KNOWLEDGE_LAYERS.map((layer) => ({
      layer,
      required_cell_count: 0,
      permitted_cell_count: 0,
      intentionally_empty: false,
      status: "missing" as const,
    })),
    cells: [],
    axes: [],
    divergences: [],
    load_bearing_assumptions: [],
    framing_confidence: 0,
    gate_status: "pass",
  };
}

// ── Validation ───────────────────────────────────────────────────────
//
// Coerces an unknown (likely JSONB-parsed) value into a SituationFrame
// with safe defaults. NEVER throws — the contract is "give me
// anything, I give you a valid frame back, degrading gracefully on
// missing fields". Parallel to the data-presence validator pattern
// (src/lib/prompts/data-presence-classifier.ts validateDataPresence).

export function validateFrame(raw: unknown): SituationFrame {
  if (!raw || typeof raw !== "object") return emptyFrame();
  const r = raw as Record<string, unknown>;

  // Version check — unknown versions fall through to empty rather
  // than attempt partial parse. When we bump the schema we'll add a
  // migration path here.
  if (r.version !== 1) return emptyFrame();

  const framedAt =
    typeof r.framed_at === "string" ? r.framed_at : new Date(0).toISOString();

  const lensesUsed = Array.isArray(r.lenses_used)
    ? (r.lenses_used as unknown[]).filter((s): s is string => typeof s === "string")
    : [];

  const cells = Array.isArray(r.cells)
    ? (r.cells as unknown[]).map(coerceCell).filter((c): c is FrameCell => c !== null)
    : [];

  const axes = Array.isArray(r.axes)
    ? (r.axes as unknown[]).map(coerceAxis).filter((a): a is AxisProposal => a !== null)
    : [];

  const divergences = Array.isArray(r.divergences)
    ? (r.divergences as unknown[])
        .map(coerceDivergence)
        .filter((d): d is FramingDivergence => d !== null)
    : [];

  const loadBearing = Array.isArray(r.load_bearing_assumptions)
    ? (r.load_bearing_assumptions as unknown[])
        .map(coerceLoadBearing)
        .filter((a): a is LoadBearingAssumption => a !== null)
    : [];

  // Layer coverage is recomputed from cells if missing or malformed
  // rather than trusted blindly — guards against a panel that reported
  // inconsistent numbers. If the raw has a valid coverage array we
  // still re-derive and cross-check; raw rationale strings are
  // preserved when present.
  const rawCoverage = Array.isArray(r.layer_coverage)
    ? (r.layer_coverage as unknown[])
    : [];
  const intentionalEmpties = extractIntentionalEmpties(rawCoverage);
  const layerCoverage = computeLayerCoverage(cells, intentionalEmpties);

  const framingConfidence = clamp01(
    typeof r.framing_confidence === "number" ? r.framing_confidence : 0,
  );

  const gateStatus: FrameGateStatus =
    r.gate_status === "needs_user_input" || r.gate_status === "needs_more_lenses"
      ? r.gate_status
      : "pass";

  return {
    version: 1,
    framed_at: framedAt,
    lenses_used: lensesUsed,
    layer_coverage: layerCoverage,
    cells,
    axes,
    divergences,
    load_bearing_assumptions: loadBearing,
    framing_confidence: framingConfidence,
    gate_status: gateStatus,
  };
}

// ── Cell-level helpers ───────────────────────────────────────────────

/** Get cells in a given layer (any status). */
export function cellsForLayer(
  frame: SituationFrame,
  layer: KnowledgeLayer,
): FrameCell[] {
  return frame.cells.filter((c) => c.layer === layer);
}

/** Get only required cells. Used by frame-extractor to derive the
 *  axis target set. */
export function requiredCells(frame: SituationFrame): FrameCell[] {
  return frame.cells.filter((c) => c.status === "required");
}

/** Get cells at a specific coordinate. Normally there's 0 or 1 but
 *  validation doesn't dedupe, so callers should handle arrays. */
export function cellAt(
  frame: SituationFrame,
  layer: KnowledgeLayer,
  category: EntityCategory,
): FrameCell[] {
  return frame.cells.filter(
    (c) => c.layer === layer && c.category === category,
  );
}

// ── Coverage gate ────────────────────────────────────────────────────
//
// The check that makes "we need things at every layer" concrete.
// Returns { ok, gaps } where gaps is the layers with no required cells
// and no intentional-empty marking.
//
// Today the gate is SOFT — consumers log the result. When panel
// confidence is high enough we promote to a hard block before
// synthesis commits (see §4 of the 2026-04-23 architectural review).

export interface CoverageCheckResult {
  ok: boolean;
  /** Layers that are `missing` (no required cells and not intentionally
   *  empty). */
  gaps: KnowledgeLayer[];
  /** Layers explicitly marked intentionally-empty, surfaced for UI. */
  intentional_empties: Array<{ layer: KnowledgeLayer; rationale?: string }>;
}

export function checkLayerCoverage(frame: SituationFrame): CoverageCheckResult {
  const gaps: KnowledgeLayer[] = [];
  const intentional_empties: CoverageCheckResult["intentional_empties"] = [];
  for (const entry of frame.layer_coverage) {
    if (entry.status === "missing") gaps.push(entry.layer);
    if (entry.status === "intentionally_empty") {
      intentional_empties.push({
        layer: entry.layer,
        rationale: entry.empty_rationale,
      });
    }
  }
  return { ok: gaps.length === 0, gaps, intentional_empties };
}

// ── Coverage computation ─────────────────────────────────────────────
//
// Recomputes LayerCoverage[] from the raw cells array. Every one of
// the 4 canonical layers appears in the output, even if no cells
// mention it — so downstream code can iterate without missing-key
// worries.

export function computeLayerCoverage(
  cells: FrameCell[],
  intentionalEmpties: Partial<Record<KnowledgeLayer, { empty: boolean; rationale?: string }>> = {},
): LayerCoverage[] {
  return KNOWLEDGE_LAYERS.map((layer) => {
    const required = cells.filter(
      (c) => c.layer === layer && c.status === "required",
    ).length;
    const permitted = cells.filter(
      (c) => c.layer === layer && c.status === "permitted",
    ).length;
    const intentional = intentionalEmpties[layer];
    const intentionally_empty = Boolean(intentional?.empty);

    let status: LayerCoverage["status"];
    if (required > 0) status = "covered";
    else if (intentionally_empty) status = "intentionally_empty";
    else status = "missing";

    return {
      layer,
      required_cell_count: required,
      permitted_cell_count: permitted,
      intentionally_empty,
      empty_rationale: intentional?.rationale,
      status,
    };
  });
}

// ── Axis derivation from required cells ──────────────────────────────
//
// Given a frame, return the axes whose target_cells intersect at
// least one required cell. This is the core bridge from "situation
// needs" (cells) to "what we'll generate" (axes) that the upgraded
// frame-extractor will use instead of the hardcoded (type, domain)
// matrix.
//
// Does NOT dedupe by axis_id — caller decides how to merge multiple
// proposals of the same axis (e.g. a catalog `financial` and an
// ad_hoc `financial_payback` both proposed). Typical merge rule is
// to prefer higher lens_support_count, or keep both if prompt_variant
// differs meaningfully.

export function axesCoveringRequiredCells(
  frame: SituationFrame,
): AxisProposal[] {
  const required = requiredCells(frame);
  if (required.length === 0) return [];
  return frame.axes.filter((axis) =>
    axis.target_cells.some((tc) =>
      required.some(
        (r) => r.layer === tc.layer && r.category === tc.category,
      ),
    ),
  );
}

// ── Internal: coercers ───────────────────────────────────────────────

function coerceCell(raw: unknown): FrameCell | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isKnowledgeLayer(r.layer)) return null;
  if (!isEntityCategory(r.category)) return null;
  const status = coerceCellStatus(r.status);
  if (!status) return null;
  return {
    layer: r.layer,
    category: r.category,
    status,
    rationale:
      typeof r.rationale === "string" ? r.rationale.slice(0, 200) : "",
    supporting_lenses: Array.isArray(r.supporting_lenses)
      ? (r.supporting_lenses as unknown[]).filter(
          (s): s is string => typeof s === "string",
        )
      : [],
    confidence: clamp01(typeof r.confidence === "number" ? r.confidence : 0),
  };
}

function coerceCellStatus(x: unknown): CellStatus | null {
  return x === "required" || x === "permitted" || x === "irrelevant" ? x : null;
}

function coerceAxis(raw: unknown): AxisProposal | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.axis_id !== "string" || r.axis_id.length === 0) return null;
  const source = r.source === "ad_hoc" ? "ad_hoc" : "catalog";
  const targetCells = Array.isArray(r.target_cells)
    ? (r.target_cells as unknown[])
        .map((tc) => {
          if (!tc || typeof tc !== "object") return null;
          const t = tc as Record<string, unknown>;
          if (!isKnowledgeLayer(t.layer) || !isEntityCategory(t.category))
            return null;
          return { layer: t.layer, category: t.category };
        })
        .filter(
          (t): t is { layer: KnowledgeLayer; category: EntityCategory } =>
            t !== null,
        )
    : [];
  return {
    axis_id: r.axis_id,
    source,
    rationale:
      typeof r.rationale === "string" ? r.rationale.slice(0, 300) : "",
    target_cells: targetCells,
    prompt_variant:
      typeof r.prompt_variant === "string" ? r.prompt_variant : undefined,
    lens_support_count:
      typeof r.lens_support_count === "number"
        ? Math.max(0, Math.floor(r.lens_support_count))
        : 0,
    // Ad-hoc spec hints (Axis Richness, 2026-04-24). Pass through as
    // plain strings; frame-extractor re-validates against AxisSpec
    // enums when constructing the live spec. Missing = undefined.
    dimension_hint:
      typeof r.dimension_hint === "string" ? r.dimension_hint : undefined,
    instrument_kind_hint:
      typeof r.instrument_kind_hint === "string"
        ? r.instrument_kind_hint
        : undefined,
    output_shape_hint:
      typeof r.output_shape_hint === "string" ? r.output_shape_hint : undefined,
    label: typeof r.label === "string" ? r.label.slice(0, 80) : undefined,
    tagline: typeof r.tagline === "string" ? r.tagline.slice(0, 140) : undefined,
  };
}

function coerceDivergence(raw: unknown): FramingDivergence | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.topic !== "string") return null;
  const severity =
    r.severity === "block" || r.severity === "surface" || r.severity === "note"
      ? r.severity
      : "note";
  const positions = Array.isArray(r.positions)
    ? (r.positions as unknown[])
        .map((p) => {
          if (!p || typeof p !== "object") return null;
          const pp = p as Record<string, unknown>;
          if (typeof pp.stance !== "string") return null;
          return {
            stance: pp.stance.slice(0, 300),
            supporting_lenses: Array.isArray(pp.supporting_lenses)
              ? (pp.supporting_lenses as unknown[]).filter(
                  (s): s is string => typeof s === "string",
                )
              : [],
            implication_if_true:
              typeof pp.implication_if_true === "string"
                ? pp.implication_if_true.slice(0, 300)
                : "",
          };
        })
        .filter(
          (
            p,
          ): p is {
            stance: string;
            supporting_lenses: string[];
            implication_if_true: string;
          } => p !== null,
        )
    : [];
  return {
    topic: r.topic.slice(0, 200),
    positions,
    severity,
  };
}

function coerceLoadBearing(raw: unknown): LoadBearingAssumption | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.assumption !== "string") return null;
  return {
    assumption: r.assumption.slice(0, 300),
    named_by: Array.isArray(r.named_by)
      ? (r.named_by as unknown[]).filter(
          (s): s is string => typeof s === "string",
        )
      : [],
    if_false_implication:
      typeof r.if_false_implication === "string"
        ? r.if_false_implication.slice(0, 300)
        : "",
  };
}

function extractIntentionalEmpties(
  rawCoverage: unknown[],
): Partial<Record<KnowledgeLayer, { empty: boolean; rationale?: string }>> {
  const out: Partial<
    Record<KnowledgeLayer, { empty: boolean; rationale?: string }>
  > = {};
  for (const entry of rawCoverage) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (!isKnowledgeLayer(e.layer)) continue;
    if (e.intentionally_empty === true) {
      out[e.layer] = {
        empty: true,
        rationale:
          typeof e.empty_rationale === "string" ? e.empty_rationale : undefined,
      };
    }
  }
  return out;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// ── Exports for convenience re-use ───────────────────────────────────
//
// Re-export the constants from the type file so callers don't need
// two imports for common cases (iterating all layers + categories).
export { ENTITY_CATEGORIES, KNOWLEDGE_LAYERS };
