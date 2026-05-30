// ── Brainstorm Critique + Rank ──────────────────────────────────────
//
// Stage 4 of the Brainstorm Runner (BRAINSTORM_MODULE_SPEC.md §3).
// Scores every surviving candidate on a composite:
//
//     0.40 · coverage_gain
//     0.25 · diversity (cluster-distance from existing elected set)
//     0.20 · user_preference_fit
//     0.15 · critique_pass_verdict
//
// Splits ribbons: top 3 = green ("ready to elect"), next 4 = amber
// ("explore"), rest = tray (collapsed but recoverable).
//
// Phase 2 (this file): DETERMINISTIC critique. The 4th term reads from
// a static "critique_pass_verdict" that defaults to a candidate's
// existing LLM confidence — no new LLM call, runner ships end-to-end
// today.
//
// Phase 3: replaces rankDeterministic() with rankWithLLMCritique()
// which fires the single batch LLM call described in the spec. The
// public signature stays identical — runner doesn't change.
//
// Why this layering: lets the orchestrator + UI + DB shape land first
// (lowest-risk), so when Phase 3 swaps in the LLM, the only changed
// surface is the scoring function — every other moving part is already
// proven.

import { llmJSON } from "@/lib/llm";
import type {
  SubObjectiveProposal,
  SubObjectiveIntent,
} from "@/lib/objective-canvas/sub-objective-state";
import type { ObjectiveAnnotation } from "@/lib/objective-canvas/generate-annotations";
import type { IntentPreference } from "@/lib/objective-canvas/decision-log";
import type {
  BrainstormCleanup,
  BrainstormRanking,
  BrainstormRankedCandidate,
  BrainstormReasoning,
  BrainstormRibbon,
  BrainstormSubScores,
} from "./session-types";
import { uncoveredLensIndices } from "./plan";

// Weights — must sum to 1.0. Mirror BRAINSTORM_MODULE_SPEC.md §3 Stage 4.
const W_COVERAGE = 0.4;
const W_DIVERSITY = 0.25;
const W_PREFERENCE = 0.2;
const W_CRITIQUE = 0.15;

// Ribbon cuts. Top 3 = green, next 4 = amber, rest = tray. These are
// COUNTS not percentiles so small candidate sets don't degrade — a
// 5-candidate run still gets a clear top 3.
const GREEN_TOP_N = 3;
const AMBER_NEXT_N = 4;

// ── Public input ───────────────────────────────────────────────────

export interface RankInput {
  /** Every candidate produced by the divergence batches (flat). The
   *  intent_of_origin is tracked on each via the runner's session
   *  generations[] before this is called. Critique reads it for
   *  preference scoring. */
  candidates: Array<
    SubObjectiveProposal & { intent_of_origin: SubObjectiveIntent }
  >;
  /** Parent objective annotations — drives coverage scoring. */
  annotations: ObjectiveAnnotation[];
  /** Currently elected proposals (pre-brainstorm). New candidates are
   *  scored on diversity vs. this set + coverage gain vs. this set.
   *  Empty array is fine (first brainstorm of an empty picker). */
  existingElected: SubObjectiveProposal[];
  /** User's per-intent rate from decision_log. */
  userPreferences: IntentPreference[];
  /** Cluster pass result — drives diversity scoring (a candidate that
   *  shares a cluster with an existing elected one is less diverse). */
  cleanup: BrainstormCleanup;
}

// ── Public entry point ─────────────────────────────────────────────

/** Rank all candidates and return the settled ranking ready to write
 *  to session.ranking. Deterministic in Phase 2; LLM-augmented in
 *  Phase 3 by swapping internal computeCritiqueTerm(). Public
 *  signature stable across that swap. */
