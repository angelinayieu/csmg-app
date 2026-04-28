// POST /api/pipeline/frame-extractor
//
// Phase 2E · Tier 2 — the first step of the new "spaces fork out,
// merge into KG" flow. Runs a short LLM classification pass on the
// user's input to decide which of 8 canonical probability-space
// axes apply to this situation, in what order of relevance, and
// why.
//
// Output: a list of axes with per-axis rationale. Each becomes a
// row in `probability_space_runs` + a `space_opened` event emitted
// to the canvas, which paints an empty glass shell.
//
// This endpoint is CHEAP — one ~200-token LLM call, ~2-5s. Runs
// BEFORE decompose begins so the shells are already visible when
// the first entity lands. Users see the reasoning structure
// (which lenses we're using) before the content arrives.
//
// Not responsible for per-axis generation. Follow-up endpoints
// fill each shell with entities/claims/distributions.

import { NextResponse, after } from "next/server";
import { cookies, headers } from "next/headers";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import {
  emitStructuralEvent,
  completePipelineRun,
} from "@/lib/events/structural-event-bus";
import {
  ALWAYS_APPLICABLE_AXES,
  AXIS_CATALOG,
  AXIS_ORDER,
} from "@/lib/probability-space/axis-catalog";
import {
  buildAdHocSpec,
  type AxisDimension,
  type AxisInstrumentKind,
  type AxisOutputShape,
  type AxisSpec,
} from "@/lib/probability-space/axis-spec";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";
import {
  applicableAxesFor,
  classifyQuestionType,
  type QuestionTypeResult,
} from "@/lib/pipeline/question-type-classifier";
import {
  extractTargetOutcome,
  type TargetOutcome,
} from "@/lib/pipeline/target-outcome-extractor";
import type { DataPresenceTags } from "@/lib/prompts/data-presence-classifier";
import {
  axesCoveringRequiredCells,
  validateFrame as validateSituationFrame,
} from "@/lib/situation-frame/frame-helpers";
import type {
  FramingDivergence,
  SituationFrame,
} from "@/types/situation-frame";
import type { SituationBaseline } from "@/types/situation";
import { loadActivePlan } from "@/lib/pipeline/active-plan-loader";
import type { KgPlanAxisProposal } from "@/types/kg-generation-plan";

export const maxDuration = 30;
export const runtime = "nodejs";

interface FrameExtractorRequest {
  runId: string;
  spaceId: string;
  inputText: string;
}

interface FrameSelection {
  axis: ProbabilitySpaceAxis;
  rationale: string;
  /** Variant hint from panel AxisProposal.prompt_variant. */
  variant?: string;
}

// Ad-hoc axes carry a full AxisSpec rather than a canonical axis key.
// Kept separate from FrameSelection so the catalog path (which inserts
// into probability_space_runs and paints shells from AXIS_CATALOG)
// remains unchanged when the frame only has canonical axes.
interface AdHocSelection {
  spec: AxisSpec;
  rationale: string;
  variant?: string;
}

interface FrameResponse {
  frame: FrameSelection[];
  /** Ad-hoc axes dispatched to the generator with a live spec. Empty
   *  when the panel didn't propose any ad-hoc dimensions. */
  adhoc_frame?: AdHocSelection[];
}

const SYSTEM_PROMPT = `You are a meta-analyst classifying a user's input to decide which lenses ("probability space axes") should be used to model the situation.

Eight canonical axes exist:
${AXIS_ORDER.map((a) => {
  const m = AXIS_CATALOG[a];
  return `- ${m.axis} ("${m.label}"): ${m.applies_when}`;
}).join("\n")}

Return strict JSON in this exact shape:
{
  "frame": [
    { "axis": "<one of the 8>", "rationale": "one short sentence why this lens applies to this input" }
  ]
}

Rules:
- Include ONLY axes that are genuinely relevant to this input. Omit axes that would produce generic / padded content.
- Always include "assumptions" (every situation has load-bearing beliefs worth surfacing).
- Order the frame by relevance — most central lens first, least central last.
- Minimum 3 axes, maximum 7.
- Each rationale is ONE sentence, under 20 words, specific to this input (not generic axis description).
- Do NOT add preamble, markdown fences, or commentary around the JSON.`;

function buildUserPrompt(inputText: string): string {
  return `Input:
"""
${inputText.slice(0, 3500)}
"""

Classify this input. Which axes apply? Return the strict JSON described in the system prompt.`;
}

function isValidAxis(s: unknown): s is ProbabilitySpaceAxis {
  return typeof s === "string" && s in AXIS_CATALOG;
}

// ── Hint coercers (Phase 2E · Axis Richness) ─────────────────────────
//
// Panel lens prompts suggest dimension / instrument_kind / output_shape
// as free-form strings (lenses speak English, not TypeScript enums).
// These coercers narrow to canonical enums; unknown strings fall
// through to undefined so `buildAdHocSpec` uses its defaults.

const DIMENSIONS: AxisDimension[] = [
  "money", "time", "people", "physical", "truth",
  "meaning", "causation", "risk", "precedent", "generic",
];
const INSTRUMENT_KINDS: AxisInstrumentKind[] = [
  "calibration", "constraint", "enumeration", "stratification",
  "decomposition", "counterfactual", "evidentiary",
];
const OUTPUT_SHAPES: AxisOutputShape[] = [
  "numeric_with_distribution", "named_stakeholder_set", "scenario_tree",
  "claim_ledger", "assumption_ledger", "failure_mode_catalog",
  "temporal_phase_map", "norm_and_identity_map", "constraint_envelope",
  "precedent_set", "generic_entity_set",
];

