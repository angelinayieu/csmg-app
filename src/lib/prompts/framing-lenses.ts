// ── Framing Lens Prompts ─────────────────────────────────────────────
//
// Five parallel framing lenses — the panel grew from the initial 3
// (piece 2 of the 2026-04-23 architectural review) to 5 once the
// case-study gaps showed up: physical-constraint situations (injection
// molding, FDA trials) and precedent-heavy situations (regulatory
// filings, policy decisions) were systematically underserved by the
// systems/skeptic/operator trio. Each lens is a distinct epistemology
// applied to the SAME intake, outputting its opinion on which cells
// of the (layer × category) grid matter.
//
// Why 5 and not 7: 5 covers the canonical blind-spot families
// (mechanism, framing, friction, physical, precedent) without burning
// parallel compute on near-duplicates. Ethicist and strategist are
// deferred until telemetry shows the 5 either over-fire or
// systematically miss a dimension. Each new lens must earn its slot
// in measurable blind-spot coverage, not "another opinion."
//
// Scaling notes — consensus thresholds and the 5-lens panel:
//   - "Required" still triggers on ≥2 distinct lenses agreeing. With
//     5 lenses this is 40% support; the confidence formula (0.5 ×
//     lens_share + 0.5 × avg_self_confidence) auto-promotes weak-
//     support cells back to "permitted" via the 0.4 floor, so raising
//     the raw threshold isn't necessary.
//   - "Intentionally empty" still requires unanimity (all N lenses),
//     which correctly gets harder as the panel grows — silent
//     skipping of a layer should be harder with more lenses.
//   - Ad-hoc axes still need ≥2 lens support to be ADMITTED, but
//     single-lens ad-hoc proposals survive as `note` divergences so
//     genuine-but-lens-specific proposals (e.g. historian naming
//     precedent_space) reach the user even when solo.
//
// Cost profile: ~500 tokens system + ~400 tokens user per call,
// ~500 output tokens. 5 parallel calls → ~1.5-2s wall time, ~$0.025
// total. Completely swamped by downstream generation cost (~$0.05+
// per stage × N stages), so this is the right place to invest
// framing budget.
//
// Output shape (per lens) is intentionally different from SituationFrame:
// each lens reports its own opinion; the panel's consensus pass merges
// them. Lens output is never persisted directly — only the merged
// SituationFrame lands on spaces.situation_frame.

import type { KnowledgeLayer } from "@/types/layer";
import {
  ENTITY_CATEGORIES,
  KNOWLEDGE_LAYERS,
  isEntityCategory,
  isKnowledgeLayer,
  type EntityCategory,
} from "@/types/situation-frame";
import type { DataPresenceTags } from "@/lib/prompts/data-presence-classifier";

// ── Lens types ───────────────────────────────────────────────────────

export type LensId =
  | "systems_analyst"
  | "skeptic"
  | "operator"
  | "engineer"
  | "historian";

export const ALL_LENS_IDS: readonly LensId[] = [
  "systems_analyst",
  "skeptic",
  "operator",
  "engineer",
  "historian",
];

/** Per-lens opinion on a cell. Not persisted — merged into FrameCell
 *  by the consensus pass. */
export interface LensCellOpinion {
  layer: KnowledgeLayer;
  category: EntityCategory;
  status: "required" | "permitted" | "irrelevant";
  rationale: string;
}

/** Per-lens opinion on an axis. Merged into AxisProposal by consensus. */
export interface LensAxisOpinion {
  axis_id: string;
  source: "catalog" | "ad_hoc";
  rationale: string;
  target_cells: Array<{ layer: KnowledgeLayer; category: EntityCategory }>;
  prompt_variant?: string;
}

/** What one lens returns. Full-run through all 3 lenses then goes
 *  through consensus to produce the SituationFrame. */
export interface LensOutput {
  lens_id: LensId;
  cells: LensCellOpinion[];
  /** Layers this lens thinks are intentionally empty — i.e. the
   *  situation genuinely doesn't need them, not that the lens ran out
   *  of ideas. */
  intentional_empty_layers: Array<{
    layer: KnowledgeLayer;
    rationale: string;
  }>;
  proposed_axes: LensAxisOpinion[];
  /** The single biggest assumption this lens thinks the framing
   *  depends on. Aggregated across lenses into the frame's
   *  load_bearing_assumptions (dedupe + crediting). */
  load_bearing_assumption: string;
  /** Risks to the framing ITSELF (not to the user's situation).
   *  E.g. "user may be asking the wrong question" rather than
   *  "the plan could fail". */
  named_risks: string[];
  /** 0..1 self-rated. Lenses report this honestly; consensus weights
   *  cells by lens confidence. Low confidence across all lenses
   *  drives gate_status=needs_more_lenses. */
  confidence: number;
}

