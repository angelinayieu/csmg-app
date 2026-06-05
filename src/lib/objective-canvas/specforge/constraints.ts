// ── SpecForge · Constraint Accumulation System ─────────────────────
//
// Per specforge_constraint_accumulation_system.md: a cross-cutting accumulator,
// NOT a new LLM engine. It walks each engine result as it returns, extracts
// structured constraints (target-user, problem-cause, desired-result, etc.),
// threads a compact constraint strip into downstream prompts so Evaluation +
// Recommendation see them, and surfaces ONE final "Constraints" card right
// before the Quality Gate.
//
// Deterministic by design — same architectural pattern as depth-selection.ts
// and quality-critic.ts: no LLM call, no cost, no clash with the Evaluation
// engine's narrowing role. The spec's §9/§19 "constraints become evaluation
// criteria" loop is closed by the Evaluation prompt explicitly consuming the
// threaded "Active constraints" block.

import type {
  SpecForgeCard,
  SpecForgeEngineId,
  PowerUpResult,
  TargetUserResult,
  ProblemTreeResult,
  DesiredResultResult,
  CrossAnalysisResult,
  ConvergenceResult,
  DifferentiationResult,
  SolutionFamiliesResult,
  MvpVariationsResult,
  EvaluationResult,
  RecommendationResult,
  FeatureCardsResult,
  FeatureCard,
  FeatureMechanismsResult,
  FeatureMechanism,
  DataPointsResult,
  DataPoint,
  ValidationResult,
  ValidationExperiment,
} from "./types";

/** Constraint priority — drives narrowing strictness. */
export type ConstraintPriority = "critical" | "high" | "medium" | "low";

/** Constraint type — keyed to §4 of the constraint accumulation spec. */
export type ConstraintType =
  | "macro"
  | "target_user"
  | "problem_cause"
  | "desired_result"
  | "differentiation"
  | "buildability"
  | "mechanism"
  | "evaluation"
  | "evidence";

/** Trimmed Constraint object — §6 schema, kept to fields we actually use.
 *  No id/timestamps/status fields because we re-derive constraints on every
 *  run (deterministic). When persistence lands, those fields get added. */
export interface Constraint {
  type: ConstraintType;
  priority: ConstraintPriority;
  /** The constraint itself, as a single declarative sentence. */
  text: string;
  /** Engine id that this constraint was derived from (provenance). */
  source: SpecForgeEngineId;
  /** Why the constraint matters — short phrase, optional. */
  why?: string;
}

const clean = (s: unknown): string =>
  typeof s === "string" ? s.trim() : "";

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Tight ceiling per engine so the strip stays compact even on noisy outputs. */
const PER_ENGINE_CAP = 4;

/** Extract constraints from one engine result. Deterministic — only reads
 *  fields the type already promises. Returns [] for engines that don't add
 *  constraints (solution_families is generator-only). */
