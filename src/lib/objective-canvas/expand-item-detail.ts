// ── Item Detail Expansion ──────────────────────────────────────────
//
// One LLM call that produces the depth surfaces shown in the item
// detail drawer. The current shallow cards name the item but don't
// say much about what it IS; this fills that gap.
//
// Three artifacts per call:
//
//   definition  — 2-3 sentence plain-language explanation that
//                 references the user's domain. Distinct from the
//                 title (the title NAMES; the definition EXPLAINS).
//
//   variations  — 3-5 alternative implementations of the same item,
//                 each with a tradeoff. Surfaces the design space —
//                 "you could do this 4 different ways."
//
//   planning    — assumes[], depends_on[], risks[] — the soft
//                 strategy layer that turns an idea into something
//                 a user can stress-test.
//
// All cached on entities.expanded_detail; called once on first
// drawer open, then never again unless the user explicitly
// regenerates.

import { llmJSON } from "@/lib/llm";
import type { ObjectiveAnnotation } from "./generate-annotations";
import type { AnnotationProvenance } from "./layered-generation";
import {
  buildConstraintsBlock,
  type OperationalConstraints,
} from "./constraints";

/** P2 (revised) — single user-facing impact axis. The user
 *  pushed back on multi-axis scoring: alignment / evidence /
 *  tradeoff_severity / coverage are quality CONSTRAINTS the LLM
 *  internalizes when producing variations, not separate scores
 *  the user reads. The only thing that matters at rank time is:
 *  does this variation address the pain. Composite formulas
 *  collapse incomparable signals and hide them behind a single
 *  number anyway — better to be honest about it. */

/** P2 — variations come in three shapes:
 *   "alternative" — pick ONE of these (mutually exclusive)
 *   "additive"    — stack any of these (composable)
 *   "principle"   — applies across ALL variations (cross-cutting)
 *  The drawer groups by kind so the user reads them correctly. */
export type VariationKind = "alternative" | "additive" | "principle";

/** P3 — election state. The user marks variations they want
 *  carried forward; composition synthesis fires when ≥2 are
 *  elected (within the same kind). */
export type VariationDisposition =
  | "elected"
  | "rejected"
  | "deferred"
  | null;

export interface ItemVariation {
  /** Stable client-side id — assigned at clean time so dispositions
   *  + composition survive regeneration (when names stay similar). */
  id: string;
  /** Short name for the variation, 3-6 words. */
  name: string;
  /** 1-2 sentence description of how this variant works. */
  description: string;
  /** 1 sentence tradeoff: what you gain, what you give up. */
  tradeoff: string;
  /** P2 — how this variation should be read (alternative/additive/principle). */
  kind: VariationKind;
  /** P2 (revised) — single impact axis: how directly does this
   *  variation counter the parent room's pains (0..1). Drives sort
   *  + score ring. */
  addresses_pain: number;
  /** B — 2-3 open questions whose answers would change whether
   *  this variation is the right call. These are the primary
   *  triggers for the prototype lab (L3) — each one composes
   *  with the variation + the user's constraints to yield one
   *  surgical experiment brief. */
  open_questions: string[];
  /** P1 — Annotation Lens provenance: which parent-objective
   *  annotations seeded this variation. */
  derived_from_annotations?: AnnotationProvenance[];
  /** P3 — user election state. Persisted in expanded_detail so it
   *  survives reloads. Null until the user touches it. */
  disposition?: VariationDisposition;
  /** Phase 4c — mechanism effectiveness score (0..1) from
   *  /api/brainstorm/item/variation/score. Composed as
   *  structural_signal × specificity × addresses_pain. Persisted
   *  so re-opening the drawer surfaces the prior scoring run
   *  without re-spending the MC budget. Stale when sibling
   *  elections change the room's mechanism graph — user can
   *  re-score from the panel header. */
  effectiveness_score?: number;
  /** Phase 11.1 — which evaluation tier produced effectiveness_score.
   *  Surfaces alongside the number everywhere via <MethodBadge /> so
   *  the user always sees what method ran. Five tiers per lock-in
   *  M10: heuristic / rubric / evidence / simulation / tested.
   *  Undefined for variations scored before Phase 11.1 (treat as
   *  "simulation" — that was the only path that existed). */
  evaluation_method?:
    | "heuristic"
    | "rubric"
    | "evidence"
    | "simulation"
    | "tested";
  /** Phase 11.1 — when evaluation_method = "rubric", carries the
   *  per-criterion grades (plausibility / addresses_pain /
   *  constraint_fit / novelty / risk) + their one-sentence reasons.
   *  Surfaced in the Lab page's Indicators table (Phase 11.2). */
  rubric_criteria?: {
    plausibility: { score: number; reason: string };
    addresses_pain: { score: number; reason: string };
    constraint_fit: { score: number; reason: string };
    novelty: { score: number; reason: string };
    risk: { score: number; reason: string };
  };
  /** Phase 5b — provenance flag distinguishing R&D-engine-proposed
   *  candidates from human-generated or originally-LLM-generated
   *  variations. Lets the UI render the "Candidates from experiment"
   *  section separately + lets analytics filter for refinement
   *  effectiveness over time. Undefined = original generation. */
  provenance?: "rd_iteration";
  /** Phase 5b — when provenance = "rd_iteration", this names the
   *  specific root_cause of the target pain that this candidate was
   *  generated to address. Powers the comparison panel label
   *  ("targets: context switching") + future analytics on which
   *  root causes get the most refinement attention. */
  target_root_cause?: string;
  /** Phase 5b — constraint compliance score (0..1) for R&D
   *  candidates. The LLM check rates each candidate against the
   *  user's operational constraints (time / budget / team / risk /
   *  compliance). Soft penalty in the composite score, not a hard
   *  gate — a variant that ignores a constraint still shows up
   *  but scores lower. Undefined when not an R&D candidate. */
  constraint_compliance?: number;
  /** Phase 12 — generated HTML interface mockup for elected
   *  variations. Static HTML with inline CSS, no scripts (server
   *  sanitizes before persist). Rendered in a sandboxed iframe
   *  by VariationDeliverablesModal. Undefined until the user fires
   *  /api/brainstorm/item/variation/mockup. */
  mockup_html?: string;
  mockup_generated_at?: string;
  /** Phase 13 — ready-to-paste AI prompt that encodes this
   *  variation's context so the user can hand it to ChatGPT/Claude
   *  to bootstrap implementation. Generated by
   *  /api/brainstorm/item/variation/export-prompt. */
  export_prompt?: string;
  export_prompt_generated_at?: string;
}