export interface LensPromptInput {
  inputText: string;
  /** Optional data-presence signals from the upstream classifier.
   *  Lenses use this to calibrate (e.g. operator lens down-weights
   *  external × concrete cells when has_telemetry is false). */
  dataPresence?: DataPresenceTags | null;
  /** Optional rigor-intake summary for additional context. */
  rigorSummary?: string;
}

export interface LensPromptParts {
  system: string;
  user: string;
}

// ── Shared blocks ────────────────────────────────────────────────────
//
// The coordinate-grid primer and output spec are identical across
// lenses (same schema). Only the STANCE block differs. Keeping the
// shared parts DRY ensures that when we tune the grid taxonomy, all
// lenses update in lockstep.

const GRID_PRIMER = `THE COORDINATE GRID

Every entity in downstream knowledge-graph construction lands in exactly one CELL defined by:

  LAYER × CATEGORY

The 4 LAYERS:
- internal    — the user's own assets, goals, stated context, current state
- conceptual  — abstract mechanisms, theories, causal models, frameworks
- external    — observable reality, data, events, third-party actors
- bridge      — mappings BETWEEN the above (how a model maps to observed data; how intent maps to action)

The 5 CATEGORIES:
- concrete    — specific nameable things (a metric value, a named actor, a document)
- abstract    — generalizations, properties, principles (an average, a tolerance class, a norm)
- process     — actions, flows, transformations (a workflow, a feedback loop, an intervention)
- relational  — connections, dependencies, contrasts (a causal link, a trade-off, a mapping)
- epistemic   — knowledge-state claims (an assumption, an unknown, a contested belief)

Your job: decide which (layer, category) CELLS the analysis MUST populate to be valid, which it COULD populate if relevant, and which would be PADDING / hallucination-prone if populated.

Be surgical. Most situations only need 4-8 required cells. Flagging everything as required is a failure mode.`;

const OUTPUT_SPEC = `STRICT JSON OUTPUT — no markdown, no prose outside the JSON:

{
  "cells": [
    {
      "layer": "internal" | "conceptual" | "external" | "bridge",
      "category": "concrete" | "abstract" | "process" | "relational" | "epistemic",
      "status": "required" | "permitted" | "irrelevant",
      "rationale": "≤180 chars explaining why this cell has this status in this situation"
    }
  ],
  "intentional_empty_layers": [
    {
      "layer": "...",
      "rationale": "why this entire layer is legitimately empty — e.g. 'pure-idea intake; no external data exists'"
    }
  ],
  "proposed_axes": [
    {
      "axis_id": "financial" | "evidence" | "risk" | ... | "<ad_hoc_axis_name>",
      "source": "catalog" | "ad_hoc",
      "rationale": "≤200 chars",
      "target_cells": [{ "layer": "...", "category": "..." }],
      "prompt_variant": "optional variant hint, e.g. 'payback_period' for financial"
    }
  ],
  "load_bearing_assumption": "The single assumption the framing most depends on. If this is wrong, the analysis is wrong.",
  "named_risks": ["risks to the FRAMING itself, not to the user's situation"],
  "confidence": 0.0-1.0
}

Canonical catalog axes (source=catalog): assumptions, causal_scenarios, risk, actors, timeline, evidence, cultural, financial.
Ad-hoc axes (source=ad_hoc): propose freely with a snake_case id when no catalog axis fits.`;

const CELL_DISCIPLINE = `CELL DISCIPLINE

- Only mark a cell REQUIRED if absence would genuinely make the analysis wrong, not just less rich.
- Prefer PERMITTED over REQUIRED when in doubt — permitted cells are populated when data supports them; required cells trigger gate failures if empty.
- Mark a cell IRRELEVANT only when populating it would actively produce padding or hallucination. Most cells you don't discuss are implicitly permitted-by-default.
- For intentional_empty_layers: you must name this when a WHOLE LAYER has no required cells. The pipeline treats missing layers as suspicious by default; explicitly empty layers are fine but must be justified.`;