export function rankDeterministic(input: RankInput): BrainstormRanking {
  const t0 = Date.now();

  const uncoveredVsElected = uncoveredLensIndices(
    input.annotations,
    input.existingElected,
  );
  const uncoveredSet = new Set(uncoveredVsElected);

  // Pre-compute cluster membership: proposal_id -> cluster theme.
  // Lets us check "does this candidate share a cluster with anything
  // currently elected" in O(1) for diversity scoring.
  const clusterByProposal = new Map<string, string>();
  for (const c of input.cleanup.clusters) {
    for (const id of c.proposal_ids) clusterByProposal.set(id, c.theme);
  }
  const electedClusters = new Set<string>();
  for (const p of input.existingElected) {
    const theme = clusterByProposal.get(p.id);
    if (theme) electedClusters.add(theme);
  }
  // For closest_neighbor lookup — by cluster.
  const electedByCluster = new Map<string, SubObjectiveProposal>();
  for (const p of input.existingElected) {
    const theme = clusterByProposal.get(p.id);
    if (theme && !electedByCluster.has(theme))
      electedByCluster.set(theme, p);
  }

  // Per-intent rate lookup.
  const rateByIntent = new Map<SubObjectiveIntent, number>();
  for (const pref of input.userPreferences) {
    if (pref.rate !== null) rateByIntent.set(pref.intent, pref.rate);
  }

  // Duplicate ids → keep best, drop rest from ranking entirely. The
  // cleanup pass already flagged them; we honour that by treating the
  // cluster representative as the survivor.
  const duplicatePartners = new Map<string, string>();
  for (const dup of input.cleanup.duplicates) {
    duplicatePartners.set(dup.a, dup.b);
    duplicatePartners.set(dup.b, dup.a);
  }
  const droppedDuplicates = new Set<string>();
  for (const c of input.cleanup.clusters) {
    for (const id of c.proposal_ids) {
      if (id !== c.representative_id && duplicatePartners.has(id)) {
        droppedDuplicates.add(id);
      }
    }
  }

  const scored: BrainstormRankedCandidate[] = [];
  for (const cand of input.candidates) {
    if (droppedDuplicates.has(cand.id)) continue;

    const subScores = scoreCandidate({
      cand,
      uncoveredSet,
      electedClusters,
      clusterByProposal,
      rateByIntent,
    });

    const closestNeighborId = findClosestNeighbor({
      cand,
      clusterByProposal,
      electedByCluster,
    });

    scored.push({
      proposal_id: cand.id,
      composite_score: composite(subScores),
      sub_scores: subScores,
      ribbon: "tray", // assigned below after sort
      reasoning: writeReasoning({
        cand,
        subScores,
        uncoveredSet,
        closestNeighborId,
      }),
    });
  }

  // Sort + assign ribbons.
  scored.sort((a, b) => b.composite_score - a.composite_score);
  for (let i = 0; i < scored.length; i++) {
    scored[i].ribbon = ribbonForRank(i);
  }

  return {
    candidates: scored,
    ranked_at: new Date().toISOString(),
    latency_ms: Date.now() - t0,
  };
}

// ── Sub-score computation ──────────────────────────────────────────

interface ScoreArgs {
  cand: SubObjectiveProposal & { intent_of_origin: SubObjectiveIntent };
  uncoveredSet: Set<number>;
  electedClusters: Set<string>;
  clusterByProposal: Map<string, string>;
  rateByIntent: Map<SubObjectiveIntent, number>;
}

function scoreCandidate(args: ScoreArgs): BrainstormSubScores {
  return {
    coverage: scoreCoverage(args.cand, args.uncoveredSet),
    diversity: scoreDiversity(args.cand, args.electedClusters, args.clusterByProposal),
    preference: scorePreference(args.cand, args.rateByIntent),
    critique: scoreCritiqueDeterministic(args.cand),
  };
}

/** Coverage gain = (# of uncovered lens phrases this candidate covers) /
 *  max(1, total uncovered). 1.0 means the candidate is hitting every
 *  hole; 0 means it's redundant with existing coverage. */
function scoreCoverage(
  cand: SubObjectiveProposal,
  uncoveredSet: Set<number>,
): number {
  if (uncoveredSet.size === 0) {
    // Lens fully covered already — coverage score is neutral 0.5,
    // not 0 (otherwise gap_fill brainstorms in saturated rooms would
    // always score 0 and gut the ranking).
    return 0.5;
  }
  const cov = cand.lens_coverage ?? [];
  if (cov.length === 0) return 0;
  let hits = 0;
  for (const idx of cov) {
    if (uncoveredSet.has(idx)) hits++;
  }
  return hits / uncoveredSet.size;
}

/** Diversity = 1 if the candidate's cluster doesn't overlap any
 *  elected cluster; falls to 0 when it does. Soft middle when the
 *  cluster pass didn't place the candidate at all (treated as
 *  moderately diverse — no evidence either way). */