export interface ItemPlanning {
  /** 2-3 load-bearing assumptions this item relies on. */
  assumes: string[];
  /** 0-3 other items in the room this depends on. Free-text refs
   *  (item names) — the UI doesn't resolve them to entity IDs yet. */
  depends_on: string[];
  /** 2-3 ways this item fails or under-delivers. */
  risks: string[];
}

/** P3 — synthesized composed design when ≥2 variations are
 *  elected. Cached so the user can iterate without re-spending
 *  the LLM call. Cleared automatically when elections change. */
export interface ComposedDesign {
  /** 2-3 sentence description of the unified design. */
  description: string;
  /** Concrete integration points — how the elected variations
   *  interlock. Bullet-style. */
  integration_points: string[];
  /** Conflicts the composition had to resolve (and how). */
  conflicts_resolved: string[];
  /** Conflicts that REMAIN OPEN — the user must decide.
   *  Loud, surfaced as a banner in the drawer. */
  conflicts_open: string[];
  /** Variation ids the composition was synthesized from. Used
   *  to detect stale state (if elections changed, re-fire). */
  source_variation_ids: string[];
  /** ISO timestamp. */
  generated_at: string;
}

export interface ExpandedItemDetail {
  /** Plain-language meaning beyond the title. */
  definition: string;
  variations: ItemVariation[];
  planning: ItemPlanning;
  /** P3 — composed design across elected variations (≥2 elections
   *  within the same kind). Null when nothing is elected or only one. */
  composed_design?: ComposedDesign | null;
  /** D — prototype briefs the user has generated for variation /
   *  open-question pairs. Keyed by brief id (variation_id + question
   *  slug). Bag-style storage so multiple briefs per variation are
   *  fine. Type imported lazily by route + UI so we don't create a
   *  circular dep with generate-prototype-brief.ts. */
  prototype_briefs?: Array<{
    id: string;
    variation_id: string;
    open_question: string;
    domain: string;
    hypothesis: string;
    signal_to_watch: string;
    kill_criteria: string;
    build_estimate: string;
    artifact_type: string;
    artifact_body: string;
    learning_target: string;
    generated_at: string;
    /** J — experiment lifecycle. null = newly-generated (not yet
     *  touched). Set via PATCH /api/brainstorm/item/variation/
     *  prototype/status. Drives the Experiments Library filter chips. */
    status?: "planned" | "running" | "concluded" | "abandoned" | null;
    /** When status="concluded", optional user-captured result text. */
    result_summary?: string;
    /** ISO timestamp the status last changed — used for sorting
     *  "what did I just conclude" etc. */
    status_updated_at?: string;
  }>;
  /** E — expansion tree (L3+ deep-dive nodes per variation). Stored
   *  as a flat array; parent_node_id + depth + lineage_titles
   *  reconstruct the tree at render time. See expansion-tree.ts. */
  expansion_tree?: Array<{
    id: string;
    parent_node_id: string | null;
    depth: number;
    lineage_titles: string[];
    attach_point: string;
    attach_ref: string;
    node_type: string;
    title: string;
    body: Record<string, unknown>;
    source: "ai_auto" | "user_manual";
    disposition: "kept" | "parked" | null;
    derived_from_annotations?: Array<{
      index: number;
      phrase: string;
      facet: string;
    }>;
    generated_at: string;
  }>;
  /** Phase 4c — envelope-level data from the last scoring run.
   *  Variations carry their per-row effectiveness_score; the
   *  envelope carries the shared structural signals (which pain
   *  this feature was scored AGAINST + the raw MC lift + the
   *  placebo verdict) so the drawer can render the result banner
   *  on every re-open without re-spending the ~1-3s MC budget.
   *
   *  Reset to undefined when:
   *    • The feature is force-regenerated (definition changes →
   *      previous score is stale by construction)
   *    • The user manually re-scores (panel writes a fresh envelope)
   *
   *  Soft signal — undefined means "never scored." */
  effectiveness_envelope?: {
    /** Phase 11.1 — which evaluation tier produced this envelope.
     *  Defaults to "simulation" for envelopes written before 11.1
     *  (that was the only scoring path before this phase). The UI
     *  branches on this to render the right artifact set (lift band
     *  for sim, criteria table for rubric, citations for evidence). */
    evaluation_method?:
      | "heuristic"
      | "rubric"
      | "evidence"
      | "simulation"
      | "tested";
    /** The pain entity that was used as the target for MC propagation.
     *  Only meaningful when evaluation_method = "simulation". */
    target_entity_id: string | null;
    target_entity_name: string | null;
    target_edge_strength: number | null;
    /** Signed lift % returned by simulate-variant-lift.
     *  Only meaningful when evaluation_method = "simulation". */
    lift_pct: number | null;
    lift_band: { p10: number; p50: number; p90: number } | null;
    /** Specificity verdict from placebo refutation.
     *  Only meaningful when evaluation_method = "simulation". */
    placebo_verdict: "pass" | "fail" | "skip" | null;
    placebo_ratio: number | null;
    /** Envelope-level diagnostic status from the scoring run.
     *  "ok" when scores are valid; other values explain why the
     *  panel can't show effective scores. "llm_failed" added in
     *  Phase 11.1 for the rubric path. */
    status:
      | "ok"
      | "no_target"
      | "no_variations"
      | "lever_unreachable"
      | "sim_failed"
      | "not_feature"
      | "no_expanded"
      | "llm_failed";
    status_detail: string | null;
    /** ISO of when this envelope was computed. Drives the "scored
     *  Xm ago" hint in the panel. */
    scored_at: string;
  };
  /** ISO timestamp the LLM produced this. */
  generated_at: string;
}