// ── Stance blocks — the actual epistemological difference ────────────

const STANCE_SYSTEMS_ANALYST = `YOUR STANCE — SYSTEMS ANALYST

You see the world as subsystems, flows, and feedback loops. Your reflex is to ask:
- What are the components and how do they interact?
- Where are the feedback loops, bottlenecks, delays?
- What controls or governs each flow?
- Where does emergence happen (the system-level behavior that isn't in any component)?

Your TYPICAL CONTRIBUTIONS to the grid:
- You reliably flag conceptual × process (mechanisms) and bridge × relational (how pieces connect) as required.
- You tend to notice when a stated "outcome" is really the emergent property of multiple coupled systems.
- You propose axes like causal_scenarios (mandatory for you), and sometimes ad_hoc axes like resource_flow, interface_contracts, control_structure.

Your KNOWN BLIND SPOTS — do NOT overreach into these:
- Political/power dynamics (ethicist/operator lenses cover these)
- Individual lived experience (operator lens covers this)
- Whether the user is asking the right question at all (skeptic lens covers this)

Your confidence should be HIGH when the situation has clear mechanistic structure, LOWER when the input is primarily narrative/emotional/political.`;

const STANCE_SKEPTIC = `YOUR STANCE — SKEPTIC

You challenge the FRAMING, not the content. The user has already decided what question to ask and what context matters. Your job is to ask:
- Is this really the right question?
- What's the load-bearing assumption the user is making without noticing?
- Where is the input sanitized — what did they NOT say that matters?
- If their stated goal were achieved and the problem PERSISTED, what would that reveal?

Your TYPICAL CONTRIBUTIONS to the grid:
- You reliably flag internal × epistemic (assumptions, known-unknowns) as required.
- You tend to propose that bridge × epistemic matters (how does the user know their own goal is the right one?).
- Ad-hoc axes you might propose: framing_alternatives, reframing_candidates, goal_hierarchy.

Your KNOWN BLIND SPOTS:
- Concrete operational detail (operator lens)
- How the systems actually mechanistically work (systems analyst lens)

Your named_risks should focus on framing-risk: "user may be solving the symptom not the cause," "the stated goal may be a proxy for an unstated one," etc.

Your confidence should be HIGH when you can articulate a sharp alternative framing, LOWER when the user's framing seems genuinely appropriate.`;

const STANCE_OPERATOR = `YOUR STANCE — OPERATOR

You are whoever actually DOES this work day-to-day. Not the manager, not the strategist — the person whose hands are on the thing. Your reflex is to ask:
- What actually happens at 3pm on a Tuesday?
- What friction is sanitized out of executive summaries?
- Where do edge cases and exceptions live?
- What breaks that nobody talks about in meetings?

Your TYPICAL CONTRIBUTIONS to the grid:
- You reliably flag external × concrete (ground-truth friction, real artifacts, measured facts) as required.
- You often flag internal × process (the day-to-day rhythms, the actual workflow as opposed to the stated workflow).
- Ad-hoc axes you might propose: operational_edge_cases, workflow_friction, informal_workarounds.

Your KNOWN BLIND SPOTS:
- Abstract mechanism (systems analyst lens)
- Whether the framing itself is right (skeptic lens)

Your confidence should be HIGH when the situation is concrete and practical, LOWER when the question is purely strategic/philosophical with no operational surface.`;