function scoreDiversity(
  cand: SubObjectiveProposal,
  electedClusters: Set<string>,
  clusterByProposal: Map<string, string>,
): number {
  const theme = clusterByProposal.get(cand.id);
  if (!theme) return 0.6; // unclustered = mild diversity prior
  return electedClusters.has(theme) ? 0.2 : 1.0;
}

/** Preference fit = the user's historical elect-rate for this
 *  candidate's intent_of_origin. Defaults to 0.5 when the user has no
 *  signal yet (no thumb on the scale either way). */
function scorePreference(
  cand: SubObjectiveProposal & { intent_of_origin: SubObjectiveIntent },
  rateByIntent: Map<SubObjectiveIntent, number>,
): number {
  const rate = rateByIntent.get(cand.intent_of_origin);
  return rate ?? 0.5;
}

/** Phase 2 stub: read the LLM's own confidence as the critique term.
 *  Phase 3 replaces this with a batched critique LLM call. */
function scoreCritiqueDeterministic(cand: SubObjectiveProposal): number {
  const c = cand.confidence;
  if (typeof c !== "number") return 0.5;
  return Math.max(0, Math.min(1, c));
}

function composite(s: BrainstormSubScores): number {
  return (
    W_COVERAGE * s.coverage +
    W_DIVERSITY * s.diversity +
    W_PREFERENCE * s.preference +
    W_CRITIQUE * s.critique
  );
}

// ── Ribbon assignment ──────────────────────────────────────────────

function ribbonForRank(zeroBasedRank: number): BrainstormRibbon {
  if (zeroBasedRank < GREEN_TOP_N) return "green";
  if (zeroBasedRank < GREEN_TOP_N + AMBER_NEXT_N) return "amber";
  return "tray";
}

// ── Reasoning generation (deterministic) ───────────────────────────

interface ReasoningArgs {
  cand: SubObjectiveProposal & { intent_of_origin: SubObjectiveIntent };
  subScores: BrainstormSubScores;
  uncoveredSet: Set<number>;
  closestNeighborId: string | null;
}

/** Deterministic reasoning strings. Phase 3 replaces with LLM-written
 *  prose; this stub still gives the user something to read. Match the
 *  shape Phase 3 will emit so the panel UI doesn't need to change. */
function writeReasoning(args: ReasoningArgs): BrainstormReasoning {
  const { cand, subScores, closestNeighborId } = args;

  // why_strong — pick the dominant sub-score.
  const strongest = pickStrongest(subScores);
  const why_strong = explainStrength(strongest, cand, subScores);

  // where_stretches — pick the WEAKEST sub-score.
  const weakest = pickWeakest(subScores);
  const where_stretches = explainStretch(weakest, cand);

  // whats_missing — if coverage is low + uncovered set has phrases,
  // name them; else fall back to "not yet evaluated for fit".
  const cov = cand.lens_coverage ?? [];
  const stillUncovered = [...args.uncoveredSet].filter(
    (idx) => !cov.includes(idx),
  );
  const whats_missing =
    stillUncovered.length > 0
      ? `Doesn't touch lens reading${stillUncovered.length === 1 ? "" : "s"} ${stillUncovered
          .slice(0, 3)
          .join(", ")}`
      : "Critique pass will refine this when wired (Phase 3).";

  return {
    why_strong,
    where_stretches,
    whats_missing,
    closest_neighbor: closestNeighborId,
  };
}

type SubScoreKey = keyof BrainstormSubScores;

function pickStrongest(s: BrainstormSubScores): SubScoreKey {
  let best: SubScoreKey = "coverage";
  let bestVal = s.coverage;
  (["diversity", "preference", "critique"] as SubScoreKey[]).forEach((k) => {
    if (s[k] > bestVal) {
      best = k;
      bestVal = s[k];
    }
  });
  return best;
}

function pickWeakest(s: BrainstormSubScores): SubScoreKey {
  let worst: SubScoreKey = "coverage";
  let worstVal = s.coverage;
  (["diversity", "preference", "critique"] as SubScoreKey[]).forEach((k) => {
    if (s[k] < worstVal) {
      worst = k;
      worstVal = s[k];
    }
  });
  return worst;
}

function explainStrength(
  k: SubScoreKey,
  cand: SubObjectiveProposal & { intent_of_origin: SubObjectiveIntent },
  s: BrainstormSubScores,
): string {
  if (k === "coverage")
    return `Hits ${Math.round(s.coverage * 100)}% of uncovered lens readings.`;
  if (k === "diversity")
    return `Clusters separately from what you've already elected.`;
  if (k === "preference")
    return `Matches your ${cand.intent_of_origin} pattern (you elect these ${Math.round(
      s.preference * 100,
    )}% of the time).`;
  return `LLM rated this ${Math.round(s.critique * 100)}% confidence.`;
}

