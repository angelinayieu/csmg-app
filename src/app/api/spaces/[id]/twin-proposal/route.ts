// GET /api/spaces/[id]/twin-proposal
//   Returns the latest twin_proposal for this space, with linked mechanisms.
//   Falls back to extracting one on-the-fly from synthesis_data when no row
//   has been generated yet (lets the UI render against legacy strategies
//   before PR 3b wires the generator to write proposals natively).
//
// POST /api/spaces/[id]/twin-proposal
//   Body: { justification, mechanism_ids?, source_strategy_version? }
//   Creates a new proposal (used by the strategy generator post-gen).
//   Owner-only via RLS.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, safeJsonParse } from "@/lib/api-helpers";
import { extractTwinProposalFromStrategy } from "@/lib/pipeline/extract-twin-proposal";
import type {
  TwinProposalJustification,
  StrategicRecommendation,
  MechanismRow,
  RankedStrategy,
} from "@/types/strategy";
import type { ProposedTwinSpec } from "@/types/twin";
import type { CoherenceCheckResult, CoherenceIssue } from "@/lib/pipeline/validate-strategy-coherence";
import type { ConfidenceOverrideRow } from "@/app/api/strategy/confidence-override/route";

export const maxDuration = 15;

/**
 * Flattened hero-bar-friendly shape. The full `RankedStrategy` carries
 * the entire StrategicRecommendation; the hero bar only needs five
 * fields to render a 340px card. Extracting here on the server avoids
 * shipping ~10kb of strategy detail to the client per row, and keeps
 * the bar's render logic narrow.
 */
export interface RankedStrategyEntry {
  rank: number;
  title: string;
  summary: string;
  confidence: number | null;
  /** Raw posture value from StrategicRecommendation.strategic_posture.
   *  Hero bar's POSTURE_LABEL/POSTURE_ACCENT maps fall back gracefully
   *  for vocabulary not in their tables. */
  posture: string;
  /**
   * E3 — layer-stratified variant marker, flattened from
   * `recommendation.layer_focus`. `null` for comprehensive variants
   * (no focused layer). The strategy-hero shape's chip + left-edge
   * accent stripe read from these three fields; the seeder + the
   * shape's on-mount hydration both consume this row to populate the
   * `activeLayerFocus*` props.
   */
  layer_focus: {
    layer_id: string;
    label: string;
    color: string;
  } | null;
}

interface TwinProposalRow {
  id: string;
  space_id: string;
  user_id: string;
  justification: TwinProposalJustification;
  mechanism_ids: string[];
  source_strategy_version: number | null;
  user_status: "proposed" | "refined" | "approved" | "rejected";
  generated_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  refinement_constraint: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Frozen snapshot of what was claimed at approval time. Populated async
   * via persistProposedSpec() after the approve route returns. Null on
   * legacy proposals approved before migration 20260705 landed — clients
   * fall back to legacy infrastructure-map status counts.
   */
  proposed_spec: ProposedTwinSpec | null;
}

/**
 * Phase 1c readiness wiring — composite-meter inputs surfaced on the twin
 * proposal response so the review panel can render `ReadyToShipMeter` in a
 * single fetch (the panel already reads this endpoint to render the
 * justification + mechanisms, and synthesis_data is already in scope here).
 *
 * All four fields are nullable. The meter falls back to neutral 50 for
 * missing values, so legacy strategies still render a usable composite.
 */
export interface TwinProposalMeterInputs {
  confidence: number | null;
  coverage_pct: number | null;
  provenance_score: number | null;
  coherence_score: number | null;
}

/**
 * Phase 2 audit drawer — bundles the upstream signals that explain HOW the
 * composite-meter number was produced. Mirrors the persisted shape; this is
 * a re-pack from synthesis_data, not a recompute.
 *
 *   trace             — three confidence numbers from the diagnose→synthesize→
 *                       verify pipeline (so the user sees how stress-testing
 *                       moved the number).
 *   open_questions    — gap-analyzer output. Sidecar context for the user.
 *   reasoning_chain   — the LLM's rigorous narrative (entity codes, edge
 *                       dynamics, evidence quality). Already on rec but
 *                       surfaced here for drawer-only consumers.
 *   entity_references — IDs the strategy claims to be grounded in. Drawer
 *                       renders as chips; full KG-confidence resolution is
 *                       a follow-up (would require a join on `entities`).
 */