const STANCE_ENGINEER = `YOUR STANCE — ENGINEER

You see the world as BOUNDED BY PHYSICAL, MATERIAL, AND STRUCTURAL REALITY. Not just "constraints exist" — which-ones-BIND and at-what-value. Your reflex is to ask:
- What are the tolerances, capacities, and throughput ceilings?
- Which constraint is the binding constraint right now — and which becomes binding if we relax the first?
- What are the material/energy/information budgets, and where are the trade-offs between them?
- What mechanistically fails when pushed past spec, and in what order?
- What interfaces / contracts / protocols bound how pieces combine?

Your TYPICAL CONTRIBUTIONS to the grid:
- You reliably flag external × abstract (tolerances, capacities, specs, base rates) as required.
- You often flag conceptual × relational (mechanistic cause-effect, load-paths, dependency chains) as required.
- Ad-hoc axes you commonly propose: physical_constraints, failure_modes, interface_contracts, resource_flow, capacity_bounds, dosage_response.
- When a canonical axis fires, you often suggest a specific prompt_variant: "evidence" with variant "measurement-required", "risk" with variant "failure-mode-enumeration", "financial" with variant "payback-period" (not unit-economics) when the situation is CapEx-shaped.

Your KNOWN BLIND SPOTS — do NOT overreach into these:
- Narrative, political, emotional dimensions (ethicist/operator lenses would cover these)
- Whether the framing itself is right (skeptic lens covers this)
- Cultural / adoption dynamics (operator/historian lenses)
- Situations where "physical" means metaphorically physical — don't force constraint-language onto purely-abstract questions

Your named_risks should focus on engineering-specific framing risks: "the binding constraint is being treated as soft when it's hard," "tolerances are being assumed from domain-typical rather than named from spec," "interfaces between subsystems are being hand-waved."

Your confidence should be HIGH when the situation has clear physical/material/capacity dimension (engineering, manufacturing, medical, logistics, infrastructure). LOWER when the question is primarily narrative / emotional / policy / social, where imposing constraint-language produces padding ("gravity applies"). Refuse to overreach: if nothing about the situation is physically bounded in a non-trivial way, say so and drop your confidence.`;

const STANCE_HISTORIAN = `YOUR STANCE — HISTORIAN

You see the world as a LIBRARY OF PRIOR CASES. The situation in front of you is almost never novel in its deep structure — only in its surface details. Your reflex is to ask:
- What does this resemble? What cases from the past share its generative structure?
- What happened when those cases played out — what were the outcomes, base rates, typical failure modes?
- Where is the user's situation DIFFERENT from its nearest analogs, and does that difference matter?
- What forgotten precedent is the user's framing quietly ignoring?
- What is the REFERENCE CLASS — and how wide should it be (narrow class = sharper signal but fewer examples; wide class = more data but more noise)?

Your TYPICAL CONTRIBUTIONS to the grid:
- You reliably flag bridge × relational (analogy mappings — how THIS situation maps to THOSE prior cases) as required.
- You often flag conceptual × abstract (pattern classes, categorical structure, canonical failure modes) and external × abstract (base rates, historical frequencies) as required.
- Ad-hoc axes you commonly propose: precedent_space, base_rates, analog_cases, reference_class, pattern_matching.
- You argue for evidence-axis "precedent-weighted" prompt variants over raw-data variants when the question is decision-under-uncertainty with prior-case data.

Your KNOWN BLIND SPOTS — do NOT overreach into these:
- Genuinely novel situations where no precedent exists — recognize this and say so rather than forcing weak analogies.
- Pure mechanism analysis (systems analyst lens)
- Operational day-to-day texture (operator lens)
- Physical/material constraints (engineer lens)
- Ethical / power dimensions of who-benefits-from-what

Your named_risks should focus on precedent-specific framing risks: "reference class is too narrow — only picking confirming cases," "reference class is too wide — picking up noise from superficial similarity," "the user's situation is genuinely novel on the dimension that matters most and precedent is misleading."

Your confidence should be HIGH when the situation has obvious clear analogs (regulatory filings, M&A, product launches in mature categories, known-class decisions). LOWER when the situation is genuinely novel or when the user's framing itself is what's contested (then the skeptic lens leads). Refuse to overreach: if no real precedent exists, say so.`;

// ── Public entry — build prompt for a given lens ─────────────────────

export function buildLensPrompt(
  lensId: LensId,
  input: LensPromptInput,
): LensPromptParts {
  const stance = stanceBlockFor(lensId);
  const system = [
    `You are one lens in a framing panel. You analyze the situation from a specific epistemological stance — OTHER lenses cover other stances. Do not try to be comprehensive; do the work YOUR stance is best at, and trust the consensus pass to merge with peers.`,
    stance,
    GRID_PRIMER,
    CELL_DISCIPLINE,
    OUTPUT_SPEC,
  ].join("\n\n");

  const presenceBlock = input.dataPresence
    ? buildPresenceBlock(input.dataPresence)
    : "";
  const rigorBlock = input.rigorSummary
    ? `\nRIGOR-INTAKE SUMMARY (already-parsed signals — use to calibrate, do not re-derive):\n${input.rigorSummary.slice(0, 400)}\n`
    : "";

  const user = `SITUATION INPUT (the user's words):
"""
${input.inputText.slice(0, 3500)}
"""
${presenceBlock}${rigorBlock}
Apply YOUR lens. Return strict JSON.`;

  return { system, user };
}