function asDimension(s?: string): AxisDimension | undefined {
  return s && (DIMENSIONS as string[]).includes(s) ? (s as AxisDimension) : undefined;
}
function asInstrumentKind(s?: string): AxisInstrumentKind | undefined {
  return s && (INSTRUMENT_KINDS as string[]).includes(s)
    ? (s as AxisInstrumentKind)
    : undefined;
}
function asOutputShape(s?: string): AxisOutputShape | undefined {
  return s && (OUTPUT_SHAPES as string[]).includes(s)
    ? (s as AxisOutputShape)
    : undefined;
}

function humanizeAxisId(id: string): string {
  return id
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 60);
}

// ── Panel → frame derivation ─────────────────────────────────────────
//
// Takes the panel's SituationFrame and returns both catalog-axis and
// ad-hoc selections by (a) filtering to panel axes whose target_cells
// intersect at least one required cell, (b) splitting catalog vs
// ad_hoc: catalog goes to FrameSelection, ad_hoc goes to AdHocSelection
// with a freshly-minted AxisSpec from buildAdHocSpec. (c) ordering
// each list by lens_support_count desc so the most broadly-endorsed
// axes paint first.
//
// Always appends `assumptions` as backstop if missing — mirrors the
// legacy validator behavior. Returns {frame: []} when the frame isn't
// usable (no required cells), which is the caller's signal to fall
// through to the legacy LLM path.
//
// Ad-hoc quality bar: the panel already enforces ≥2 lens_support_count
// for ad_hoc admission (framing-panel.ts consensus merge). Single-lens
// ad_hoc dropouts don't reach this function.
function deriveFrameFromPanel(
  frame: SituationFrame | null,
): { frame: FrameSelection[]; adhoc: AdHocSelection[] } {
  if (!frame) return { frame: [], adhoc: [] };
  const covering = axesCoveringRequiredCells(frame);
  if (covering.length === 0) return { frame: [], adhoc: [] };

  const sorted = [...covering].sort(
    (a, b) => b.lens_support_count - a.lens_support_count,
  );

  const catalogOut: FrameSelection[] = [];
  const adhocOut: AdHocSelection[] = [];
  const seenCatalog = new Set<ProbabilitySpaceAxis>();
  const seenAdhoc = new Set<string>();

  for (const axis of sorted) {
    if (axis.source === "catalog") {
      if (!isValidAxis(axis.axis_id)) continue;
      if (seenCatalog.has(axis.axis_id)) continue;
      seenCatalog.add(axis.axis_id);
      catalogOut.push({
        axis: axis.axis_id,
        rationale:
          axis.rationale.slice(0, 220) ||
          `Panel selected: covers ${axis.target_cells.length} required cell(s).`,
        variant: axis.prompt_variant,
      });
    } else {
      // Ad-hoc: require axis_id not collide with canonical catalog
      // (defensive — panel consensus should enforce this but we
      // guard anyway so a mis-tagged proposal can't shadow a real
      // catalog axis).
      if (isValidAxis(axis.axis_id)) continue;
      if (seenAdhoc.has(axis.axis_id)) continue;
      seenAdhoc.add(axis.axis_id);
      const label = axis.label ?? humanizeAxisId(axis.axis_id);
      const tagline = axis.tagline ?? axis.rationale.slice(0, 140);
      const spec = buildAdHocSpec({
        axis_id: axis.axis_id,
        label,
        tagline,
        rationale: axis.rationale,
        dimension: asDimension(axis.dimension_hint),
        instrument_kind: asInstrumentKind(axis.instrument_kind_hint),
        output_shape: asOutputShape(axis.output_shape_hint),
      });
      adhocOut.push({
        spec,
        rationale:
          axis.rationale.slice(0, 220) ||
          `Panel-minted ad-hoc axis covering ${axis.target_cells.length} required cell(s).`,
        variant: axis.prompt_variant,
      });
    }
  }

  // Backstop — guarantee assumptions is present (every situation has
  // load-bearing beliefs; legacy validator enforces this too).
  for (const alwaysAxis of ALWAYS_APPLICABLE_AXES) {
    if (!catalogOut.some((f) => f.axis === alwaysAxis)) {
      catalogOut.push({
        axis: alwaysAxis,
        rationale:
          "Surfaces the load-bearing assumptions underlying the situation.",
      });
    }
  }
  return { frame: catalogOut, adhoc: adhocOut };
}

// ── Derive frame from active KG generation plan (Phase 2) ───────────
//
// When a user approved a plan and its `axis_proposals.axes[]` is
// non-empty, the plan TAKES PRECEDENCE over both the panel-frame
// and the legacy LLM classifier. The plan's axes are topic-adaptive
// (e.g. "Cognitive Domains", "Bell-Curve Dynamics") and almost
// always non-catalog → they flow through as AdHocSelection[] using
// the same buildAdHocSpec machinery the panel uses.
//
// On collision with a canonical catalog axis (slug matches one of
// the 8) we prefer the catalog spec — preserves prompt-variant
// machinery and proven generators. Plan-minted axes are exclusively
// AdHoc.
//
// Returns empty arrays when the plan has no axes (caller falls
// through to panel/legacy path).