export interface ExpandItemContext {
  /** What kind of item this is — determines tone + framing. */
  layer: "pain" | "features" | "outcomes" | "objective";
  /** The item's title (the lane card heading). */
  name: string;
  /** Existing per-item context from causal_chain. Pulled by caller.
   *  Pain: { negative_outcome, root_causes }
   *  Feature: { positive_outcome, first_principles }
   *  Outcome: { measured_by } */
  causalChain: Record<string, unknown>;
  /** Parent sub-objective title — for domain grounding. */
  subObjectiveTitle: string;
  /** Parent core objective — for top-level grounding. */
  coreObjectiveText: string;
  /** Optional RAG block (research-service.buildRagBlock output).
   *  When present, definition + variations get grounded in real
   *  sources. Optional — falls back to first-principles when absent. */
  ragBlock?: string;
  /** P1 — parent objective annotations. When provided, the lens
   *  block is injected into the prompt and each variation captures
   *  derived_from_annotations[] provenance for chip rendering. */
  annotations?: ObjectiveAnnotation[];
  /** Lane context for ranking — the room's pain titles + outcome
   *  titles inform the addresses_pain + coverage axes so the LLM
   *  isn't guessing at room scope. Empty arrays are tolerated. */
  roomPains?: string[];
  roomOutcomes?: string[];
  /** C — operational constraints. When provided, the LLM filters
   *  out variations the user literally cannot execute and biases
   *  toward patterns that fit their time / budget / team / risk
   *  profile. Without this, "optimize" is meaningless. */
  constraints?: OperationalConstraints | null;
  /** Polish-4 — user's revealed per-kind election pattern from the
   *  decision log. Soft signal: bias borderline kind choices toward
   *  what the user historically elects, but NEVER sacrifice an
   *  objectively-right variation to please the pattern. Caller is
   *  responsible for cold-start gating (only pass when total events
   *  ≥10 — see variationKindSignalIsLive in decision-log.ts).
   *  Shape mirrors VariationKindPreference[] (kept structural here
   *  to dodge a circular dep). */
  variationKindPreferences?: Array<{
    kind: "alternative" | "additive" | "principle";
    elects: number;
    rejects: number;
    rate: number | null;
  }>;
  /** Polish-4 — themes the Distill analysis has surfaced across the
   *  user's rooms ("transparency", "compounding feedback", etc.).
   *  These are SECOND-ORDER signals: the system noticed its own
   *  pattern. Bias new variations toward respecting the themes the
   *  user keeps electing toward. Empty array → no block injected. */
  distillThemes?: Array<{ name: string; description: string }>;
  /** Cross-space KG — canonical concepts (from prior spaces) that
   *  are semantically related to this item. When non-empty, the
   *  generator gets a "link or diverge" block so variations reuse
   *  concepts the user has already named instead of fragmenting
   *  the KG with parallel framings. */
  priorConcepts?: Array<{
    display_name: string;
    description: string | null;
    domain_tags: string[];
    space_count: number;
  }>;
  /** Lazy upstream-read — the cards UPSTREAM of this one in the
   *  causal chain, with their election + depth state. For a feature
   *  card, upstream = pains that this feature addresses. For an
   *  outcome card, upstream = features that produce it (plus any
   *  pains whose absence IS the outcome).
   *
   *  This is the propagation answer: when a user has elected
   *  variations / spawned expansion nodes upstream, downstream
   *  expansion should consume those choices as context so the
   *  generated variations bias toward addressing what's been
   *  specifically chosen, not the generic parent.
   *
   *  Soft signal — empty array tolerated. Caller passes at most
   *  3-4 upstream items to keep token cost bounded. */
  upstreamContext?: Array<{
    /** The upstream card's title. */
    name: string;
    /** Which lane the upstream item lives in. */
    layer: "pain" | "features" | "outcomes" | "objective";
    /** Names of variations the user has elected on this upstream
     *  card. Empty array → user hasn't committed to a direction yet. */
    elected_variation_names: string[];
    /** Short titles of the top 2-3 expansion-tree nodes (kept
     *  disposition) on this upstream card. */
    expansion_highlights: string[];
    /** Phase 3 — edge content connecting this upstream item to the
     *  target item. Surfaces the named mechanism (lever) the
     *  correlation LLM identified at edge-generation time, plus the
     *  rationale (which root_cause × first_principle the edge
     *  bridges). Lets variation generation EXTEND the named
     *  mechanism instead of inventing a parallel one.
     *
     *  Optional — older rooms / partial-data paths may not carry it.
     *  Empty strings tolerated. */
    edge_relationship?: string;
    edge_mechanism?: string;
    edge_rationale?: string;
  }>;
  /** Phase 3 — lateral context: SIBLING items in the same layer
   *  inside this room. Siblings don't causally feed THIS card via
   *  edges — they CO-EXIST in the user's mental model. When a
   *  sibling has elected variations or kept expansion nodes, this
   *  card's variations should compose-with, differentiate-from, or
   *  explicitly interfere-with those neighbor choices instead of
   *  silently duplicating them.
   *
   *  Soft signal — empty / undefined tolerated. Caller filters out
   *  siblings with NO active signal (no elections, no expansions)
   *  and caps at 3 most-active to bound token cost. */
  lateralContext?: Array<{
    /** Sibling card's title. */
    name: string;
    /** Sibling's elected variation names (the user's committed
     *  direction on that card). */
    elected_variation_names: string[];
    /** Sibling's top kept expansion-tree node titles. */
    expansion_highlights: string[];
  }>;
  /** Closed read loop — prototype briefs the user has already
   *  RUN on THIS item's variations. Filtered upstream to
   *  status="concluded" with a non-empty result_summary so the
   *  prompt only sees experiments that actually concluded with
   *  a learned outcome.
   *
   *  The block teaches the LLM: when a variation has been tested
   *  and the user wrote down what they learned, DON'T re-propose
   *  the same open_question (the answer exists). DO surface the
   *  learning as a structural signal — the variation might no
   *  longer need a "tradeoff" framing if the experiment resolved it.
   *
   *  Soft signal — empty array tolerated; legacy items pre-dating
   *  the lifecycle have none. */
  testedBriefs?: Array<{
    /** The variation this brief tested (name, not id — keeps the
     *  prompt readable; the route resolves variation_id → name). */
    variation_name: string;
    /** The original open question the brief was answering. */
    open_question: string;
    /** The signal_to_watch the brief committed to. */
    signal_to_watch: string;
    /** What the user planned to LEARN. */
    learning_target: string;
    /** The user-captured outcome — required, the upstream filter
     *  drops briefs without one. */
    result_summary: string;
    /** ISO of when the user concluded the brief. */
    status_updated_at?: string;
  }>;
  /** Closed read loop — structural findings the Analysis Workbench
   *  has already surfaced that touch THIS item or its room. The
   *  caller filters CrossRoomAnalysisState.findings to:
   *    • drop resolved / dismissed (user closed the signal)
   *    • drop distill_concepts (already flows via distillThemes)
   *    • keep findings whose references match this entity or its
   *      parent_sub_objective_id (or which are space-wide signals
   *      explicitly opted in)
   *  …then maps each finding to one entry below. The kind enum
   *  drives ordering + framing in the prompt block.
   *
   *  Why this matters: without it, the analysis workbench detects
   *  a duplicate variation across rooms / a contradiction / an
   *  uncovered pain — and then the next time the user opens the
   *  drawer to regenerate variations, the LLM has no idea the
   *  pattern exists. With it, variations either fold the signal
   *  in (extend the shared mechanism, differentiate from the
   *  duplicate, resolve the contradiction) or surface the friction
   *  in the variation's tradeoff so the user reads where the
   *  open decision lives.
   *
   *  Soft signal — empty / undefined tolerated. */
  crossRoomFindings?: Array<{
    /** Drives sort order + prompt framing. */
    kind:
      | "pain_uncovered"
      | "pain_cross_addressed"
      | "contradiction"
      | "duplicate_variation"
      | "shared_mechanism"
      | "annotation_overlap";
    /** The finding's headline — short, ≤ 80 chars. */
    title: string;
    /** One-sentence summary the LLM ingests. */
    summary: string;
    /** Optional surgical hint pulled from the finding body — e.g.
     *  the mechanism's verbatim name, the contradicting variation's
     *  partner room, the addressing room titles. Empty allowed. */
    hint?: string;
  }>;
}