export interface TwinProposalAudit {
  trace: {
    diagnosis_confidence: number | null;
    estimated_confidence: number | null;
    verified_confidence: number | null;
    diagnosis_blind_spots: string[];
    step_durations_ms: {
      diagnosis: number | null;
      synthesis: number | null;
      verification: number | null;
      final: number | null;
    };
  };
  open_questions: Array<{
    question: string;
    why_it_matters?: string;
    priority?: string;
    user_answer?: string;
  }>;
  reasoning_chain: string | null;
  entity_references: string[];
}

interface TwinProposalResponse {
  proposal: TwinProposalRow | null;
  /** Set when no row exists yet but we extracted one from synthesis_data. */
  proposal_extracted: TwinProposalJustification | null;
  /** Mechanisms referenced by proposal.mechanism_ids (or all mechanisms for the
   *  space when proposal is null — gives the UI something to show). */
  mechanisms: MechanismRow[];
  /** True when the response is built from extracted (non-persisted) data. */
  is_extracted: boolean;
  /**
   * Top-N ranked strategies, flattened to hero-bar-friendly shape.
   *
   * Read from `space.synthesis_data.strategic_recommendation.ranked_strategies`
   * — the canonical source. The audit
   * (docs/KG_DEPTH_CRITIQUE.md) found that strategy-hero-bar previously
   * read `proposal.justification.ranked`, a field that DOES NOT EXIST
   * in TwinProposalJustification. As a result the bar always fell
   * through to single-strategy mode, breaking the T1.1 "top-N
   * side-by-side" feature. Extracting here at the route level (rather
   * than in extractTwinProposalFromStrategy) keeps the persisted
   * justification shape unchanged while giving the bar a stable read.
   *
   * Empty array when no synthesis_data exists yet OR when the
   * recommendation has no ranked_strategies field (single-strategy
   * runs — the bar's fallback handles those by rendering one card).
   */
  ranked_strategies: RankedStrategyEntry[];
  /** Composite-meter inputs. Null when no strategy exists yet. */
  meter_inputs: TwinProposalMeterInputs | null;
  /** Re-packed coherence shape so the review panel + drawer can render
   *  StrategyProvenancePanel issue lists without re-running the validator. */
  coherence: CoherenceCheckResult | null;
  /** Pipeline steps that fell back during generation (degraded honesty marker). */
  degraded_steps: string[] | null;
  /** Phase 2 audit-drawer payload. Null on legacy strategies (no reasoning trace). */
  audit: TwinProposalAudit | null;
  /** Provenance object passed straight to <StrategyProvenancePanel />. Decoupled
   *  from the rest of the recommendation to keep the wire small (~1kb vs ~25kb
   *  for the full strategy). Null when provenance hasn't been computed. */
  provenance: StrategicRecommendation["provenance"] | null;
  /** Latest confidence override the user has saved against THIS generation
   *  (not previous generations). Null when no override exists yet. The drawer
   *  pre-fills its widget from this; the meter shows "AI N · You M" when set. */
  user_override: ConfidenceOverrideRow | null;
  /** ISO timestamp of the strategy generation this response describes. The
   *  drawer passes this through when saving an override so the row is
   *  anchored to the right generation. Null on legacy strategies. */
  strategy_generated_at: string | null;
  /**
   * Strategy learning loop — the post-approval dashboard contract:
   * lagging_indicator + leading_indicators + review_cadence +
   * pivot_criteria + persistence_signals. Surfaced separately on the
   * response so the canvas-operational-seed-spawner can spawn a
   * learning-loop-card without re-downloading the entire ~25kb strategy
   * recommendation. Null when no strategy has run yet.
   */
  learning_loop: StrategicRecommendation["learning_loop"] | null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Latest persisted proposal (most-recent generated_at).
  const { data: proposal } = (await db
    .from("twin_proposals")
    .select("*")
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: TwinProposalRow | null };

