// ── PATCH /api/brainstorm/item/variation/prototype/status ─────────
//
// Updates a single prototype brief's lifecycle state. Optional
// result_summary captured when status="concluded".
//
// Body: { entityId, briefId, status, result_summary? }
//   status ∈ "planned" | "running" | "concluded" | "abandoned" | null
//   result_summary — optional, only meaningful with concluded

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import type { ExpandedItemDetail } from "@/lib/objective-canvas/expand-item-detail";
import { logDecision } from "@/lib/objective-canvas/decision-log";
import {
  extractEmpiricalResults,
  type EmpiricalIndicatorResult,
} from "@/lib/objective-canvas/extract-empirical-results";

export const runtime = "nodejs";

type ExperimentStatus =
  | "planned"
  | "running"
  | "concluded"
  | "abandoned"
  | null;

interface Body {
  entityId?: string;
  briefId?: string;
  status?: ExperimentStatus;
  result_summary?: string;
}

const ALLOWED: ReadonlyArray<ExperimentStatus> = [
  "planned",
  "running",
  "concluded",
  "abandoned",
  null,
];

export async function PATCH(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const entityId = typeof body?.entityId === "string" ? body.entityId : "";
  const briefId = typeof body?.briefId === "string" ? body.briefId : "";
  if (!entityId || !briefId) {
    return NextResponse.json(
      { error: "entityId + briefId required" },
      { status: 400 },
    );
  }
  const status: ExperimentStatus =
    body?.status === null || ALLOWED.includes(body?.status ?? null)
      ? (body?.status ?? null)
      : null;
  const resultSummary =
    typeof body?.result_summary === "string"
      ? body.result_summary.trim().slice(0, 1200)
      : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  const { data: entity } = await db
    .from("entities")
    .select("id, space_id, parent_sub_objective_id, name, expanded_detail")
    .eq("id", entityId)
    .maybeSingle();
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }

  const { data: ownerRow } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!ownerRow || ownerRow.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const detail = entity.expanded_detail as ExpandedItemDetail | null;
  if (!detail || !Array.isArray(detail.prototype_briefs)) {
    return NextResponse.json(
      { error: "no prototype_briefs on this entity" },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  let found = false;
  let priorStatus: ExperimentStatus = null;
  let variationId: string | null = null;
  let openQuestion: string | null = null;
  const nextBriefs = detail.prototype_briefs.map((b) => {
    if (b.id !== briefId) return b;
    found = true;
    priorStatus = (b.status ?? null) as ExperimentStatus;
    variationId = typeof b.variation_id === "string" ? b.variation_id : null;
    openQuestion =
      typeof b.open_question === "string" ? b.open_question : null;
    return {
      ...b,
      status,
      status_updated_at: now,
      // Only persist result_summary when status=concluded AND text
      // was provided. Empty string clears any prior summary.
      ...(status === "concluded" && resultSummary !== null
        ? { result_summary: resultSummary }
        : {}),
    };
  });
  if (!found) {
    return NextResponse.json({ error: "brief not found" }, { status: 404 });
  }

  // ── Phase 11.7 — Tested tier: empirical extraction on conclusion ──
  // When the brief is moving to concluded AND carries a non-empty
  // result_summary AND the variation it belongs to has indicator_scores
  // (Phase 11.2+ ensemble/rubric output), fire the extractor to map
  // free-text results to structured per-indicator empirical signals.
  //
  // Result: each touched indicator gets an empirical_overlay that
  // dominates the score's visual hierarchy in the UI (🧪 tier chip).
  // Multiple concluded briefs touching the same indicator AGGREGATE:
  //   - observed_lift_pct: weighted mean by methodology_rigor
  //   - methodology_rigor: max (one rigorous test outweighs anecdotes)
  //   - sample_size_total: sum across briefs
  //   - n_briefs: count of contributing briefs
  // Soft-fail throughout — extraction issues don't block the status
  // PATCH itself; the brief still persists.
  let empiricalResults: EmpiricalIndicatorResult[] = [];
  let variationsWithEmpirical = detail.variations;
  if (
    status === "concluded" &&
    resultSummary &&
    resultSummary.length > 0 &&
    variationId &&
    Array.isArray(detail.variations) &&
    detail.variations.length > 0
  ) {
    // Capture variationId in a const so TS narrows it cleanly inside
    // the .find() callback below (the outer `let` would widen back).
    const targetVariationId: string = variationId;
    const matchingVariation = detail.variations.find(
      (v) => v.id === targetVariationId,
    );
    if (
      matchingVariation &&
      Array.isArray(matchingVariation.indicator_scores) &&
      matchingVariation.indicator_scores.length > 0
    ) {
      const indicatorsForExtraction = matchingVariation.indicator_scores.map(
        (ind) => ({
          indicator_text: ind.indicator_text,
          outcome_id: ind.outcome_id,
          outcome_name: ind.outcome_name,
        }),
      );
      try {
        const envelope = await extractEmpiricalResults({
          result_summary: resultSummary,
          variation_name: matchingVariation.name,
          variation_description: matchingVariation.description,
          indicators: indicatorsForExtraction,
          open_question: openQuestion ?? undefined,
        });
        if (envelope.status === "ok") {
          empiricalResults = envelope.results;
        }
      } catch (extractErr) {
        console.warn(
          "[item/variation/prototype/status] empirical extraction failed (non-fatal):",
          extractErr instanceof Error
            ? extractErr.message
            : String(extractErr),
        );
      }

      // Merge empirical results into the variation's indicator_scores.
      // For each indicator that the extractor produced a row for, we
      // AGGREGATE with any prior empirical_overlay (rigor-weighted
      // mean for lift; max for rigor; sum for sample size; +1 to
      // n_briefs; keep the rationale from the higher-rigor source).
      if (empiricalResults.length > 0) {
        const resultByKey = new Map(
          empiricalResults.map(
            (r) => [`${r.outcome_id}::${r.indicator_text}`, r] as const,
          ),
        );
        variationsWithEmpirical = detail.variations.map((v) => {
          if (v.id !== targetVariationId) return v;
          if (!Array.isArray(v.indicator_scores)) return v;
          return {
            ...v,
            // Phase 11.7 — flip the variation's evaluation_method to
            // "tested" since we have empirical data now. Theoretical
            // tiers (ensemble/rubric/simulation) still inform the
            // audit trail via the persisted lens_scores / lift_band
            // / evidence_citations on each indicator_score row.
            evaluation_method: "tested" as const,
            indicator_scores: v.indicator_scores.map((ind) => {
              const newResult = resultByKey.get(
                `${ind.outcome_id}::${ind.indicator_text}`,
              );
              if (!newResult) return ind;

              // Aggregate with prior overlay if present.
              const prior = ind.empirical_overlay;
              const nextNBriefs = (prior?.n_briefs ?? 0) + 1;
              const nextRigor = prior
                ? Math.max(
                    prior.methodology_rigor,
                    newResult.methodology_rigor,
                  )
                : newResult.methodology_rigor;
              // Rigor-weighted mean for lift; preserve null when
              // neither row carries a numeric lift.
              let nextLiftPct: number | null = null;
              if (
                newResult.observed_lift_pct !== null &&
                prior?.observed_lift_pct !== null &&
                prior?.observed_lift_pct !== undefined
              ) {
                const w1 = prior.methodology_rigor;
                const w2 = newResult.methodology_rigor;
                const denom = w1 + w2;
                nextLiftPct =
                  denom > 0
                    ? (prior.observed_lift_pct * w1 +
                        newResult.observed_lift_pct * w2) /
                      denom
                    : newResult.observed_lift_pct;
              } else if (newResult.observed_lift_pct !== null) {
                nextLiftPct = newResult.observed_lift_pct;
              } else if (prior?.observed_lift_pct !== undefined) {
                nextLiftPct = prior.observed_lift_pct;
              }
              const nextSampleTotal =
                prior?.sample_size_total !== undefined &&
                prior?.sample_size_total !== null
                  ? (prior.sample_size_total ?? 0) +
                    (newResult.sample_size_estimate ?? 0)
                  : (newResult.sample_size_estimate ?? null);
              // Direction: prefer the higher-rigor result's
              // direction. Inconsistency across briefs collapses to
              // "inconsistent".
              const nextDirection =
                prior &&
                prior.observed_direction !== newResult.observed_direction
                  ? "inconsistent"
                  : newResult.observed_direction;
              const nextRationale =
                prior &&
                prior.methodology_rigor > newResult.methodology_rigor
                  ? prior.extraction_rationale
                  : newResult.extraction_rationale;
              return {
                ...ind,
                empirical_overlay: {
                  observed_lift_pct: nextLiftPct,
                  observed_direction: nextDirection,
                  methodology_rigor: nextRigor,
                  sample_size_total: nextSampleTotal,
                  n_briefs: nextNBriefs,
                  extraction_rationale: nextRationale,
                  extracted_at: now,
                },
              };
            }),
          };
        });
      }
    }
  }

  const nextDetail: ExpandedItemDetail = {
    ...detail,
    prototype_briefs: nextBriefs,
    variations: variationsWithEmpirical,
  };
  const writeRes = await db
    .from("entities")
    .update({ expanded_detail: nextDetail })
    .eq("id", entityId);
  if (writeRes.error) {
    return NextResponse.json(
      { error: "persist failed", detail: writeRes.error.message },
      { status: 500 },
    );
  }

  // Phase 10a — log the lifecycle transition for the Lab Notebook.
  // Only log when status actually changed (avoid noise from idempotent calls).
  if (priorStatus !== status) {
    void logDecision(db, {
      userId: auth.user.id,
      spaceId: entity.space_id,
      subObjectiveId:
        typeof entity.parent_sub_objective_id === "string"
          ? entity.parent_sub_objective_id
          : null,
      proposalId: variationId,
      action: "prototype_status_changed",
      metadata: {
        entity_type: "prototype_brief",
        entity_id: entityId,
        entity_name: typeof entity.name === "string" ? entity.name : null,
        brief_id: briefId,
        prototype_status: status,
        prior_prototype_status: priorStatus,
        ...(status === "concluded" && resultSummary
          ? { result_summary: resultSummary }
          : {}),
        // Phase 11.7 — surface empirical extraction in the notebook
        // so the timeline shows "🧪 N indicators touched · top: +12%
        // · methodology 0.6". When extraction didn't fire (no
        // indicators, no result text, LLM failure) the counts are 0
        // and the notebook UI skips the empirical chip.
        empirical_indicators_touched: empiricalResults.length,
        ...(empiricalResults.length > 0
          ? {
              empirical_top_lift_pct: Math.max(
                ...empiricalResults
                  .map((r) =>
                    r.observed_lift_pct === null
                      ? -Infinity
                      : r.observed_lift_pct,
                  )
                  .filter((n) => Number.isFinite(n)),
                -Infinity,
              ),
              empirical_max_rigor: Math.max(
                ...empiricalResults.map((r) => r.methodology_rigor),
                0,
              ),
            }
          : {}),
      },
    });
  }

  return NextResponse.json({
    brief_id: briefId,
    status,
    status_updated_at: now,
  });
}