function explainStretch(k: SubScoreKey, cand: SubObjectiveProposal): string {
  if (k === "coverage")
    return `Lens coverage is thin — doesn't fill the gaps the runner targeted.`;
  if (k === "diversity")
    return `Overlaps with an already-elected proposal's cluster.`;
  if (k === "preference")
    return `You've historically rejected ideas in this flavour.`;
  // critique
  const conf = typeof cand.confidence === "number" ? cand.confidence : 0.5;
  return `LLM confidence only ${Math.round(conf * 100)}% — generator wasn't sure.`;
}

function findClosestNeighbor(args: {
  cand: SubObjectiveProposal;
  clusterByProposal: Map<string, string>;
  electedByCluster: Map<string, SubObjectiveProposal>;
}): string | null {
  const theme = args.clusterByProposal.get(args.cand.id);
  if (!theme) return null;
  const neighbour = args.electedByCluster.get(theme);
  return neighbour?.id ?? null;
}

// ════════════════════════════════════════════════════════════════════
// PHASE 3 — rankWithLLMCritique
// ════════════════════════════════════════════════════════════════════
//
// Same signature as rankDeterministic(). Computes coverage / diversity /
// preference exactly the same way (these are programmatic, not LLM-fit
// problems). Only the CRITIQUE term + reasoning are LLM-driven:
//
//   - Critique score (0..1): "Is this load-bearing, specific, actionable
//     for the parent objective?"
//   - Reasoning (4 strings): per-candidate prose — why_strong, where it
//     stretches, what's missing, closest neighbour in the elected set
//
// One BATCH call across all candidates. The deterministic-ranking
// signature is preserved so the runner just swaps the call site.
//
// Graceful degradation: if the LLM call fails, we fall back to
// rankDeterministic() with a log warning. The pipeline still settles.

interface LLMCritiqueItem {
  proposal_id: string;
  critique_score: number;
  why_strong: string;
  where_stretches: string;
  whats_missing: string;
  closest_neighbor_id: string | null;
}

interface LLMCritiqueResponse {
  critiques: LLMCritiqueItem[];
}

const LLM_CRITIQUE_SCHEMA = {
  name: "brainstorm_critique",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["critiques"],
    properties: {
      critiques: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "proposal_id",
            "critique_score",
            "why_strong",
            "where_stretches",
            "whats_missing",
            "closest_neighbor_id",
          ],
          properties: {
            proposal_id: { type: "string" },
            critique_score: { type: "number" },
            why_strong: { type: "string", maxLength: 220 },
            where_stretches: { type: "string", maxLength: 220 },
            whats_missing: { type: "string", maxLength: 220 },
            closest_neighbor_id: { type: ["string", "null"] },
          },
        },
      },
    },
  },
};

function buildCritiqueSystemPrompt(): string {
  return [
    "You are evaluating brainstormed sub-objective candidates for an Objective Canvas.",
    "Each candidate is a proposed sub-goal that decomposes the user's parent objective.",
    "",
    "Your job: for EACH candidate, return:",
    "  • critique_score (0..1) — how load-bearing + specific + actionable is this for the parent?",
    "    - 0.0-0.3 = vague, low-stakes, or already covered by existing elections",
    "    - 0.4-0.6 = plausible but unspecific or low-leverage",
    "    - 0.7-0.9 = sharp, distinct, addresses real gaps",
    "    - 1.0 = exceptional load-bearing pick that cleanly closes a gap",
    "  • why_strong  (1 sentence ≤ 200 chars) — the single most compelling reason it scores where it does",
    "  • where_stretches (1 sentence ≤ 200 chars) — the honest weakness or stretch in this candidate",
    "  • whats_missing (1 sentence ≤ 200 chars) — what context, evidence, or follow-on this needs to be acted on",
    "  • closest_neighbor_id (proposal_id from EXISTING ELECTED list, or null)",
    "    — which existing elected proposal is this closest to in scope? Helps the user spot near-duplicates of work they've already chosen.",
    "",
    "Rules:",
    "  • Score on FIT to the parent objective + DISTINCTNESS from existing elections, NOT on raw cleverness.",
    "  • Be honest about stretches — a tepid 'this could work' for a weak candidate is worse than 'this overlaps the X election'.",
    "  • You receive lens readings (extracted concepts from the parent objective) — candidates that touch UNCOVERED lens readings are more load-bearing.",
    "  • Cluster membership is given — if a candidate shares a cluster with an elected proposal, that's redundancy, not diversity.",
    "  • Return EXACTLY one critique per input candidate. Match proposal_id verbatim.",
    "",
    "Return JSON conforming to the provided schema.",
  ].join("\n");
}