  // Linked mechanisms — by IDs when proposal exists, else all space mechanisms.
  let mechanisms: MechanismRow[] = [];
  if (proposal && proposal.mechanism_ids.length > 0) {
    const { data: mechs } = (await db
      .from("mechanisms")
      .select("*")
      .in("id", proposal.mechanism_ids)) as { data: MechanismRow[] | null };
    mechanisms = mechs ?? [];
  } else {
    const { data: mechs } = (await db
      .from("mechanisms")
      .select("*")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: true })) as { data: MechanismRow[] | null };
    mechanisms = mechs ?? [];
  }

  // ALWAYS fetch synthesis_data — needed for both the legacy
  // extraction-when-no-proposal path AND for the new
  // ranked_strategies extraction (which the strategy-hero-bar reads
  // regardless of whether a persisted proposal exists). Single read
  // covers both.
  const { data: spaceRow } = (await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle()) as {
    data: { synthesis_data: Record<string, unknown> | null } | null;
  };
  const stratWrap = spaceRow?.synthesis_data?.strategic_recommendation as
    | { recommendation?: StrategicRecommendation; ranked_strategies?: RankedStrategy[] }
    | StrategicRecommendation
    | undefined;
  const strategy =
    (stratWrap as { recommendation?: StrategicRecommendation })?.recommendation
    ?? (stratWrap as StrategicRecommendation | undefined);
  const rawRanked =
    (stratWrap as { ranked_strategies?: RankedStrategy[] })?.ranked_strategies
    ?? null;

  // Flatten to hero-bar-friendly entries. Sort by rank ascending so
  // #1 is always first (defensive — strategy-engine sorts already
  // but the data path crosses JSONB serialization which doesn't
  // preserve order guarantees).
  let ranked_strategies: RankedStrategyEntry[] = [];
  if (Array.isArray(rawRanked) && rawRanked.length > 0) {
    ranked_strategies = [...rawRanked]
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      .map((entry) => {
        const rec = entry.recommendation;
        return {
          rank: typeof entry.rank === "number" ? entry.rank : 1,
          title:
            typeof rec?.title === "string" && rec.title.trim().length > 0
              ? rec.title
              : "Untitled strategy",
          summary:
            typeof rec?.summary === "string" && rec.summary.trim().length > 0
              ? rec.summary
              : entry.ranking_rationale ?? "",
          confidence:
            typeof rec?.confidence === "number" ? rec.confidence : null,
          posture:
            typeof rec?.strategic_posture === "string"
              ? rec.strategic_posture
              : "exploratory_discovery",
          // E3 — flatten the layer_focus marker if the variant was
          // generated with a single-layer focus. The full LayerFocus
          // object on the recommendation carries a rationale string;
          // we drop that here because the hero-bar/seeder only need
          // the three fields the chip renders from. Drawer + detail
          // page can read the full object from the raw recommendation.
          layer_focus:
            rec?.layer_focus &&
            typeof rec.layer_focus === "object" &&
            typeof rec.layer_focus.layer_id === "string" &&
            typeof rec.layer_focus.label === "string" &&
            typeof rec.layer_focus.color === "string"
              ? {
                  layer_id: rec.layer_focus.layer_id,
                  label: rec.layer_focus.label,
                  color: rec.layer_focus.color,
                }
              : null,
        };
      });
  } else if (strategy) {
    // Single-strategy fallback: synthesize wrote a recommendation but
    // didn't produce a ranked_strategies array (e.g. strategyCount=1
    // runs). Render as a one-entry batch so the hero bar still shows
    // the strategy in a card.
    ranked_strategies = [
      {
        rank: 1,
        title:
          typeof strategy.title === "string" && strategy.title.trim().length > 0
            ? strategy.title
            : "Recommended strategy",
        summary:
          typeof strategy.summary === "string" && strategy.summary.trim().length > 0
            ? strategy.summary
            : "",
        confidence:
          typeof strategy.confidence === "number" ? strategy.confidence : null,
        posture:
          typeof strategy.strategic_posture === "string"
            ? strategy.strategic_posture
            : "exploratory_discovery",
        // Single-strategy runs are never layer-stratified (stratification
        // implies multiple variants comparing layer foci).
        layer_focus: null,
      },
    ];
  }

  // Fallback extraction when no persisted proposal exists. Reads
  // synthesis_data.strategic_recommendation and produces a structured shape
  // so the UI has something to display today.
  let extracted: TwinProposalJustification | null = null;
  if (!proposal) {
    extracted = extractTwinProposalFromStrategy(strategy ?? null);
  }

  // Phase 1c — readiness meter inputs. All four come from already-fetched
  // synthesis_data; this is a re-pack, no extra DB call.
  const synthData = (spaceRow?.synthesis_data ?? {}) as Record<string, unknown>;
  const coherenceScoreRaw = synthData.coherence_score;
  const coherenceScoreNum =
    typeof coherenceScoreRaw === "number" ? coherenceScoreRaw : null;
  const coherenceIssues = (synthData.coherence_issues as CoherenceIssue[] | undefined) ?? [];

  const meterInputs: TwinProposalMeterInputs | null = strategy
    ? {
        confidence: typeof strategy.confidence === "number" ? strategy.confidence : null,
        coverage_pct:
          typeof strategy.provenance?.coverage_pct_at_generation === "number"
            ? strategy.provenance.coverage_pct_at_generation
            : null,
        provenance_score:
          typeof strategy.provenance?.overall_provenance_score === "number"
            ? strategy.provenance.overall_provenance_score
            : null,
        coherence_score: coherenceScoreNum,
      }
    : null;

  const coherence: CoherenceCheckResult | null =
    coherenceScoreNum !== null
      ? {
          coherence_score: coherenceScoreNum,
          // Mirror the validator's lenient passing rule: no critical issues +
          // score >= 40. We don't have the strict-mode flag here so always
          // use lenient — comprehensive-mode runs already gate at synth time.
          passed:
            !coherenceIssues.some((i) => i?.severity === "critical") &&
            coherenceScoreNum >= 40,
          issues: coherenceIssues,
        }
      : null;

  const degradedSteps = Array.isArray(strategy?.degraded_steps)
    ? (strategy.degraded_steps as string[])
    : null;

  // Phase 2 — audit-drawer payload. Re-packs the existing reasoning_trace +
  // open_questions so the panel can render the diagnose→synthesize→verify
  // sub-trace without a second fetch. All paths are best-effort — legacy
  // strategies return audit: null and the drawer renders a "no trace
  // available" empty state.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reasoningTrace = (stratWrap as any)?.reasoning_trace as
    | {
        diagnosis?: { confidence?: number; signal_synthesis?: { blind_spots?: string[] } };
        synthesis?: { options?: Array<{ estimated_confidence?: number }> };
        verification?: { verifications?: Array<{ verified_confidence?: number }> };
        step_timings?: {
          diagnosis_ms?: number;
          synthesis_ms?: number;
          verification_ms?: number;
          final_ms?: number;
        };
      }
    | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openQuestions = (synthData.open_questions as any[] | undefined) ?? [];

  // Phase 4 — anchor the override fetch on the strategy's generated_at.
  // stratWrap.generated_at is set by /api/pipeline/synthesize at write time
  // (see synthesize/route.ts:1791). Fall back to the proposal row's
  // generated_at when the strategy wasn't wrapped (legacy single-strategy).
  const strategyGeneratedAt: string | null =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (typeof (stratWrap as any)?.generated_at === "string"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? ((stratWrap as any).generated_at as string)
      : null) ??
    (proposal?.generated_at ?? null);

  let latestOverride: ConfidenceOverrideRow | null = null;
  if (strategyGeneratedAt) {
    const { data: overrideRows } = (await db
      .from("strategy_confidence_overrides")
      .select("*")
      .eq("space_id", spaceId)
      .eq("user_id", user.id)
      .eq("strategy_generated_at", strategyGeneratedAt)
      .order("created_at", { ascending: false })
      .limit(1)) as { data: ConfidenceOverrideRow[] | null };
    latestOverride = overrideRows?.[0] ?? null;
  }

  const audit: TwinProposalAudit | null = strategy
    ? {
        trace: {
          diagnosis_confidence:
            typeof reasoningTrace?.diagnosis?.confidence === "number"
              ? reasoningTrace.diagnosis.confidence
              : null,
          estimated_confidence:
            typeof reasoningTrace?.synthesis?.options?.[0]?.estimated_confidence === "number"
              ? reasoningTrace.synthesis.options[0].estimated_confidence
              : null,
          verified_confidence:
            typeof reasoningTrace?.verification?.verifications?.[0]?.verified_confidence ===
            "number"
              ? reasoningTrace.verification.verifications[0].verified_confidence
              : null,
          diagnosis_blind_spots: Array.isArray(
            reasoningTrace?.diagnosis?.signal_synthesis?.blind_spots,
          )
            ? (reasoningTrace.diagnosis.signal_synthesis.blind_spots as string[])
            : [],
          step_durations_ms: {
            diagnosis: reasoningTrace?.step_timings?.diagnosis_ms ?? null,
            synthesis: reasoningTrace?.step_timings?.synthesis_ms ?? null,
            verification: reasoningTrace?.step_timings?.verification_ms ?? null,
            final: reasoningTrace?.step_timings?.final_ms ?? null,
          },
        },
        open_questions: openQuestions
          .filter((q): q is Record<string, unknown> => !!q && typeof q === "object")
          .map((q) => ({
            question: typeof q.question === "string" ? q.question : "",
            why_it_matters:
              typeof q.why_it_matters === "string" ? q.why_it_matters : undefined,
            priority: typeof q.priority === "string" ? q.priority : undefined,
            user_answer:
              typeof q.user_answer === "string" ? q.user_answer : undefined,
          }))
          .filter((q) => q.question.length > 0),
        reasoning_chain:
          typeof strategy.reasoning_chain === "string" && strategy.reasoning_chain.trim().length > 0
            ? strategy.reasoning_chain
            : null,
        entity_references: Array.isArray(strategy.entity_references)
          ? strategy.entity_references
          : [],
      }
    : null;

  const payload: TwinProposalResponse = {
    proposal,
    proposal_extracted: extracted,
    mechanisms,
    is_extracted: !proposal && extracted !== null,
    ranked_strategies,
    meter_inputs: meterInputs,
    coherence,
    degraded_steps: degradedSteps && degradedSteps.length > 0 ? degradedSteps : null,
    audit,
    provenance: strategy?.provenance ?? null,
    user_override: latestOverride,
    strategy_generated_at: strategyGeneratedAt,
    learning_loop: strategy?.learning_loop ?? null,
  };
  return NextResponse.json(payload);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const { justification, mechanism_ids, source_strategy_version } =
    (body ?? {}) as {
      justification?: TwinProposalJustification;
      mechanism_ids?: string[];
      source_strategy_version?: number;
    };

  if (!justification || typeof justification.chosen_approach !== "string") {
    return NextResponse.json(
      { error: "justification.chosen_approach is required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: inserted, error } = (await db
    .from("twin_proposals")
    .insert({
      space_id: spaceId,
      user_id: user.id,
      justification,
      mechanism_ids: mechanism_ids ?? [],
      source_strategy_version: source_strategy_version ?? null,
      user_status: "proposed",
    })
    .select("*")
    .single()) as { data: TwinProposalRow | null; error: unknown };

  if (error || !inserted) {
    console.error("[twin-proposal POST] insert failed:", error);
    return NextResponse.json({ error: "Failed to save proposal" }, { status: 500 });
  }
  return NextResponse.json({ proposal: inserted });
}