function deriveFrameFromActivePlan(
  axes: KgPlanAxisProposal[] | undefined | null,
): { frame: FrameSelection[]; adhoc: AdHocSelection[] } {
  if (!axes || axes.length === 0) return { frame: [], adhoc: [] };
  const catalogOut: FrameSelection[] = [];
  const adhocOut: AdHocSelection[] = [];
  const seenCatalog = new Set<ProbabilitySpaceAxis>();
  const seenAdhoc = new Set<string>();

  for (const a of axes) {
    if (isValidAxis(a.slug)) {
      if (seenCatalog.has(a.slug)) continue;
      seenCatalog.add(a.slug);
      catalogOut.push({
        axis: a.slug,
        rationale:
          (a.rationale || a.definition || "").slice(0, 220) ||
          "Plan-selected canonical axis.",
      });
    } else {
      if (seenAdhoc.has(a.slug)) continue;
      seenAdhoc.add(a.slug);
      const spec = buildAdHocSpec({
        axis_id: a.slug,
        label: a.name,
        tagline: (a.definition || "").slice(0, 140),
        rationale: a.rationale,
        dimension: asDimension(a.dimension_hint),
        instrument_kind: asInstrumentKind(a.instrument_kind_hint),
        output_shape: asOutputShape(a.output_shape_hint),
      });
      adhocOut.push({
        spec,
        rationale:
          (a.rationale || a.definition || "").slice(0, 220) ||
          "Plan-minted topic-adaptive axis.",
      });
    }
  }

  // Backstop — if neither the plan nor the canonical set yielded
  // an "assumptions" axis, append it (every situation has
  // load-bearing beliefs worth surfacing).
  for (const alwaysAxis of ALWAYS_APPLICABLE_AXES) {
    if (!catalogOut.some((f) => f.axis === alwaysAxis)) {
      catalogOut.push({
        axis: alwaysAxis,
        rationale:
          "Surfaces the load-bearing assumptions underlying the situation.",
      });
    }
  }
  return { frame: catalogOut, adhoc: adhocOut };
}

// ── Temperature nudge from divergence ────────────────────────────────
//
// When the panel saw lenses disagree, downstream LLMs should explore
// more not less — the disagreement IS information that the framing is
// ambiguous. Base 0.2 (legacy value), +0.1 per block divergence,
// +0.04 per surface divergence, notes free. Capped at 0.55 so we
// don't run the generator at hallucination-prone temperatures.
function temperatureForDivergence(divergences: FramingDivergence[]): number {
  let t = 0.2;
  for (const d of divergences) {
    if (d.severity === "block") t += 0.1;
    else if (d.severity === "surface") t += 0.04;
  }
  return Math.min(0.55, t);
}

// Top-N divergences for surfacing in the response. Severity already
// sorted (block > surface > note) by consensusMerge; we just slice.
function topDivergences(
  frame: SituationFrame | null,
  n: number,
): Array<{
  topic: string;
  severity: "block" | "surface" | "note";
  positions: number;
  lenses: string[];
}> {
  if (!frame || frame.divergences.length === 0) return [];
  return frame.divergences.slice(0, n).map((d) => ({
    topic: d.topic,
    severity: d.severity,
    positions: d.positions.length,
    lenses: Array.from(
      new Set(
        d.positions.flatMap((p) => p.supporting_lenses),
      ),
    ).sort(),
  }));
}