function buildCritiqueUserPrompt(args: {
  objectiveText: string;
  annotations: ObjectiveAnnotation[];
  existingElected: SubObjectiveProposal[];
  candidates: Array<
    SubObjectiveProposal & { intent_of_origin: SubObjectiveIntent }
  >;
  clusterByProposal: Map<string, string>;
  uncoveredSet: Set<number>;
}): string {
  const lines: string[] = [];

  lines.push("# PARENT OBJECTIVE");
  lines.push(args.objectiveText || "(empty)");
  lines.push("");

  if (args.annotations.length > 0) {
    lines.push("# LENS READINGS (numbered; uncovered ones flagged)");
    const top = [...args.annotations]
      .sort((a, b) => (b.weight ?? 0.5) - (a.weight ?? 0.5))
      .slice(0, 8);
    top.forEach((a, i) => {
      const idx = i + 1;
      const tag = args.uncoveredSet.has(idx) ? " [UNCOVERED]" : "";
      lines.push(`  ${idx}.${tag} "${a.phrase}"${a.reading ? ` — ${a.reading}` : ""}`);
    });
    lines.push("");
  }

  if (args.existingElected.length > 0) {
    lines.push("# EXISTING ELECTED (the bar to beat; reference for closest_neighbor_id)");
    args.existingElected.forEach((p) => {
      lines.push(`  - [id=${p.id}] ${p.title}`);
      if (p.summary) lines.push(`      ${p.summary}`);
    });
    lines.push("");
  } else {
    lines.push("# EXISTING ELECTED");
    lines.push("  (none — this is the first wave; closest_neighbor_id can be null for all)");
    lines.push("");
  }

  lines.push("# NEW CANDIDATES TO CRITIQUE");
  args.candidates.forEach((c) => {
    const cluster = args.clusterByProposal.get(c.id);
    const coverage = Array.isArray(c.lens_coverage) ? c.lens_coverage : [];
    const coverageStr =
      coverage.length > 0 ? ` · lens=[${coverage.join(",")}]` : "";
    const clusterStr = cluster ? ` · cluster="${cluster}"` : "";
    lines.push(
      `  - [id=${c.id}] intent=${c.intent_of_origin}${coverageStr}${clusterStr}`,
    );
    lines.push(`      title: ${c.title}`);
    if (c.summary) lines.push(`      summary: ${c.summary}`);
  });

  return lines.join("\n");
}

export interface RankWithLLMArgs extends RankInput {
  /** Parent objective text (improvement_goals[root].description). The
   *  LLM prompt grounds its critique in this. Empty → call still runs
   *  but the LLM is told "no objective text given". */
  objectiveText: string;
  /** Override the LLM model. Defaults to llmJSON's default. */
  model?: string;
}

/** Phase 3 entry point — same return shape as rankDeterministic, but
 *  the critique sub-score + reasoning come from a single batch LLM call.
 *  Coverage, diversity, and preference scoring stay deterministic.
 *
 *  Soft-fails to rankDeterministic on any error so the pipeline never
 *  blocks on a flaky LLM call. */