export function extractConstraintsFromEngineResult(
  engineId: SpecForgeEngineId,
  result: unknown,
): Constraint[] {
  if (!result || typeof result !== "object") return [];
  const out: Constraint[] = [];
  const push = (c: Omit<Constraint, "source"> & { source?: SpecForgeEngineId }) => {
    if (!clean(c.text)) return;
    if (out.length >= PER_ENGINE_CAP) return;
    out.push({ ...c, source: c.source ?? engineId, text: clean(c.text) });
  };

  switch (engineId) {
    case "power_up": {
      const r = result as PowerUpResult;
      const intent = clean(r.root_intent);
      if (intent) {
        push({
          type: "macro",
          priority: "critical",
          text: `Must serve the root intent: ${intent}`,
          why: "macro mission — every downstream choice must serve this",
        });
      }
      const desired = clean(r.desired_result_guess);
      if (desired) {
        push({
          type: "desired_result",
          priority: "high",
          text: `Must enable: ${desired}`,
          why: "the user-facing outcome we promised at intake",
        });
      }
      return out;
    }

    case "target_user": {
      const r = result as TargetUserResult;
      const segment = clean(r.primary_segment);
      const need = clean(r.core_need);
      if (segment && need) {
        push({
          type: "target_user",
          priority: "critical",
          text: `Must fit ${segment} addressing: ${need}`,
          why: "wrong-user fit is the most common SpecForge failure mode",
        });
      }
      for (const c of arr<string>(r.constraints).slice(0, 2)) {
        const txt = clean(c);
        if (txt) {
          push({
            type: "target_user",
            priority: "high",
            text: txt,
            why: "explicit user constraint surfaced by the user model",
          });
        }
      }
      return out;
    }

    case "problem_tree": {
      const r = result as ProblemTreeResult;
      const root =
        clean(r.root_constraint_tournament?.selected_root_constraint) ||
        clean(r.root_constraint);
      if (root) {
        push({
          type: "problem_cause",
          priority: "critical",
          text: `Must attack the root constraint: ${root}`,
          why: "guide §4.3 — solutions that don't attack root cause cannot win",
        });
      }
      const fpn = clean(r.first_principles_need?.selected);
      if (fpn) {
        push({
          type: "problem_cause",
          priority: "high",
          text: `Must satisfy the first-principles need: ${fpn}`,
          why: "what the user fundamentally needs from the system",
        });
      }
      for (const sc of arr<string>(r.solution_constraints).slice(0, 1)) {
        const txt = clean(sc);
        if (txt) push({ type: "problem_cause", priority: "high", text: txt });
      }
      return out;
    }

    case "desired_result": {
      const r = result as DesiredResultResult;
      const fr = clean(r.functional_result);
      if (fr) {
        push({
          type: "desired_result",
          priority: "critical",
          text: `Must produce the functional result: ${fr}`,
          why: "the concrete artifact the user walks away with",
        });
      }
      const dr = clean(r.decision_result);
      if (dr) {
        push({
          type: "desired_result",
          priority: "high",
          text: `Must enable the decision: ${dr}`,
          why: "the decision-making capability we're unlocking",
        });
      }
      for (const fc of arr<string>(r.failure_conditions).slice(0, 1)) {
        const txt = clean(fc);
        if (txt) {
          push({
            type: "desired_result",
            priority: "high",
            text: `Must avoid failure mode: ${txt}`,
            why: "explicit failure condition from desired-result layer",
          });
        }
      }
      return out;
    }

    case "cross_analysis": {
      const r = result as CrossAnalysisResult;
      for (const wl of arr<string>(r.weak_links).slice(0, 1)) {
        const txt = clean(wl);
        if (txt) {
          push({
            type: "mechanism",
            priority: "high",
            text: `Must strengthen the weak link: ${txt}`,
            why: "weakest cross-model relationship — repairs the chain",
          });
        }
      }
      const blockage = arr<{ cause?: string; blocks_result?: string }>(
        r.cause_result_blockages,
      ).find((b) => clean(b.cause) && clean(b.blocks_result));
      if (blockage) {
        push({
          type: "problem_cause",
          priority: "high",
          text: `Must clear the blockage: "${clean(blockage.cause)}" blocks "${clean(
            blockage.blocks_result,
          )}"`,
          why: "without clearing this cause→result blockage, the result is unreachable",
        });
      }
      return out;
    }

    case "convergence": {
      const r = result as ConvergenceResult;
      const root = clean(r.root_constraint);
      if (root) {
        push({
          type: "problem_cause",
          priority: "critical",
          text: `Convergence-confirmed root constraint: ${root}`,
          why: "convergence cross-validated this against user × problem × result",
        });
      }
      const intervention = clean(r.highest_leverage_intervention);
      if (intervention) {
        push({
          type: "mechanism",
          priority: "high",
          text: `Should leverage: ${intervention}`,
          why: "highest-leverage point identified by convergence",
        });
      }
      for (const rule of arr<string>(r.what_this_rules_out).slice(0, 2)) {
        const txt = clean(rule);
        if (txt) {
          push({
            type: "evaluation",
            priority: "high",
            text: `Must rule out: ${txt}`,
            why: "convergence explicitly ruled this class of solution out",
          });
        }
      }
      return out;
    }

    case "differentiation": {
      const r = result as DifferentiationResult;
      const advantage = clean(r.proposed_product_advantage);
      if (advantage) {
        push({
          type: "differentiation",
          priority: "critical",
          text: `Must be meaningfully better than alternatives via: ${advantage}`,
          why: "without differentiation, the product is dominated by existing options",
        });
      }
      const deeper = clean(r.deeper_problem_not_solved);
      if (deeper) {
        push({
          type: "differentiation",
          priority: "high",
          text: `Must solve the deeper problem alternatives miss: ${deeper}`,
          why: "the gap that justifies the build",
        });
      }
      return out;
    }

    case "mvp_variations": {
      const r = result as MvpVariationsResult;
      // Buildability discipline — derived from the most-buildable candidate's
      // "simplest_version", which is the spec's lower bound for v1 scope.
      const easiest = arr<{
        simplest_version?: string;
        build_difficulty?: string;
      }>(r.mvp_variations).find(
        (m) => clean(m.simplest_version) && /low|small|easy/i.test(clean(m.build_difficulty)),
      );
      if (easiest && clean(easiest.simplest_version)) {
        push({
          type: "buildability",
          priority: "high",
          text: `v1 must stay buildable — proven lower bound: ${clean(easiest.simplest_version)}`,
          why: "guide §22 — start with the buildable lower bound, not the full spec",
        });
      }
      return out;
    }

    case "evaluation": {
      const r = result as EvaluationResult;
      for (const c of arr<string>(r.constraints_passed_downstream).slice(0, 2)) {
        const txt = clean(c);
        if (txt) {
          push({
            type: "evaluation",
            priority: "critical",
            text: txt,
            why: "evaluation explicitly enforced this on the recommendation",
          });
        }
      }
      for (const a of arr<string>(r.assumptions_that_could_reverse_decision).slice(0, 1)) {
        const txt = clean(a);
        if (txt) {
          push({
            type: "evidence",
            priority: "high",
            text: `Decision is conditional on: ${txt}`,
            why: "if this assumption fails, the rubric winner flips",
          });
        }
      }
      return out;
    }

    case "feature_cards": {
      const r = result as FeatureCardsResult;
      const features = arr<FeatureCard>(r.features);
      // Must-have features become BUILDABILITY constraints — the spec
      // can't ship without them. Cap at 3 so the strip stays compact.
      const mustHave = features
        .filter((f) => String(f?.build_priority) === "must_have")
        .slice(0, 3);
      for (const f of mustHave) {
        const name = clean(f?.name);
        const micro = clean(f?.micro_objective);
        if (name) {
          push({
            type: "buildability",
            priority: "critical",
            text: `Must include feature: ${name}`,
            why: micro || "named as must_have by the Feature Card System",
          });
        }
      }
      // Each must-have feature's evaluation metric becomes an EVALUATION
      // constraint — gives Validation Lab + downstream spec something concrete.
      for (const f of mustHave) {
        const name = clean(f?.name);
        const metric = clean(f?.evaluation_metric);
        if (name && metric) {
          push({
            type: "evaluation",
            priority: "high",
            text: `Must measure: ${metric} (for feature ${name})`,
            why: "feature card's own success metric",
          });
        }
      }
      return out;
    }

    case "feature_mechanisms": {
      const r = result as FeatureMechanismsResult;
      // Each mechanism with a real input → process → output is a MECHANISM
      // constraint on the build. Top 3 surface so the spec doesn't get drowned.
      const mechs = arr<FeatureMechanism>(r.mechanisms).slice(0, 3);
      for (const m of mechs) {
        const name = clean(m?.mechanism_name);
        const feature = clean(m?.feature_name);
        const trigger = clean(m?.trigger);
        if (name && feature) {
          push({
            type: "mechanism",
            priority: "high",
            text: `Build must implement: ${name} (for ${feature})`,
            why: trigger
              ? `triggered by: ${trigger}`
              : "selected mechanism for this feature",
          });
        }
        // Top failure mode → evidence constraint (must validate it doesn't happen)
        const topFailure = arr<string>(m?.failure_modes).map(clean).filter(Boolean)[0];
        if (topFailure && name) {
          push({
            type: "evidence",
            priority: "medium",
            text: `Must validate against: ${topFailure}`,
            why: `top failure mode for ${name}`,
          });
        }
        // The mechanism's own constraints_satisfied carry forward unchanged
        for (const c of arr<string>(m?.constraints_satisfied).slice(0, 2)) {
          const txt = clean(c);
          if (txt) {
            push({
              type: "mechanism",
              priority: "medium",
              text: txt,
              why: `referenced by mechanism ${name || "(unnamed)"}`,
            });
          }
        }
      }
      // Cross-mechanism dependencies become buildability constraints (sequence
      // matters when shipping).
      for (const dep of arr<string>(r.cross_mechanism_dependencies).slice(0, 2)) {
        const txt = clean(dep);
        if (txt) {
          push({
            type: "buildability",
            priority: "medium",
            text: `Build sequencing: ${txt}`,
            why: "cross-mechanism dependency surfaced by the mechanism generator",
          });
        }
      }
      return out;
    }

    case "data_points": {
      const r = result as DataPointsResult;
      const pts = arr<DataPoint>(r.data_points).filter(
        (p) => p && clean(p?.name) && String(p?.disposition) !== "removed",
      );
      // Each data point's own constraints_created — these are explicit (the
      // engine already named them). Cap at top 4 to keep the strip readable.
      const explicit = pts
        .flatMap((p) =>
          arr<string>(p?.constraints_created)
            .map(clean)
            .filter(Boolean)
            .map((text) => ({
              type: "mechanism" as const,
              priority: "high" as const,
              text,
              why: `data point ${clean(p?.name)} requires it`,
            })),
        )
        .slice(0, 4);
      for (const c of explicit) push(c);
      // Privacy-sensitive data points → critical privacy constraint (one per).
      const sensitive = pts.filter((p) => String(p?.privacy_risk) === "high");
      for (const p of sensitive.slice(0, 2)) {
        push({
          type: "buildability",
          priority: "critical",
          text: `Privacy-sensitive: ${clean(p?.name)} must have consent + minimization`,
          why: `data point flagged privacy_risk=high (concept: ${clean(p?.concept_definition)})`,
        });
      }
      // High-friction REQUIRED data → buildability constraint (forces UX care).
      const requiredHighFriction = pts.filter(
        (p) =>
          String(p?.disposition) === "required" &&
          String(p?.collection_friction) === "high",
      );
      for (const p of requiredHighFriction.slice(0, 2)) {
        push({
          type: "buildability",
          priority: "high",
          text: `High-friction required input: ${clean(p?.name)} needs onboarding/proxy fallback`,
          why: "collection_friction=high on a required field — UX must justify the ask",
        });
      }
      return out;
    }

    case "validation": {
      const r = result as ValidationResult;
      // Each top-ranked experiment imposes an EVIDENCE constraint: the build
      // can't ship unprovably-wrong on its assumption. Top 2 by priority_rank,
      // skipping any without a tested assumption (would be theatrical anyway).
      const ranked = arr<ValidationExperiment>(r.experiments)
        .slice()
        .sort(
          (a, b) =>
            (Number(a?.priority_rank) || 99) -
            (Number(b?.priority_rank) || 99),
        );
      for (const e of ranked.slice(0, 2)) {
        const assumption = clean(e?.assumption_tested);
        const decision = clean(e?.decision_that_result_will_change);
        if (assumption) {
          push({
            type: "evidence",
            priority: "high",
            text: `Must validate: ${assumption}`,
            why: decision
              ? `result will change: ${decision}`
              : "named as a top experiment by the Validation Lab",
          });
        }
      }
      return out;
    }

    case "solution_families":
    case "question_expansion":
    case "recommendation":
    case "deepening":
    case "spec_export":
      // Generator-only / advisory / final selector / meta-summary /
      // terminal-synthesizer — they consume constraints (or describe the
      // run); they don't create new ones the spec recognizes. The spec
      // exporter restates upstream constraints in causal_trace +
      // first_build_scope but adds nothing new to the accumulator.
      return out;
  }
}