function validateFrame(raw: unknown): FrameResponse {
  if (!raw || typeof raw !== "object") {
    throw new Error("frame extractor returned non-object");
  }
  const frame = (raw as { frame?: unknown }).frame;
  if (!Array.isArray(frame)) {
    throw new Error("frame field missing or not an array");
  }
  const out: FrameSelection[] = [];
  for (const item of frame) {
    if (!item || typeof item !== "object") continue;
    const axis = (item as { axis?: unknown }).axis;
    const rationale = (item as { rationale?: unknown }).rationale;
    if (!isValidAxis(axis)) continue;
    if (typeof rationale !== "string") continue;
    out.push({ axis, rationale: rationale.slice(0, 220) });
  }
  // Always include assumptions as backstop.
  for (const alwaysAxis of ALWAYS_APPLICABLE_AXES) {
    if (!out.some((f) => f.axis === alwaysAxis)) {
      out.push({
        axis: alwaysAxis,
        rationale:
          "Surfaces the load-bearing assumptions underlying the situation.",
      });
    }
  }
  return { frame: out };
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<FrameExtractorRequest>(request);
  if (parseError) return parseError;

  const { runId, spaceId, inputText } = body;
  if (!runId || !spaceId || typeof inputText !== "string") {
    return NextResponse.json(
      { error: "runId, spaceId, and inputText are required" },
      { status: 400 },
    );
  }
  if (inputText.trim().length < 10) {
    return NextResponse.json(
      { error: "inputText too short for frame extraction" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Phase 2E · PR 1.5 — classify the question upstream of axis
  // selection. The classifier gives us (type, domain, complexity)
  // which is then used to (a) filter the candidate axis set via
  // applicableAxesFor() and (b) inform the frame extractor's
  // system prompt so its LLM is picking from the right candidate
  // pool. A decision in a philosophy domain doesn't need Financial;
  // a prediction in business does.
  //
  // Soft-fail: classifier returns a neutral fallback on error, which
  // means applicableAxesFor falls back to the legacy all-8 behavior.
  //
  // Phase 3 §4.1 — run the target-outcome extractor in parallel with
  // the question-type classifier. They're independent (both read only
  // inputText), so Promise.all keeps the latency tax to one round-trip
  // instead of two. extractTargetOutcome returns null on failure /
  // when no extractable outcome — downstream stages handle null
  // gracefully (outcome-agnostic ranking).
  const [qType, targetOutcome]: [QuestionTypeResult, TargetOutcome | null] =
    await Promise.all([
      classifyQuestionType(inputText),
      extractTargetOutcome(inputText),
    ]);

  // ── Data-presence tags (migration 20260425_data_presence.sql) ─────
  //
  // classify-data-presence ran earlier in the intake bootstrap and
  // wrote the tags to spaces.data_presence. We re-read rather than
  // accept via body so frame-extractor stays replayable on its own.
  //
  // Soft-fail: if the column is null (legacy row, classifier hasn't
  // run, or classifier soft-failed), applicableAxesFor ignores the
  // param and returns the legacy (type, domain)-only axis set. Exact
  // pre-migration behavior.
  let dataPresence: DataPresenceTags | null = null;
  let situationFrame: SituationFrame | null = null;
  let situationBaseline: SituationBaseline | null = null;
  try {
    const { data: spaceRow } = await db
      .from("spaces")
      .select("data_presence, situation_frame, situation_baseline")
      .eq("id", spaceId)
      .maybeSingle();
    const raw = (spaceRow as { data_presence?: unknown } | null)?.data_presence;
    if (raw && typeof raw === "object") {
      const r = raw as Record<string, unknown>;
      dataPresence = {
        has_telemetry: r.has_telemetry === true,
        has_historical_output: r.has_historical_output === true,
        has_baseline: r.has_baseline === true,
        has_spec: r.has_spec === true,
        has_just_idea: r.has_just_idea === true,
        data_presence_score:
          typeof r.data_presence_score === "number" ? r.data_presence_score : 0,
        evidence_excerpts: Array.isArray(r.evidence_excerpts)
          ? (r.evidence_excerpts as unknown[]).filter(
              (s): s is string => typeof s === "string",
            )
          : [],
      };
    }
    // situation_frame column populated by the framing panel upstream
    // (migration 20260528_situation_frame.sql). validateSituationFrame
    // is a never-throws coercer that returns emptyFrame() on bad data.
    const rawFrame = (spaceRow as { situation_frame?: unknown } | null)
      ?.situation_frame;
    if (rawFrame) {
      situationFrame = validateSituationFrame(rawFrame);
    }
    // situation_baseline column populated by the situation analyzer
    // (migration 20260605_assets_and_situation_baseline.sql). Carries
    // the structured "current state" + an `unknowns` array we can use
    // to scope axis selection toward the gaps the user actually has.
    // Null when the analyzer was skipped (vague intake) — same legacy
    // axis selection as before.
    const rawBaseline = (
      spaceRow as { situation_baseline?: unknown } | null
    )?.situation_baseline;
    if (rawBaseline && typeof rawBaseline === "object") {
      const r = rawBaseline as Record<string, unknown>;
      // Defensive shape assertion — only surface unknowns + uncertainty
      // here; we don't need the full nested structure for axis prompt
      // scoping. If the column is malformed, set to null and proceed.
      if (
        Array.isArray(r.unknowns) &&
        typeof r.uncertainty_score === "number" &&
        r.skipped_reason !== "twin_mode_structural" &&
        r.skipped_reason !== "no_assets_no_richness" &&
        r.skipped_reason !== "analyzer_failed"
      ) {
        situationBaseline = rawBaseline as SituationBaseline;
      }
    }
  } catch (err) {
    console.warn("[frame-extractor] space lookup failed:", err);
  }

  const candidateAxes = applicableAxesFor(qType.type, qType.domain, dataPresence);
  const presenceHintBlock = dataPresence
    ? `\n\nDATA PRESENCE (classified upstream — the user's raw materials):\n- telemetry: ${dataPresence.has_telemetry}\n- historical output: ${dataPresence.has_historical_output}\n- baseline: ${dataPresence.has_baseline}\n- spec/description: ${dataPresence.has_spec}\n- only an idea: ${dataPresence.has_just_idea}\nDO NOT include axes that have no raw material (e.g. financial axis when no numbers were provided). Let the candidate axes constrain you.\n`
    : "";
  // Baseline-driven scoping. When the situation analyzer extracted
  // an `unknowns` list, surface those gaps to the axis classifier so
  // it picks lenses that can address them. E.g., an unknown like
  // "no thermal stress data" pushes the LLM toward the engineer/risk
  // axes instead of cultural. Also surfaces uncertainty_score: high
  // uncertainty → suggest more axes (>=4); low → fewer (3 ok).
  const baselineHintBlock =
    situationBaseline && situationBaseline.unknowns.length > 0
      ? `\n\nBASELINE GAPS (extracted from intake + assets — these are what landscape axes should help close):\n${situationBaseline.unknowns
          .slice(0, 8)
          .map((u, idx) => `  ${idx + 1}. ${u}`)
          .join(
            "\n",
          )}\nUncertainty score: ${situationBaseline.uncertainty_score.toFixed(2)} (0=fully known, 1=fully unknown).\nPrefer axes that can plausibly produce evidence for the gaps above. When uncertainty >= 0.5, lean toward 4-5 axes (more lenses); when < 0.3, 3 axes is fine.\n`
      : "";
  const candidateSetBlock =
    qType.confidence >= 0.4
      ? `\n\nCANDIDATE AXES (derived from question type "${qType.type}" + domain "${qType.domain}"): ${candidateAxes.join(", ")}.\nPrefer these axes. Only include a non-candidate axis if there's a specific, input-grounded reason.${presenceHintBlock}${baselineHintBlock}`
      : presenceHintBlock + baselineHintBlock;

  // ── Plan-first path (Phase 2) ────────────────────────────────────
  //
  // When the user approved a KG generation plan and it carries
  // topic-adaptive axes, those TAKE PRECEDENCE over both the panel
  // and the legacy LLM classifier. The plan was reviewed + approved
  // by the user; respecting it is what makes the plan a contract.
  //
  // Soft-fails: if the plan loader hiccups, we fall through to the
  // existing panel-first path with no behavior change.
  let planAxes: KgPlanAxisProposal[] = [];
  try {
    const activePlan = await loadActivePlan(db, spaceId);
    if (activePlan?.axis_proposals?.axes?.length) {
      planAxes = activePlan.axis_proposals.axes;
    }
  } catch (err) {
    console.warn("[frame-extractor] active-plan load soft-failed:", err);
  }

  // ── Panel-first path (Piece 3 of the 2026-04-23 review) ──────────
  //
  // If the framing panel ran upstream and produced a usable frame —
  // defined as ≥1 required cell AND ≥1 axis whose target_cells
  // intersect a required cell — we skip the LLM classifier entirely
  // and derive the axis list directly from the panel's output via
  // axesCoveringRequiredCells(). This is the core "frame drives axes
  // instead of (type, domain) matrix" bridge.
  //
  // If the frame exists but has no required cells (e.g. panel
  // soft-failed to empty frame, or legacy row with null column), we
  // fall through to the legacy LLM classifier path below — exact
  // pre-Piece-3 behavior.
  let frame: FrameResponse;
  let frameSource:
    | "active_plan"
    | "panel"
    | "legacy_classifier"
    | "fallback" = "fallback";
  let frameTemperature = 0.2;
  const panelFrame = deriveFrameFromPanel(situationFrame);
  const planFrame = deriveFrameFromActivePlan(planAxes);

  // Boost temperature when the panel surfaced divergences — the LLM
  // downstream (if we do call it) should explore more, not less, when
  // lenses disagreed. Applied whether we took the panel path or the
  // legacy LLM path so generator temperature hints are consistent.
  if (situationFrame) {
    frameTemperature = temperatureForDivergence(situationFrame.divergences);
  }

  if (planFrame.frame.length > 0 || planFrame.adhoc.length > 0) {
    frame = { frame: planFrame.frame, adhoc_frame: planFrame.adhoc };
    frameSource = "active_plan";
  } else if (panelFrame.frame.length > 0 || panelFrame.adhoc.length > 0) {
    frame = { frame: panelFrame.frame, adhoc_frame: panelFrame.adhoc };
    frameSource = "panel";
  } else {
    // Legacy path — LLM classifier on the candidate-axis pool.
    try {
      frame = await llmJSON<FrameResponse>({
        system: SYSTEM_PROMPT + candidateSetBlock,
        user: buildUserPrompt(inputText),
        maxTokens: 800,
        temperature: frameTemperature,
        validator: validateFrame,
        fallback: {
          frame: [
            {
              axis: "causal_scenarios",
              rationale: "Default lens — outcomes branch with uncertainty.",
            },
            {
              axis: "assumptions",
              rationale:
                "Surfaces the load-bearing assumptions underlying the situation.",
            },
            {
              axis: "risk",
              rationale: "Default lens — most decisions carry downside exposure.",
            },
          ],
        },
      });
      frameSource = "legacy_classifier";
    } catch (err) {
      console.warn("[frame-extractor] LLM classification failed:", err);
      frame = {
        frame: [
          {
            axis: "causal_scenarios",
            rationale: "Fallback after classifier error.",
          },
          {
            axis: "assumptions",
            rationale: "Surfaces load-bearing beliefs.",
          },
          {
            axis: "risk",
            rationale: "Fallback after classifier error.",
          },
        ],
      };
      frameSource = "fallback";
    }
  }

  // ── Phase 2 §3.3 — always-include causal_scenarios under uncertainty ──
  //
  // Decision-under-uncertainty inputs MUST get the causal_scenarios
  // lens — that's the axis that surfaces "branching outcomes with
  // probability mass on each branch", and dropping it under any non-
  // trivial uncertainty produces probability spaces that pretend the
  // future is single-pathed when it isn't.
  //
  // No `outcome_uncertainty` field exists in the upstream classifiers
  // yet, so we synthesize a proxy from signals we DO have:
  //   • situationFrame.framing_confidence (low ⇒ uncertain)
  //   • situationFrame.divergences.length (high ⇒ uncertain)
  //   • qType.confidence (low ⇒ classifier itself was unsure)
  //   • dataPresence.has_just_idea  (only an idea ⇒ huge uncertainty)
  //
  // Threshold of 0.3 matches the plan's outcome_uncertainty > 0.3
  // gate; the proxy is conservative (errs toward including the lens),
  // which is correct — adding causal_scenarios on a confident input
  // is mildly redundant, dropping it on an uncertain input is
  // structurally wrong.
  function deriveOutcomeUncertainty(): number {
    let u = 0;
    if (situationFrame) {
      const conf = situationFrame.framing_confidence;
      if (typeof conf === "number" && conf < 0.7) {
        u = Math.max(u, 0.7 - conf); // 0..0.7 range
      }
      const divCount = situationFrame.divergences?.length ?? 0;
      if (divCount >= 1) {
        u = Math.max(u, Math.min(0.6, divCount * 0.2)); // 0.2..0.6
      }
    }
    if (qType.confidence < 0.5) {
      u = Math.max(u, 0.5 - qType.confidence); // 0..0.5
    }
    if (dataPresence?.has_just_idea) {
      u = Math.max(u, 0.6);
    }
    return u;
  }

  const outcomeUncertainty = deriveOutcomeUncertainty();
  const hasCausalScenarios = frame.frame.some(
    (sel) => sel.axis === "causal_scenarios",
  );
  if (!hasCausalScenarios && outcomeUncertainty > 0.3) {
    // Insert at index 0 so it paints first (lowest order_index ⇒
    // closest to the origin card). The rationale calls out WHY we
    // forced inclusion so users can see the gate fired.
    frame.frame.unshift({
      axis: "causal_scenarios",
      rationale: `Auto-included: outcome uncertainty ${outcomeUncertainty.toFixed(2)} (>0.3 threshold). Branching scenarios are load-bearing here even if the panel didn't surface them.`,
    });
  }

  // Persist frame rows + emit space_opened events for each axis in
  // order. Persistence first so a reload after the frame is set
  // re-reads from the DB rather than re-running the classifier.
  //
  // Ad-hoc axes ALSO persist (Phase 2E · Axis Richness) — the
  // `axis` column is plain text so the panel-minted axis_id stores
  // cleanly. The rationale field absorbs the spec's failure_mode
  // prefix for traceability when an ad-hoc axis produces thin output.
  const adhocList = frame.adhoc_frame ?? [];
  const catalogRows = frame.frame.map((sel, idx) => ({
    run_id: runId,
    space_id: spaceId,
    user_id: user.id,
    axis: sel.axis,
    rationale: sel.rationale,
    order_index: idx,
    status: "pending" as const,
  }));
  const adhocRows = adhocList.map((sel, idx) => ({
    run_id: runId,
    space_id: spaceId,
    user_id: user.id,
    axis: sel.spec.axis_id,
    rationale: sel.rationale,
    order_index: frame.frame.length + idx,
    status: "pending" as const,
  }));
  const rows = [...catalogRows, ...adhocRows];

  if (rows.length > 0) {
    const { error: insertErr } = await db
      .from("probability_space_runs")
      .insert(rows);
    if (insertErr) {
      console.warn(
        "[frame-extractor] probability_space_runs insert failed:",
        insertErr,
      );
    }
  }

  // ── Phase 3 §4.1 — persist + emit target_outcome ─────────────────
  //
  // Outcome persistence happens BEFORE the space_opened events fire,
  // so a downstream consumer that re-reads pipeline_runs while the
  // space shells are animating in always sees the outcome on the row.
  // Soft-fail on either step — the pipeline still works without the
  // outcome (just degrades to outcome-agnostic ranking). Skipped
  // entirely when extractor returned null (no signal).
  if (targetOutcome) {
    try {
      await db
        .from("pipeline_runs")
        .update({ target_outcome: targetOutcome })
        .eq("id", runId);
    } catch (err) {
      console.warn(
        "[frame-extractor] target_outcome persist failed:",
        err,
      );
    }
    try {
      await emitStructuralEvent(db, runId, {
        type: "target_outcome_identified",
        runId,
        name: targetOutcome.name,
        direction: targetOutcome.direction,
        metricKind: targetOutcome.metric_kind,
        horizon: targetOutcome.horizon,
        confidence: targetOutcome.confidence,
        rationale: targetOutcome.rationale,
      });
    } catch (err) {
      console.warn(
        "[frame-extractor] target_outcome event emit failed:",
        err,
      );
    }
  }

  // Emit space_opened events so the canvas paints shells in
  // real-time. Order matters — lower order_index = closer to the
  // origin card, painted first. Catalog axes use AXIS_CATALOG meta;
  // ad-hoc axes pull label/tagline/accent off their minted AxisSpec.
  for (let i = 0; i < frame.frame.length; i++) {
    const sel = frame.frame[i];
    const meta = AXIS_CATALOG[sel.axis];
    await emitStructuralEvent(db, runId, {
      type: "space_opened",
      spaceKey: `${runId}:${sel.axis}`,
      axis: sel.axis,
      label: meta.label,
      tagline: meta.tagline,
      accent: meta.accent,
      orderIndex: i,
      rationale: sel.rationale,
    });
  }
  for (let j = 0; j < adhocList.length; j++) {
    const sel = adhocList[j];
    await emitStructuralEvent(db, runId, {
      type: "space_opened",
      spaceKey: `${runId}:${sel.spec.axis_id}`,
      // SpaceOpenedEvent.axis is typed ProbabilitySpaceAxis. Cast via
      // string — the rail UI reads the `axis` field as a display key,
      // not a strict union member, and tolerates ad-hoc ids since
      // we also pass label + accent explicitly.
      axis: sel.spec.axis_id as ProbabilitySpaceAxis,
      label: sel.spec.label,
      tagline: sel.spec.tagline,
      accent: sel.spec.accent,
      orderIndex: frame.frame.length + j,
      rationale: sel.rationale,
    });
  }

  // ── Phase 2E · PR 2 — orchestrate per-axis generators ──
  //
  // Fan out one HTTP request per opened axis to the generator
  // endpoint. Each runs in its own Lambda + populates its shell
  // independently. `Promise.allSettled` so one axis's error
  // doesn't cancel sibling generations.
  //
  // Done inside `after()` so the frame extractor's response ships
  // immediately — the client sees space_opened events animate in,
  // then the shells start filling 10-60s later as each generator
  // completes.
  const cookieStore = await cookies();
  const hdrs = await headers();
  const origin =
    hdrs.get("origin") ??
    (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const catalogAxesToGenerate = frame.frame.map((sel) => ({
    axis: sel.axis,
    variant: sel.variant,
  }));
  const adhocAxesToGenerate = (frame.adhoc_frame ?? []).map((sel) => ({
    spec: sel.spec,
    variant: sel.variant,
  }));

  // Per-axis hard cap. An axis generator that hangs on an LLM call
  // without a timeout stalls Promise.allSettled below forever, which
  // means cross-space-linker never fires, which means space_merge_*
  // events never emit, which means the canvas sits on "opening…"
  // shells indefinitely. 120s covers the slowest legitimate axis
  // (ad-hoc generation with large inputs) while still short-circuiting
  // a truly stuck LLM call.
  const AXIS_TIMEOUT_MS = 120_000;

  after(async () => {
    // B1+B2 (docs/KG_DEPTH_CRITIQUE.md audit): track per-axis
    // success/failure so we can (a) emit `axis_failed` events on
    // every per-axis error, and (b) call completePipelineRun(failed)
    // when 100% of dispatched axes fail. Without this the run hangs
    // for 15min until the watchdog cron sweeps it, and the canvas
    // shows a blank screen with zero diagnostic signal.
    type AxisOutcome = {
      axis: string;
      spaceKey: string;
      ok: boolean;
      reason?: "timeout" | "hard_fail";
      errorMessage?: string;
    };
    const outcomes: AxisOutcome[] = [];

    // Helper: emit axis_failed AND record outcome. Soft-fails on
    // emit error so a wedged event bus doesn't block the catch path.
    async function recordAxisFailure(
      axis: string,
      reason: "timeout" | "hard_fail",
      errorMessage: string,
    ) {
      const spaceKey = `${runId}:${axis}`;
      outcomes.push({ axis, spaceKey, ok: false, reason, errorMessage });
      try {
        await emitStructuralEvent(db, runId, {
          type: "axis_failed",
          spaceKey,
          axis,
          reason,
          errorMessage,
        });
      } catch (emitErr) {
        console.warn(
          `[frame-extractor] axis_failed emit failed for ${axis} (non-fatal):`,
          emitErr,
        );
      }
    }

    // Catalog + ad-hoc fire in a single Promise.allSettled so slow
    // catalog axes don't block ad-hoc generation, and vice versa.
    // Each call routes to a different URL (axis key vs `_adhoc`)
    // so the route can pick the right prompt path.
    const catalogKickoffs = catalogAxesToGenerate.map(
      async ({ axis, variant }) => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), AXIS_TIMEOUT_MS);
        try {
          const res = await fetch(
            `${origin}/api/pipeline/probability-space/${axis}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Cookie: cookieHeader,
              },
              body: JSON.stringify({
                runId,
                userInput: inputText,
                questionType: qType.type,
                domain: qType.domain,
                // Intent not yet threaded through intake-bootstrap;
                // left null for now. When the intake form captures
                // (role, goal, context_type), bootstrap can forward
                // it via the frame-extractor payload and we wire
                // here.
                intent: null,
                variant,
              }),
              signal: ac.signal,
            },
          );
          // fetch() doesn't throw on HTTP errors — check ok flag
          // explicitly so a 500 from the axis route doesn't get
          // counted as success.
          if (!res.ok) {
            // Try to read the response body so we surface the actual
            // upstream exception (e.g. "OpenAI API quota exhausted",
            // "Rate limit reached", "axis output not an object") in
            // the user-visible failure summary. The axis route
            // returns `{ error: string, axis: string }` on hard_fail.
            let bodyDetail = "";
            try {
              const text = await res.text();
              if (text) {
                try {
                  const parsed = JSON.parse(text) as { error?: string };
                  bodyDetail = parsed.error ?? text.slice(0, 240);
                } catch {
                  bodyDetail = text.slice(0, 240);
                }
              }
            } catch {
              /* body read failed — non-fatal */
            }
            await recordAxisFailure(
              axis,
              "hard_fail",
              bodyDetail
                ? `HTTP ${res.status}: ${bodyDetail}`
                : `Generator returned HTTP ${res.status}`,
            );
            return;
          }
          outcomes.push({ axis, spaceKey: `${runId}:${axis}`, ok: true });
        } catch (err) {
          const aborted = ac.signal.aborted;
          const errorMessage =
            err instanceof Error ? err.message : String(err);
          await recordAxisFailure(
            axis,
            aborted ? "timeout" : "hard_fail",
            aborted
              ? `Generator timed out after ${AXIS_TIMEOUT_MS}ms`
              : errorMessage,
          );
          console.warn(
            `[frame-extractor] generator ${axis} kickoff ${aborted ? "TIMED OUT" : "failed"} (non-fatal):`,
            err,
          );
        } finally {
          clearTimeout(timer);
        }
      },
    );

    const adhocKickoffs = adhocAxesToGenerate.map(async ({ spec, variant }) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), AXIS_TIMEOUT_MS);
      const axis = spec.axis_id;
      try {
        const res = await fetch(
          `${origin}/api/pipeline/probability-space/_adhoc`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: cookieHeader,
            },
            body: JSON.stringify({
              runId,
              userInput: inputText,
              questionType: qType.type,
              domain: qType.domain,
              intent: null,
              variant,
              spec,
            }),
            signal: ac.signal,
          },
        );
        if (!res.ok) {
          // Same body-detail extraction as the catalog branch — see
          // explanatory comment above.
          let bodyDetail = "";
          try {
            const text = await res.text();
            if (text) {
              try {
                const parsed = JSON.parse(text) as { error?: string };
                bodyDetail = parsed.error ?? text.slice(0, 240);
              } catch {
                bodyDetail = text.slice(0, 240);
              }
            }
          } catch {
            /* body read failed — non-fatal */
          }
          await recordAxisFailure(
            axis,
            "hard_fail",
            bodyDetail
              ? `HTTP ${res.status}: ${bodyDetail}`
              : `Ad-hoc generator returned HTTP ${res.status}`,
          );
          return;
        }
        outcomes.push({ axis, spaceKey: `${runId}:${axis}`, ok: true });
      } catch (err) {
        const aborted = ac.signal.aborted;
        const errorMessage =
          err instanceof Error ? err.message : String(err);
        await recordAxisFailure(
          axis,
          aborted ? "timeout" : "hard_fail",
          aborted
            ? `Ad-hoc generator timed out after ${AXIS_TIMEOUT_MS}ms`
            : errorMessage,
        );
        console.warn(
          `[frame-extractor] ad-hoc generator ${axis} kickoff ${aborted ? "TIMED OUT" : "failed"} (non-fatal):`,
          err,
        );
      } finally {
        clearTimeout(timer);
      }
    });

    await Promise.allSettled([...catalogKickoffs, ...adhocKickoffs]);

    // B2 — if every dispatched axis failed, the run can't recover on
    // its own. Mark it failed immediately rather than letting it
    // dangle for ~15min until the watchdog sweeps. The canvas HUD
    // will pick up status=failed via SSE, render the U2 error label
    // and offer the U4 Retry button.
    const totalDispatched = outcomes.length;
    const totalFailed = outcomes.filter((o) => !o.ok).length;
    if (totalDispatched > 0 && totalFailed === totalDispatched) {
      const reasonsCsv = outcomes
        .map((o) => `${o.axis}:${o.reason ?? "unknown"}`)
        .join(", ");
      // Surface the actual exception message from the most-recent
      // failure so the canvas HUD shows e.g. "Rate limit reached" or
      // "OpenAI API quota exhausted" instead of just "hard_fail".
      // Without this, every axis failure looks identical to the user
      // and we can't tell quota outage from a flaky LLM response from
      // the canvas alone. We pick the FIRST non-empty errorMessage so
      // a transient last-axis error doesn't mask a load-bearing first
      // failure.
      const firstWithMessage = outcomes.find((o) => o.errorMessage);
      const detail = firstWithMessage?.errorMessage
        ? ` — ${firstWithMessage.errorMessage}`
        : "";
      const message =
        `All ${totalDispatched} axes failed during landscape generation` +
        ` (${reasonsCsv})${detail}`;
      // Dump every per-axis errorMessage to logs so we can
      // post-mortem the run from Vercel logs even when the user
      // didn't screenshot the canvas. allSettled discarded the
      // original throws; this is our only record.
      for (const o of outcomes) {
        if (!o.ok) {
          console.warn(
            `[frame-extractor]   axis=${o.axis} reason=${o.reason ?? "unknown"} message=${o.errorMessage ?? "(none)"}`,
          );
        }
      }
      console.warn(`[frame-extractor] ${message}`);
      try {
        await completePipelineRun(db, runId, "failed", message);
      } catch (completeErr) {
        console.warn(
          "[frame-extractor] completePipelineRun on full-axis-fail emit failed (non-fatal — watchdog will sweep):",
          completeErr,
        );
      }
      // Skip the cross-space linker + downstream stages — they have
      // nothing to work with when zero axes produced output.
      return;
    }

    // ── Phase 2E · PR 4 — cross-space linker ──
    //
    // After every per-axis generator has settled (success OR failure),
    // fire the linker endpoint. It reads all `space_entity_added`
    // events emitted during this run, detects cross-axis duplicates
    // via Pass 1 lexical matching, and emits `cross_space_link` +
    // `space_merge_begin` + `space_merge_complete` events so the
    // rail UI can play the convergence animation and the main canvas
    // knows merge is done.
    //
    // Soft-fail: if the linker endpoint 500s we still want the run
    // row to settle, so we swallow the error here and log. The rail
    // will just not play the merge animation in that (rare) case.
    //
    // Per-request timeout so a hung linker doesn't block downstream
    // stages forever. 60s is generous — the linker is a single LLM
    // call over lexically-matched candidates.
    {
      const linkerAc = new AbortController();
      const linkerTimer = setTimeout(() => linkerAc.abort(), 60_000);
      try {
        await fetch(`${origin}/api/pipeline/cross-space-linker`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieHeader,
          },
          body: JSON.stringify({ runId }),
          signal: linkerAc.signal,
        });
      } catch (err) {
        const aborted = linkerAc.signal.aborted;
        console.warn(
          `[frame-extractor] cross-space-linker kickoff ${aborted ? "TIMED OUT" : "failed"} (non-fatal):`,
          err,
        );
      } finally {
        clearTimeout(linkerTimer);
      }
    }
  });

  return NextResponse.json({
    frame: frame.frame,
    count: frame.frame.length,
    // Ad-hoc frame surfaced so downstream UI (and tests) can see what
    // panel-minted dimensions were dispatched. Empty array when the
    // panel didn't propose any ad-hoc axes.
    adhoc_frame: (frame.adhoc_frame ?? []).map((sel) => ({
      axis_id: sel.spec.axis_id,
      label: sel.spec.label,
      tagline: sel.spec.tagline,
      dimension: sel.spec.dimension,
      instrument_kind: sel.spec.instrument_kind,
      output_shape: sel.spec.output_shape,
      rationale: sel.rationale,
      variant: sel.variant,
    })),
    adhoc_count: (frame.adhoc_frame ?? []).length,
    // PR 1.5 — expose the classification so downstream generators
    // can pass questionType through to getAxisPrompt without re-
    // running the classifier. Also useful for telemetry.
    classification: {
      type: qType.type,
      secondary_type: qType.secondary_type,
      domain: qType.domain,
      complexity: qType.complexity,
      confidence: qType.confidence,
      rationale: qType.rationale,
    },
    candidate_axes: candidateAxes,
    // Piece 3 — panel surfacing. `frame_source` tells downstream what
    // produced the axis list; `frame_divergences` is UI-friendly
    // top-N; `frame_gate_status` lets the UI render the "needs user
    // input" affordance even though Piece 3 doesn't gate on it yet
    // (Piece 4 promotes the gate from metric to hard block).
    frame_source: frameSource,
    frame_temperature: frameTemperature,
    frame_divergences: topDivergences(situationFrame, 3),
    frame_gate_status: situationFrame?.gate_status ?? null,
    frame_confidence: situationFrame?.framing_confidence ?? null,
    frame_lens_count: situationFrame?.lenses_used.length ?? 0,
  });
}
