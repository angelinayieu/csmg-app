// GET /api/spaces/[id]/forest-plot
//
// Returns the top N evidence_registries rows (effect_size + CI) for the
// canvas forest-plot card. Used by the operational seeder to spawn one
// `forest-plot` shape inside the kg room (or proposal room — see seeder).
//
// Picks rows with usable effect_size + ci_lower + ci_upper (a forest plot
// is meaningless without bounds), sorted by |effect_size| desc so the
// most-impactful findings render first. Caps at 8 by default — past that
// the chart becomes unreadable inside a 320×320 canvas card.
//
// Each row carries `effect_metric` (cohens_d / hedges_g / rr / or / etc.)
// so the renderer can pick the right reference line: 0 for standardized
// mean differences, 1 for ratio metrics.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface ForestFinding {
  id: string;
  /** Display label — outcome_label preferred, falls back to intervention_label or "(unlabeled)". */
  label: string;
  effect_size: number;
  effect_metric: string | null;
  ci_lower: number;
  ci_upper: number;
  ci_level: number | null;
  /** Number of subjects/observations when reported. */
  n_total: number | null;
  /** "8 weeks", "1 year follow-up", etc. — when reported. */
  followup_label: string | null;
  /** Domain-grouping field (population_label or intervention_label) so the
   *  card can color-code rows by category. */
  population_label: string | null;
}

interface ForestPlotResponse {
  findings: ForestFinding[];
  /** Whichever effect_metric is most common across the returned findings —
   *  drives the reference line (0 for SMD-family, 1 for ratio-family). */
  primary_metric: string | null;
}

const SMD_METRICS = new Set([
  "cohens_d",
  "hedges_g",
  "smd",
  "raw_mean_diff",
  "beta",
]);
const RATIO_METRICS = new Set(["rr", "or", "hr", "irr"]);

function isSmdMetric(m: string | null): boolean {
  return m !== null && SMD_METRICS.has(m.toLowerCase());
}

function isRatioMetric(m: string | null): boolean {
  return m !== null && RATIO_METRICS.has(m.toLowerCase());
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.max(
    1,
    Math.min(20, Number.parseInt(limitRaw ?? "8", 10) || 8),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Pull rows with both bounds present. We can't sort by abs() server-side
  // without a stored generated column, so over-fetch by 2x and sort
  // in-memory. evidence_registries is space-scoped + indexed so this is
  // cheap.
  const { data, error } = await db
    .from("evidence_registries")
    .select(
      "id, outcome_label, intervention_label, population_label, " +
        "effect_size, effect_metric, ci_lower, ci_upper, ci_level, " +
        "n_treatment, n_control, followup_label",
    )
    .eq("space_id", spaceId)
    .not("effect_size", "is", null)
    .not("ci_lower", "is", null)
    .not("ci_upper", "is", null)
    .limit(limit * 3);

  if (error) {
    return NextResponse.json(
      { error: "Failed to load forest-plot findings", detail: error.message },
      { status: 500 },
    );
  }

  type Row = {
    id: string;
    outcome_label: string | null;
    intervention_label: string | null;
    population_label: string | null;
    effect_size: number | null;
    effect_metric: string | null;
    ci_lower: number | null;
    ci_upper: number | null;
    ci_level: number | null;
    n_treatment: number | null;
    n_control: number | null;
    followup_label: string | null;
  };
  const rows = (data ?? []) as Row[];

  // Normalize + filter to rows with valid numbers + sensible CI ordering.
  const findings: ForestFinding[] = rows
    .map((r): ForestFinding | null => {
      if (
        typeof r.effect_size !== "number" ||
        typeof r.ci_lower !== "number" ||
        typeof r.ci_upper !== "number" ||
        !Number.isFinite(r.effect_size) ||
        !Number.isFinite(r.ci_lower) ||
        !Number.isFinite(r.ci_upper) ||
        r.ci_lower > r.ci_upper
      ) {
        return null;
      }
      const label =
        (r.outcome_label && r.outcome_label.trim()) ||
        (r.intervention_label && r.intervention_label.trim()) ||
        "(unlabeled)";
      const nTotal =
        (r.n_treatment ?? 0) + (r.n_control ?? 0) || null;
      return {
        id: String(r.id),
        label: label.slice(0, 80),
        effect_size: r.effect_size,
        effect_metric: r.effect_metric ?? null,
        ci_lower: r.ci_lower,
        ci_upper: r.ci_upper,
        ci_level: r.ci_level ?? null,
        n_total: nTotal,
        followup_label: r.followup_label ?? null,
        population_label: r.population_label ?? null,
      };
    })
    .filter((f): f is ForestFinding => f !== null)
    // Sort by |effect_size| desc — most-impactful findings first.
    .sort((a, b) => Math.abs(b.effect_size) - Math.abs(a.effect_size))
    .slice(0, limit);

  // Pick primary metric — most common across returned findings, with a
  // soft preference for SMD-family over ratio-family when it's a tie
  // (canvas reference-line heuristic prefers 0 over 1 for visual
  // consistency with the deviation-from-baseline reading).
  const metricCounts = new Map<string, number>();
  for (const f of findings) {
    if (!f.effect_metric) continue;
    const k = f.effect_metric.toLowerCase();
    metricCounts.set(k, (metricCounts.get(k) ?? 0) + 1);
  }
  let primary_metric: string | null = null;
  let bestCount = 0;
  for (const [m, c] of metricCounts) {
    const isSmd = isSmdMetric(m);
    const isRatio = isRatioMetric(m);
    // Prefer SMD on ties; deprioritize unrecognized metrics.
    const tieBreaker = isSmd ? 1 : isRatio ? 0 : -1;
    if (
      c > bestCount ||
      (c === bestCount &&
        primary_metric &&
        tieBreaker > (isSmdMetric(primary_metric) ? 1 : isRatioMetric(primary_metric) ? 0 : -1))
    ) {
      primary_metric = m;
      bestCount = c;
    }
  }

  const payload: ForestPlotResponse = { findings, primary_metric };
  return NextResponse.json(payload);
}