/** Dedupe by (type, text-normalized). Keeps the FIRST occurrence (earlier
 *  engines have priority — constraints accumulate, not overwrite). */
export function dedupeConstraints(constraints: Constraint[]): Constraint[] {
  const seen = new Set<string>();
  const out: Constraint[] = [];
  for (const c of constraints) {
    const key = `${c.type}|${c.text.toLowerCase().replace(/\s+/g, " ").trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

const PRIORITY_RANK: Record<ConstraintPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Compact text block prepended to the downstream engine context. Surfaces
 *  CRITICAL + HIGH constraints; Evaluation/Recommendation prompts are tuned
 *  to consume this block. Cap at ~14 lines so it stays in token budget even
 *  on a deep run. */
export function summarizeConstraintsForContext(
  constraints: Constraint[],
): string {
  if (!constraints.length) return "";
  const sorted = [...constraints].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
  );
  const lines: string[] = ["Active constraints (must be satisfied or explicitly traded off):"];
  const top = sorted.filter((c) => c.priority === "critical" || c.priority === "high").slice(0, 12);
  for (const c of top) {
    lines.push(`- [${c.priority}] (${c.type}) ${c.text}`);
  }
  return lines.join("\n");
}

/** Soft alignment check: does the recommendation text reference each CRITICAL
 *  constraint? Deterministic keyword check — flags unverified, not violated.
 *  Returns one row per critical constraint with status. */
export interface ConstraintAlignment {
  constraint: Constraint;
  status: "verified" | "unverified";
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4),
  );
}

/** A constraint is "verified" by the recommendation if the recommendation
 *  text mentions at least 2 distinct content tokens from the constraint
 *  (>=4 chars, ignoring common boilerplate). Conservative on purpose —
 *  false positives matter more than false negatives here. */
export function checkConstraintAlignment(
  constraints: Constraint[],
  recommendation: RecommendationResult | null,
): ConstraintAlignment[] {
  if (!recommendation) return [];
  const recText = [
    clean(recommendation.recommendation),
    clean(recommendation.why_this_won),
    arr<string>(recommendation.why_others_lost).map(clean).join(" "),
  ]
    .filter(Boolean)
    .join(" ");
  const recTokens = tokens(recText);
  const BOILERPLATE = new Set([
    "must",
    "should",
    "would",
    "could",
    "this",
    "that",
    "with",
    "from",
    "into",
    "have",
    "user",
    "users",
    "product",
    "build",
    "build:",
    "first",
    "make",
    "create",
    "system",
  ]);
  return constraints
    .filter((c) => c.priority === "critical")
    .map((c) => {
      const cTokens = Array.from(tokens(c.text)).filter((t) => !BOILERPLATE.has(t));
      if (!cTokens.length) {
        return { constraint: c, status: "verified" as const };
      }
      const hits = cTokens.filter((t) => recTokens.has(t)).length;
      return {
        constraint: c,
        status: hits >= 2 ? ("verified" as const) : ("unverified" as const),
      };
    });
}

/** Final "Constraints" card dropped before the Quality Gate. Surfaces the
 *  accumulated constraint set, the criticals, and the alignment check
 *  against the recommendation (if produced). Returns null if nothing was
 *  accumulated (chain hit nothing but power_up). */
export function constraintAccumulationToCard(
  constraints: Constraint[],
  recommendation: RecommendationResult | null,
): SpecForgeCard | null {
  if (!constraints.length) return null;
  const deduped = dedupeConstraints(constraints);

  const counts: Record<ConstraintPriority, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const c of deduped) counts[c.priority]++;

  const alignment = checkConstraintAlignment(deduped, recommendation);
  const verified = alignment.filter((a) => a.status === "verified").length;
  const unverified = alignment.filter((a) => a.status === "unverified");

  const critical = deduped.filter((c) => c.priority === "critical").slice(0, 4);
  const high = deduped
    .filter((c) => c.priority === "high")
    .slice(0, 3 - Math.min(1, unverified.length));

  const lines: string[] = [];
  for (const c of critical) {
    lines.push(`Critical · ${c.type.replace("_", " ")}: ${c.text}`);
  }
  for (const c of high) {
    lines.push(`High · ${c.type.replace("_", " ")}: ${c.text}`);
  }
  if (unverified.length > 0) {
    lines.push(
      `⚠ ${unverified.length} critical constraint${
        unverified.length > 1 ? "s" : ""
      } not clearly cited by the recommendation — consider revisiting why-this-won.`,
    );
  }

  const subtitle = recommendation
    ? `${counts.critical} critical · ${counts.high} high · ${verified}/${alignment.length} criticals verified in the recommendation`
    : `${counts.critical} critical · ${counts.high} high · ${counts.medium + counts.low} other`;

  return {
    stage: "constraints",
    eyebrow: "Constraint accumulation",
    title: `${deduped.length} active constraint${deduped.length === 1 ? "" : "s"} accumulated`,
    subtitle,
    body: lines.slice(0, 6).join("\n"),
    layout: "spine",
  };
}