// ── Per-layer framing — different prompts for different lane types ──

const LAYER_FRAMING: Record<ExpandItemContext["layer"], string> = {
  pain: `This is a PAIN POINT — an observable EFFECT the user wants to
counter. Your job: explain what this pain ACTUALLY IS in the user's
domain (definition), enumerate the ways this same pain MANIFESTS
behaviorally / observationally in different contexts (variations —
manifestations, NOT solutions), and surface the assumptions /
dependencies / risks of treating this as a real problem (planning).

VARIATION TYPE FOR PAINS: each variation is a different OBSERVABLE
SHAPE the same pain takes in the wild. "Users bounce after 2 results"
is a variation. "Better filtering" is NOT a variation — it's a
solution to the pain, which belongs in the FEATURE lane as its own
item.`,

  features: `This is a FEATURE — a concrete mechanism / lever the
system provides. Your job: explain what this feature ACTUALLY IS as
a working mechanism (definition), enumerate 3-5 INTERNAL
implementation patterns of HOW THIS SPECIFIC FEATURE is built
(variations — implementation strategies, NOT sibling features), and
surface the assumptions, prerequisites, and failure modes that would
determine whether this feature actually fires the intended
downstream effect (planning).

VARIATION TYPE FOR FEATURES: each variation is a different INTERNAL
MECHANISM for delivering THIS feature. If the parent feature is
"Goal Matching", variations are "goal matching via stated goals" vs
"goal matching via behavioral inference" vs "goal matching via
collaborative filtering" — all SPECIALIZATIONS of the same feature.
"User Feedback Loop" is NOT a variation of "Goal Matching" — it's a
different feature entirely and belongs as its own room item or
sub-objective.`,

  outcomes: `This is an OUTCOME — a desired observable state. Your
job: explain what this outcome ACTUALLY LOOKS LIKE in the user's
world (definition), enumerate 3-5 SENSING / MEASUREMENT PATTERNS
that would each detect this exact outcome differently (variations —
measurement strategies, NOT features that produce the outcome), and
surface the assumptions + risks + dependencies that would affect
whether this outcome is the RIGHT one to track (planning).

VARIATION TYPE FOR OUTCOMES: each variation is a different SIGNAL
the system reads to confirm THIS outcome happened. If the parent
outcome is "Reduced Information Overload", variations are
"self-reported overwhelm score 4/5", "bounce rate after first 3
results", "repeat-query rate within session" — all SIGNALS that
detect the same outcome via different proxies. "Contextual Filtering"
is NOT a variation of "Reduced Information Overload" — it's a
FEATURE that produces the outcome, and belongs as its own room item
or sub-objective.`,

  objective: `This is an OBJECTIVE — the umbrella target. Your job:
explain what this objective MEANS in the user's domain (definition),
enumerate 3-5 valid INTERPRETATIONS / framings of WHAT IT MEANS for
this objective to be achieved (variations — readings of the same
target, NOT sub-goals), and surface the assumptions + dependencies
+ risks of choosing this particular framing (planning).

VARIATION TYPE FOR OBJECTIVES: each variation is a different LENS on
what success for this objective even looks like. "Sub-goal A" or
"Sub-goal B" are NOT variations — those are decomposition children
and belong in the sub-objective list, not here.`,
};

/** P1 — render the parent-objective annotations as a numbered
 *  lens block. The variation-level prompt is read-only against it
 *  and emits 1-based indices back. Same shape (weight-sort top-8)
 *  as the room generator so indices stay aligned. */
function buildVariationLensBlock(
  annotations: ObjectiveAnnotation[] | undefined,
): { block: string; ranked: ObjectiveAnnotation[] } {
  if (!annotations || annotations.length === 0) {
    return { block: "", ranked: [] };
  }
  const ranked = [...annotations]
    .sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5))
    .slice(0, 8);
  const lines: string[] = [
    "ANNOTATION LENS (the parent objective's load-bearing semantic readings):",
  ];
  ranked.forEach((a, i) => {
    const w = typeof a.weight === "number" ? a.weight.toFixed(2) : "—";
    const lane = a.layer_tag ? ` lane:${a.layer_tag}` : "";
    lines.push(`  [${i + 1}] "${a.phrase}" (weight ${w}${lane})`);
    if (a.reading) lines.push(`        reading: ${a.reading}`);
    if (a.fragility?.when) {
      const sign = a.fragility.sign ? ` · early sign: ${a.fragility.sign}` : "";
      lines.push(`        fragility: when ${a.fragility.when}${sign}`);
    }
    const an = a.analogies?.[0];
    if (an?.why_same) {
      const ref = an.referent ? `like ${an.referent} ` : "";
      const dom = an.domain ? `(${an.domain}) ` : "";
      lines.push(`        analogy: ${ref}${dom}— ${an.why_same}`);
    }
    if (a.tensions?.length) {
      const t = a.tensions[0];
      lines.push(`        ${t.kind} with "${t.phrase}": ${t.note}`);
    }
  });
  return { block: `\n\n${lines.join("\n")}\n`, ranked };
}