export async function rankWithLLMCritique(
  input: RankWithLLMArgs,
): Promise<BrainstormRanking> {
  const t0 = Date.now();

  // Build cluster + uncovered context shared with deterministic path.
  const uncoveredSet = new Set(
    uncoveredLensIndices(input.annotations, input.existingElected),
  );
  const clusterByProposal = new Map<string, string>();
  for (const c of input.cleanup.clusters) {
    for (const id of c.proposal_ids) clusterByProposal.set(id, c.theme);
  }

  // Drop duplicates upfront — same logic as deterministic. Reduces LLM
  // token spend by not asking it to critique near-identical pairs.
  const duplicatePartners = new Map<string, string>();
  for (const dup of input.cleanup.duplicates) {
    duplicatePartners.set(dup.a, dup.b);
    duplicatePartners.set(dup.b, dup.a);
  }
  const droppedDuplicates = new Set<string>();
  for (const c of input.cleanup.clusters) {
    for (const id of c.proposal_ids) {
      if (id !== c.representative_id && duplicatePartners.has(id)) {
        droppedDuplicates.add(id);
      }
    }
  }
  const liveCandidates = input.candidates.filter(
    (c) => !droppedDuplicates.has(c.id),
  );

  // ── LLM call ──
  let llmCritiques: LLMCritiqueItem[] = [];
  try {
    const raw = await llmJSON<LLMCritiqueResponse>({
      system: buildCritiqueSystemPrompt(),
      user: buildCritiqueUserPrompt({
        objectiveText: input.objectiveText,
        annotations: input.annotations,
        existingElected: input.existingElected,
        candidates: liveCandidates,
        clusterByProposal,
        uncoveredSet,
      }),
      responseSchema: LLM_CRITIQUE_SCHEMA,
      temperature: 0.35,
      maxTokens: 3200,
      model: input.model,
    });
    llmCritiques = Array.isArray(raw?.critiques) ? raw.critiques : [];
  } catch (err) {
    console.warn(
      "[brainstorm/critique] LLM critique failed — falling back to deterministic:",
      err instanceof Error ? err.message : String(err),
    );
    return rankDeterministic(input);
  }

  // Index critique results by proposal_id for O(1) merge.
  const critiqueById = new Map<string, LLMCritiqueItem>();
  for (const c of llmCritiques) {
    if (typeof c?.proposal_id === "string") critiqueById.set(c.proposal_id, c);
  }

  // ── Merge: re-run deterministic for coverage/diversity/preference,
  //    then swap critique sub-score + reasoning where LLM responded. ──
  const baseline = rankDeterministic(input);
  const merged: BrainstormRankedCandidate[] = baseline.candidates.map((cand) => {
    const llm = critiqueById.get(cand.proposal_id);
    if (!llm) return cand; // LLM didn't return this one → keep deterministic

    const critique = clampScore(llm.critique_score);
    const subScores: BrainstormSubScores = {
      ...cand.sub_scores,
      critique,
    };
    const composite_score =
      W_COVERAGE * subScores.coverage +
      W_DIVERSITY * subScores.diversity +
      W_PREFERENCE * subScores.preference +
      W_CRITIQUE * subScores.critique;

    const reasoning: BrainstormReasoning = {
      why_strong: trimText(llm.why_strong, cand.reasoning.why_strong),
      where_stretches: trimText(
        llm.where_stretches,
        cand.reasoning.where_stretches,
      ),
      whats_missing: trimText(llm.whats_missing, cand.reasoning.whats_missing),
      closest_neighbor: llm.closest_neighbor_id || cand.reasoning.closest_neighbor,
    };

    return {
      ...cand,
      composite_score,
      sub_scores: subScores,
      reasoning,
    };
  });

  // Re-sort + reassign ribbons after critique-induced score changes.
  merged.sort((a, b) => b.composite_score - a.composite_score);
  for (let i = 0; i < merged.length; i++) {
    merged[i].ribbon = ribbonForRank(i);
  }

  return {
    candidates: merged,
    ranked_at: new Date().toISOString(),
    latency_ms: Date.now() - t0,
  };
}

function clampScore(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function trimText(candidate: unknown, fallback: string): string {
  if (typeof candidate !== "string") return fallback;
  const t = candidate.trim();
  if (t.length === 0) return fallback;
  return t.length > 220 ? `${t.slice(0, 217)}…` : t;
}

// ════════════════════════════════════════════════════════════════════
// END PHASE 3
// ════════════════════════════════════════════════════════════════════

// ── Outcome summary (for library row) ──────────────────────────────

/** Human-readable summary for the brainstorm_sessions.outcome_summary
 *  column. Surfaces in the library lens. */
export function summariseRanking(ranking: BrainstormRanking): string {
  const n = ranking.candidates.length;
  let nGreen = 0;
  let nAmber = 0;
  for (const c of ranking.candidates) {
    if (c.ribbon === "green") nGreen++;
    else if (c.ribbon === "amber") nAmber++;
  }
  return `${n} candidate${n === 1 ? "" : "s"} ranked · ${nGreen} ready · ${nAmber} explore`;
}