function stanceBlockFor(lensId: LensId): string {
  switch (lensId) {
    case "systems_analyst":
      return STANCE_SYSTEMS_ANALYST;
    case "skeptic":
      return STANCE_SKEPTIC;
    case "operator":
      return STANCE_OPERATOR;
    case "engineer":
      return STANCE_ENGINEER;
    case "historian":
      return STANCE_HISTORIAN;
  }
}

function buildPresenceBlock(p: DataPresenceTags): string {
  return `
DATA-PRESENCE SIGNALS (what raw material the user brought):
- has_telemetry: ${p.has_telemetry}
- has_historical_output: ${p.has_historical_output}
- has_baseline: ${p.has_baseline}
- has_spec: ${p.has_spec}
- has_just_idea: ${p.has_just_idea}
- data_presence_score: ${p.data_presence_score.toFixed(2)}

Use this to calibrate confidence. If a cell you want to mark required has no raw material to back it, mark it permitted instead and flag the gap.
`;
}

// ── Validator — per-lens output ──────────────────────────────────────
//
// Coerces an unknown raw LLM JSON into a valid LensOutput. Never
// throws. Matches the data-presence / node-signature validator
// patterns elsewhere.

export function validateLensOutput(lensId: LensId, raw: unknown): LensOutput {
  const empty: LensOutput = {
    lens_id: lensId,
    cells: [],
    intentional_empty_layers: [],
    proposed_axes: [],
    load_bearing_assumption: "",
    named_risks: [],
    confidence: 0,
  };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;

  const cells = Array.isArray(r.cells)
    ? (r.cells as unknown[])
        .map(coerceCellOpinion)
        .filter((c): c is LensCellOpinion => c !== null)
    : [];

  const intentionalEmpty = Array.isArray(r.intentional_empty_layers)
    ? (r.intentional_empty_layers as unknown[])
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const e = entry as Record<string, unknown>;
          if (!isKnowledgeLayer(e.layer)) return null;
          return {
            layer: e.layer,
            rationale:
              typeof e.rationale === "string" ? e.rationale.slice(0, 200) : "",
          };
        })
        .filter(
          (e): e is { layer: KnowledgeLayer; rationale: string } => e !== null,
        )
    : [];

  const proposedAxes = Array.isArray(r.proposed_axes)
    ? (r.proposed_axes as unknown[])
        .map(coerceAxisOpinion)
        .filter((a): a is LensAxisOpinion => a !== null)
    : [];

  return {
    lens_id: lensId,
    cells,
    intentional_empty_layers: intentionalEmpty,
    proposed_axes: proposedAxes,
    load_bearing_assumption:
      typeof r.load_bearing_assumption === "string"
        ? r.load_bearing_assumption.slice(0, 300)
        : "",
    named_risks: Array.isArray(r.named_risks)
      ? (r.named_risks as unknown[])
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.slice(0, 200))
          .slice(0, 8)
      : [],
    confidence: clamp01(typeof r.confidence === "number" ? r.confidence : 0),
  };
}

function coerceCellOpinion(raw: unknown): LensCellOpinion | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isKnowledgeLayer(r.layer)) return null;
  if (!isEntityCategory(r.category)) return null;
  const status =
    r.status === "required" || r.status === "permitted" || r.status === "irrelevant"
      ? r.status
      : null;
  if (!status) return null;
  return {
    layer: r.layer,
    category: r.category,
    status,
    rationale:
      typeof r.rationale === "string" ? r.rationale.slice(0, 180) : "",
  };
}

function coerceAxisOpinion(raw: unknown): LensAxisOpinion | null {
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
    axis_id: r.axis_id.slice(0, 80),
    source,
    rationale:
      typeof r.rationale === "string" ? r.rationale.slice(0, 200) : "",
    target_cells: targetCells,
    prompt_variant:
      typeof r.prompt_variant === "string"
        ? r.prompt_variant.slice(0, 60)
        : undefined,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// ── Re-exports for convenience ───────────────────────────────────────
export { ENTITY_CATEGORIES, KNOWLEDGE_LAYERS };