export async function expandItemDetail(
  ctx: ExpandItemContext,
): Promise<ExpandedItemDetail> {
  const framing = LAYER_FRAMING[ctx.layer];

  // Pull layer-specific signal from causal_chain into a readable
  // block — the LLM gets to see what's already been said about
  // this item so it doesn't restate the same thing.
  const ccLines: string[] = [];
  const cc = ctx.causalChain ?? {};
  if (ctx.layer === "pain") {
    if (typeof cc.negative_outcome === "string") {
      ccLines.push(`  Negative outcome (downstream): ${cc.negative_outcome}`);
    }
    if (Array.isArray(cc.root_causes)) {
      const rc = (cc.root_causes as unknown[])
        .filter((x): x is string => typeof x === "string")
        .slice(0, 4);
      if (rc.length > 0) {
        ccLines.push(`  Root causes (already identified): ${rc.join(", ")}`);
      }
    }
  } else if (ctx.layer === "features") {
    if (typeof cc.positive_outcome === "string") {
      ccLines.push(`  Positive outcome (downstream): ${cc.positive_outcome}`);
    }
    if (Array.isArray(cc.first_principles)) {
      const fp = (cc.first_principles as unknown[])
        .filter((x): x is string => typeof x === "string")
        .slice(0, 4);
      if (fp.length > 0) {
        ccLines.push(`  First principles (already identified): ${fp.join(", ")}`);
      }
    }
  } else if (ctx.layer === "outcomes") {
    if (typeof cc.measured_by === "string") {
      ccLines.push(`  Measurement signal (already identified): ${cc.measured_by}`);
    }
  }

  const ccBlock = ccLines.length > 0 ? `\n\nEXISTING CONTEXT FOR THIS ITEM:\n${ccLines.join("\n")}` : "";
  const ragBlockOut = ctx.ragBlock && ctx.ragBlock.length > 0 ? `\n\n${ctx.ragBlock}` : "";

  // P1 — lens block + P2 room context for ranking.
  const lens = buildVariationLensBlock(ctx.annotations);
  const hasLens = lens.ranked.length > 0;
  const roomPainsBlock =
    ctx.roomPains && ctx.roomPains.length > 0
      ? `\n\nROOM PAINS (use to score addresses_pain):\n${ctx.roomPains
          .slice(0, 6)
          .map((p, i) => `  ${i + 1}. ${p}`)
          .join("\n")}`
      : "";
  const roomOutcomesBlock =
    ctx.roomOutcomes && ctx.roomOutcomes.length > 0
      ? `\n\nROOM OUTCOMES (use to score coverage):\n${ctx.roomOutcomes
          .slice(0, 6)
          .map((o, i) => `  ${i + 1}. ${o}`)
          .join("\n")}`
      : "";

  const system = `You expand a single strategy-room item into its detail surface so the user can stop guessing what the AI meant and start reasoning about the bet.

${framing}

OUTPUT THREE THINGS:

1) DEFINITION — 2-3 sentences. Plain language. Explains what this item ACTUALLY IS, distinct from the title. The title NAMES; the definition EXPLAINS. Reference the user's domain. Don't restate the title. Don't restate the existing context already given.

2) VARIATIONS — 3-5 alternative implementations / patterns / framings of the same item. Each variation:
     • name             — 3-6 words. Concrete pattern name.
     • description      — 1-2 sentences. How this variant works.
     • tradeoff         — 1 sentence. What you gain, what you give up vs the other variations.
     • kind             — one of:
         · "alternative" — pick ONE of these (mutually exclusive with sibling alternatives)
         · "additive"    — stacks with siblings, composable
         · "principle"   — cross-cutting design principle that applies across other variations
       This is critical: don't lump composable layers with mutually-exclusive choices. The user needs to know whether to PICK ONE or STACK ANY.
     • addresses_pain   — 0..1. ONLY rank axis. How directly does this variation counter the ROOM PAINS listed below. 1.0 = decisive counter to multiple pains. 0.5 = partially addresses. <0.3 = drop the variation, don't emit it. The user reads this as the score.
     • open_questions   — 2-3 unresolved questions whose answers would change whether this variation is the right call. Be SPECIFIC — "does this work for X-style users?" not "is this good?". These become the user's prototype lab triggers. Each ≤ 100 chars.

   The variations should span the DESIGN SPACE — different patterns, not different intensities of the same pattern. ❌ BAD: "Light gamification" / "Medium gamification" / "Heavy gamification". ✅ GOOD: "Streak-based" / "Social leaderboard" / "Mastery progression" / "Narrative quests".

   DERIVATION TEST (mandatory — apply to EVERY variation before emitting it):
   A variation must be a SPECIALIZATION of this specific item, not an adjacent / sibling concept that just happens to connect to it.

   Self-test for each candidate variation:
     "If I removed this item's title and read the variation aloud, could it stand on its own as a SEPARATE item / feature / outcome / sub-objective in the user's strategy?"
       • YES it could stand alone → REJECT. You are generating a sibling concept, not a variation. It belongs as its own room item OR sub-objective, NOT here.
       • NO it only makes sense as a way THIS specific item manifests / is implemented / is measured / is interpreted → KEEP.

   The variation's name or description should structurally reference or specialize this item. Patterns that work: "{item} via X", "X-based {item}", "{item} measured by X", "{item} when X". Patterns that fail the test: a stand-alone feature/outcome name that has its own independent meaning.

   ❌ EXAMPLE — wrong layer (parent = outcome "Reduced Information Overload"):
        "Contextual Filtering"            — this is a feature, not a measurement of the outcome
        "Goal-Based Search Prioritization" — same, a feature
        "User Feedback Loop"              — same, a feature
   ✅ EXAMPLE — correct layer (parent = outcome "Reduced Information Overload"):
        "Self-reported overwhelm score 4/5"  — measurement signal
        "Bounce rate after first 3 results"  — behavioral signal
        "Repeat-query rate within session"   — frustration signal
        "Time-to-first-meaningful-click"     — engagement signal

   If you find yourself wanting to propose a sibling concept (it failed the test), drop the variation entirely — do NOT pad the list with weaker specializations to hit a count. 3 strong specializations beat 5 mixed-layer variations every time.

   PRODUCTION CONSTRAINTS (the LLM internalizes these — they are NOT user-facing scores):
     - Every variation must be well-grounded in the parent objective context. Generic platitudes get rewritten or dropped.
     - Every variation must have a real, distinguishable tradeoff. "No tradeoff" means you haven't found one — try harder.
     - When research context is provided, prefer variations evidence-backed by it.
     - When the annotation lens is provided, prefer variations that derive from a high-weight reading.
     - Lighter tradeoffs > heavier ones when impact is comparable.
   These are quality gates, not scores. Apply them silently.

3) PLANNING — three short lists:
     • assumes      — 2-3 load-bearing assumptions this item depends on
     • depends_on   — 0-3 other items / capabilities this needs first (free-text references)
     • risks        — 2-3 ways this item under-delivers or fails

ANTI-PLATITUDE: every output must reference something specific from the item, sub-objective, or research context. Generic strategy filler is forbidden.

If research context is provided above, cite it where it informs your output — but you don't need to cite every claim. Definitions and variations benefit most from citations; planning can be first-principles.${
    hasLens
      ? `

ANNOTATION PROVENANCE: For each variation, include derived_from_annotations[] — 0-3 entries of { index: 1-based lens index, facet: "fragility" | "analogy" | "tension" | "dimension" | "inference" | "reading" } pointing at the readings this variation derives from. Empty [] is acceptable when no annotation directly seeds the variation. PREFER analogy for additive variations (cross-domain mappings naturally compose), fragility for principle-kind variations (the pre-mortem the principle exists to counter), tension for alternative variations (where the design space splits).`
      : ""
  }

Return strict JSON.`;

  const constraintsBlock = buildConstraintsBlock(ctx.constraints ?? null);

  // Polish-4: per-kind user preference signal. Soft bias only — never
  // override objective generation criteria. Cold-start gate is the
  // CALLER's job (see variationKindSignalIsLive); if we got prefs at
  // all, treat them as actionable.
  const kindPrefBlock =
    ctx.variationKindPreferences && ctx.variationKindPreferences.length > 0
      ? `\n\nUSER VARIATION-KIND PATTERN (revealed from prior item-detail decisions — SECONDARY signal):\n${ctx.variationKindPreferences
          .filter((p) => p.rate !== null)
          .slice(0, 3)
          .map(
            (p) =>
              `  • ${p.kind} — elects ${Math.round((p.rate ?? 0) * 100)}% of the time (${p.elects}✓ ${p.rejects}✕)`,
          )
          .join(
            "\n",
          )}\n  This is a TIEBREAKER. Generate the right kind distribution for the design space FIRST; bias the borderline calls toward patterns the user has elected before. Never sacrifice an "alternative" worth surfacing to please the pattern. Never produce a "principle" variation just because the user elects them — only when one is structurally present.`
      : "";

  // Polish-4: Distill themes — the system's own pattern detector
  // surfacing what threads through the user's rooms. These are
  // SECOND-ORDER signals (decision_log captures atomic events;
  // Distill names the pattern they form). Bias new variations to
  // RESPECT these themes — don't propose variations that violate
  // them.
  const themesBlock =
    ctx.distillThemes && ctx.distillThemes.length > 0
      ? `\n\nDISTILLED THEMES (recurring across this user's rooms — variations should RESPECT these, not violate them):\n${ctx.distillThemes
          .slice(0, 4)
          .map((t) => `  • "${t.name}" — ${t.description.slice(0, 160)}`)
          .join(
            "\n",
          )}\n  When a candidate variation contradicts an established theme, either drop it or surface the contradiction explicitly in its tradeoff so the user sees what they'd be giving up.`
      : "";

  // Cross-space KG — canonical concepts the user has explored across
  // other spaces that are semantically related to this item. Same
  // "link or diverge" pattern the decompose prompt uses, but scoped
  // to the item (so the model sees concepts relevant to THIS feature
  // / pain / outcome, not the whole objective). Empty array → block
  // omitted (cold-start / no prior KG signal).
  const priorConceptsBlock =
    ctx.priorConcepts && ctx.priorConcepts.length > 0
      ? `\n\nCONCEPTS YOU'VE ALREADY EXPLORED ACROSS YOUR SPACES (your cross-space knowledge graph — link or diverge):\n${ctx.priorConcepts
          .slice(0, 6)
          .map((c, i) => {
            const tags =
              c.domain_tags.length > 0
                ? ` [${c.domain_tags.slice(0, 3).join(", ")}]`
                : "";
            const spaces =
              c.space_count > 1 ? ` · used in ${c.space_count} of your spaces` : "";
            const desc = c.description
              ? `\n      ${c.description.slice(0, 160)}`
              : "";
            return `  [${i + 1}] ${c.display_name}${tags}${spaces}${desc}`;
          })
          .join(
            "\n",
          )}\n  PRIOR-CONCEPTS RULE: If a variation naturally maps onto one of these concepts, REFERENCE the display_name verbatim in your variation name so the post-insert matcher can link it across your KG. If you're DELIBERATELY proposing a divergent take, NAME THE DIVERGENCE in the tradeoff field. Don't reinvent concepts you've already named — that fragments your KG.`
      : "";

  // Lazy upstream-read — depth on Pain influences Mechanism expansion;
  // depth on Mechanism influences Outcome expansion. Without this
  // block, each card's expansion is siloed (fine at generation; loses
  // coherence as users deepen). The block names the upstream cards +
  // what's elected + what's been deepened + Phase 3: the edge
  // CONNECTION (named mechanism + rationale from the correlation LLM)
  // so generated variations extend the named lever instead of
  // inventing a parallel one. Soft signal — empty array → block
  // omitted.
  const upstreamBlock =
    ctx.upstreamContext && ctx.upstreamContext.length > 0
      ? `\n\nUPSTREAM CHAIN (cards that FEED into this one — bias depth to address what's been chosen here, not the generic parent):\n${ctx.upstreamContext
          .slice(0, 4)
          .map((u) => {
            // Phase 3 — surface the edge content (relationship +
            // mechanism + rationale) when the correlation step
            // recorded one. The variation generator now knows HOW
            // upstream connects, not just THAT it does.
            const edgeBlurb = u.edge_mechanism
              ? `\n      connection: ${
                  u.edge_relationship?.trim() || "links to this card"
                } via "${u.edge_mechanism.trim()}"${
                  u.edge_rationale && u.edge_rationale.trim().length > 0
                    ? ` — ${u.edge_rationale.trim().slice(0, 200)}`
                    : ""
                }`
              : "";
            const elected =
              u.elected_variation_names.length > 0
                ? `\n      elected: ${u.elected_variation_names.slice(0, 4).join(" | ")}`
                : `\n      elected: (nothing committed yet)`;
            const highlights =
              u.expansion_highlights.length > 0
                ? `\n      deepened into: ${u.expansion_highlights.slice(0, 3).join(" · ")}`
                : "";
            return `  ${u.layer} "${u.name}"${edgeBlurb}${elected}${highlights}`;
          })
          .join(
            "\n",
          )}\n  UPSTREAM RULE: When upstream has ELECTED variations or DEEPENED nodes, your output should make sense as a downstream response to those choices. If you'd otherwise generate a variation that ignores upstream elections, either tie it to one OR explicitly justify the divergence in its tradeoff. EXTEND the named mechanism from "connection:" when present — your variations should be different ways of pulling the SAME lever, not parallel inventions. Don't drift away from the chain — the user is building one coherent bet.`
      : "";

  // Phase 3 — lateral siblings: co-resident items in the same lane
  // (e.g. all the FEATURE cards in this room when expanding a
  // feature) that have user-elected variations or kept expansion
  // nodes. Without this block, sibling cards generate variations in
  // isolation and silently duplicate each other's design choices.
  // The block names sibling cards + their elections + their kept
  // nodes, so the variation generator has explicit awareness of
  // what the room's neighboring mechanisms are doing.
  //
  // Soft signal — empty array → block omitted. Caller already
  // filtered out siblings with no active signal (no elections, no
  // kept nodes); we keep only the top 3 by signal weight.
  const lateralBlock =
    ctx.lateralContext && ctx.lateralContext.length > 0
      ? `\n\nSIBLING ${ctx.layer.toUpperCase()} CARDS (other items in the same lane that the user is actively shaping — your variations should COMPOSE, DIFFERENTIATE, or explicitly INTERFERE, not silently duplicate):\n${ctx.lateralContext
          .slice(0, 3)
          .map((s) => {
            const elected =
              s.elected_variation_names.length > 0
                ? `\n      elected: ${s.elected_variation_names.slice(0, 4).join(" | ")}`
                : "";
            const highlights =
              s.expansion_highlights.length > 0
                ? `\n      deepened into: ${s.expansion_highlights.slice(0, 3).join(" · ")}`
                : "";
            return `  "${s.name}"${elected}${highlights}`;
          })
          .join(
            "\n",
          )}\n  SIBLING RULE: For each variation you emit, ask "does this OVERLAP with a sibling's elected choice?" — if yes, either (a) RE-FRAME this variation to cover ground the sibling does NOT, (b) explicitly COMPOSE with it (your variation depends on or extends the sibling — say so in the description), or (c) raise an INTERFERENCE WARNING in the tradeoff field naming the specific conflict ("this conflicts with sibling X's choice of Y because Z"). Do NOT silently duplicate sibling work — the room is ONE coherent system, not a list of redundant levers.`
      : "";

  // Closed-read-loop block — already-tested briefs. When variations
  // on THIS item have been prototyped + concluded with a learning,
  // the LLM sees both the original question AND the user's recorded
  // outcome. The block instructs the model to:
  //   • DROP open_questions on those variations that the test answered
  //   • SURFACE the learning in the variation's tradeoff or description
  //     (e.g., "Tested in 7-day field trial; held under social proof,
  //     failed in solo mode — bias toward the social configuration")
  //   • Prefer NEW open_questions that the conducted experiment did
  //     NOT resolve
  // Soft signal; empty array → block omitted.
  const testedBriefsBlock =
    ctx.testedBriefs && ctx.testedBriefs.length > 0
      ? `\n\nALREADY-TESTED VARIATIONS (the user ran these experiments and recorded outcomes — respect what was learned):\n${ctx.testedBriefs
          .slice(0, 4)
          .map(
            (b) =>
              `  "${b.variation_name}"\n      Q: ${b.open_question.slice(0, 120)}\n      Signal: ${b.signal_to_watch.slice(0, 80)}\n      Outcome: ${b.result_summary.slice(0, 280)}`,
          )
          .join(
            "\n",
          )}\n  TESTED RULE: For variations above, DROP open_questions the test already answered, SURFACE the learning in the variation's description or tradeoff, and only emit NEW open_questions that the experiment did NOT resolve. Do not propose to re-test the same hypothesis. Treat the user's recorded outcome as ground truth, not as something to second-guess.`
      : "";

  // Closed-read-loop block — cross-room structural findings the
  // Analysis Workbench has already detected that touch THIS item /
  // room. Caller filtered to live (non-resolved, non-dismissed) +
  // relevant; we only render. Sort by kind so the loudest signals
  // (uncovered pain → contradiction → duplicate → consistency hints)
  // appear first regardless of the order findings arrived in.
  //
  // PROMPT ECONOMICS — cap at 6 (after sort) to keep the block lean.
  // High-signal findings are sparse by construction (analyses already
  // filtered for ≥2-room overlap / elections), so 6 is plenty in
  // practice and rarely binds.
  const KIND_ORDER: Record<
    NonNullable<ExpandItemContext["crossRoomFindings"]>[number]["kind"],
    number
  > = {
    pain_uncovered: 0,
    contradiction: 1,
    pain_cross_addressed: 2,
    duplicate_variation: 3,
    shared_mechanism: 4,
    annotation_overlap: 5,
  };
  const crossRoomFindingsBlock =
    ctx.crossRoomFindings && ctx.crossRoomFindings.length > 0
      ? `\n\nCROSS-ROOM STRUCTURAL SIGNALS (patterns the analysis workbench has already detected that involve THIS item or its room — fold these into your output, do not regenerate blind):\n${[...ctx.crossRoomFindings]
          .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
          .slice(0, 6)
          .map((f) => {
            const hint = f.hint ? ` — ${f.hint.slice(0, 140)}` : "";
            return `  [${f.kind}] ${f.title.slice(0, 100)}\n      ${f.summary.slice(0, 220)}${hint}`;
          })
          .join(
            "\n",
          )}\n  CROSS-ROOM RULE: When a finding above directly touches THIS item, EITHER (a) propose variations that FOLD the structural signal in (extend the shared mechanism by name; differentiate from the duplicate variation; resolve / sidestep the contradiction; emit a counter-variation for the uncovered pain), OR (b) name the friction explicitly in the variation's TRADEOFF so the user reads where the open decision lives. Do NOT silently propose a variation that re-introduces a duplicate, re-extends a contradiction, or ignores an uncovered pain — those are exactly the signals the analysis workbench surfaced so they wouldn't recur.`
      : "";

  const user = `PARENT OBJECTIVE:\n"""\n${ctx.coreObjectiveText.slice(0, 1500)}\n"""\n\nSUB-OBJECTIVE (room scope):\n"""\n${ctx.subObjectiveTitle}\n"""\n\nITEM:\n  Layer: ${ctx.layer}\n  Title: ${ctx.name}${ccBlock}${roomPainsBlock}${roomOutcomesBlock}${constraintsBlock}${lens.block}${upstreamBlock}${lateralBlock}${testedBriefsBlock}${crossRoomFindingsBlock}${priorConceptsBlock}${kindPrefBlock}${themesBlock}${ragBlockOut}\n\nExpand this item per the system instructions. Variations and open_questions must respect the operational constraints — if a variation is unreachable for this user's budget / team / time, do not emit it.`;

  // ── Schema (dynamic — adds derived_from_annotations only when
  //    the lens has entries, mirroring the room generator pattern). ──
  const variationProps: Record<string, unknown> = {
    name: { type: "string" },
    description: { type: "string" },
    tradeoff: { type: "string" },
    kind: {
      type: "string",
      enum: ["alternative", "additive", "principle"],
    },
    addresses_pain: { type: "number" },
    open_questions: { type: "array", items: { type: "string" } },
  };
  const variationRequired: string[] = [
    "name",
    "description",
    "tradeoff",
    "kind",
    "addresses_pain",
    "open_questions",
  ];
  if (hasLens) {
    variationProps.derived_from_annotations = {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "number" },
          facet: {
            type: "string",
            enum: [
              "fragility",
              "analogy",
              "tension",
              "dimension",
              "inference",
              "reading",
            ],
          },
        },
        required: ["index", "facet"],
      },
    };
    variationRequired.push("derived_from_annotations");
  }

  const raw = await llmJSON<{
    definition?: unknown;
    variations?: Array<{
      name?: unknown;
      description?: unknown;
      tradeoff?: unknown;
      kind?: unknown;
      addresses_pain?: unknown;
      open_questions?: unknown;
      derived_from_annotations?: unknown;
    }>;
    planning?: {
      assumes?: unknown;
      depends_on?: unknown;
      risks?: unknown;
    };
  }>({
    system,
    user,
    responseSchema: {
      name: "expand_item_detail",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          definition: { type: "string" },
          variations: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: variationProps,
              required: variationRequired,
            },
          },
          planning: {
            type: "object",
            additionalProperties: false,
            properties: {
              assumes: { type: "array", items: { type: "string" } },
              depends_on: { type: "array", items: { type: "string" } },
              risks: { type: "array", items: { type: "string" } },
            },
            required: ["assumes", "depends_on", "risks"],
          },
        },
        required: ["definition", "variations", "planning"],
      },
    },
    temperature: 0.45,
    maxTokens: 2800,
  });

  // ── Normalize ──
  const definition =
    typeof raw?.definition === "string" ? raw.definition.trim() : "";

  /** Variation ids are deterministic from name slug ONLY (no index)
   *  so dispositions survive regeneration even when the LLM re-orders
   *  the array. If the LLM produces two variations with the same slug
   *  (rare but possible), the second appends a suffix. */
  const seenSlugs = new Set<string>();
  function variationId(name: string, idx: number): string {
    const baseSlug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || "var";
    let slug = baseSlug;
    if (seenSlugs.has(slug)) slug = `${baseSlug}-${idx}`;
    seenSlugs.add(slug);
    return `v_${slug}`;
  }

  /** Clamp 0..1 and fall back to 0.5 when the LLM omits or returns
   *  garbage — a fair midpoint that doesn't bias the sort. */
  function n01(v: unknown, fallback: number): number {
    if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
    return Math.max(0, Math.min(1, v));
  }

  /** Open-questions cleaner — strict 2-3 cap per variation,
   *  100-char max per entry to keep the drawer scannable. */
  function readOpenQuestions(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return (v as unknown[])
      .filter(
        (s): s is string => typeof s === "string" && s.trim().length > 0,
      )
      .map((s) => s.trim().slice(0, 140))
      .slice(0, 3);
  }

  /** P1 — resolve {index, facet} pairs against the same weight-
   *  sorted top-8 lens the prompt saw. Out-of-range indices drop. */
  function resolveVariationProvenance(
    raw: unknown,
  ): AnnotationProvenance[] | undefined {
    if (!hasLens) return undefined;
    if (!Array.isArray(raw)) return undefined;
    const out: AnnotationProvenance[] = [];
    const seen = new Set<number>();
    for (const v of raw) {
      if (!v || typeof v !== "object") continue;
      const r = v as Record<string, unknown>;
      const index =
        typeof r.index === "number" && Number.isFinite(r.index)
          ? Math.floor(r.index)
          : NaN;
      if (!Number.isFinite(index) || index < 1) continue;
      if (seen.has(index)) continue;
      seen.add(index);
      const ann = lens.ranked[index - 1];
      if (!ann) continue;
      const facet =
        typeof r.facet === "string"
          ? (r.facet as AnnotationProvenance["facet"])
          : "reading";
      out.push({ index, phrase: ann.phrase, facet });
      if (out.length >= 3) break;
    }
    return out;
  }

  const variations: ItemVariation[] = Array.isArray(raw?.variations)
    ? raw.variations
        .map((v, idx): ItemVariation | null => {
          const name = typeof v?.name === "string" ? v.name.trim() : "";
          if (name.length === 0) return null;
          const kind =
            v?.kind === "alternative" ||
            v?.kind === "additive" ||
            v?.kind === "principle"
              ? (v.kind as VariationKind)
              : "alternative";
          return {
            id: variationId(name, idx),
            name: name.slice(0, 100),
            description:
              typeof v?.description === "string"
                ? v.description.trim().slice(0, 400)
                : "",
            tradeoff:
              typeof v?.tradeoff === "string"
                ? v.tradeoff.trim().slice(0, 300)
                : "",
            kind,
            addresses_pain: n01(v?.addresses_pain, 0.5),
            open_questions: readOpenQuestions(v?.open_questions),
            derived_from_annotations: resolveVariationProvenance(
              v?.derived_from_annotations,
            ),
            disposition: null,
          };
        })
        .filter((v): v is ItemVariation => v !== null)
        .slice(0, 6) // allow up to 6 since "principle" rows often add
    : [];

  const planning: ItemPlanning = {
    assumes: Array.isArray(raw?.planning?.assumes)
      ? (raw.planning.assumes as unknown[])
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .slice(0, 4)
      : [],
    depends_on: Array.isArray(raw?.planning?.depends_on)
      ? (raw.planning.depends_on as unknown[])
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .slice(0, 4)
      : [],
    risks: Array.isArray(raw?.planning?.risks)
      ? (raw.planning.risks as unknown[])
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .slice(0, 4)
      : [],
  };

  return {
    definition,
    variations,
    planning,
    generated_at: new Date().toISOString(),
  };
}
