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
import {
  classifyRigor,
  emptyTierCounts,
  isAnchoredTier,
  TIER_META,
  type RigorTier,
  type TierCounts,
} from "@/lib/evidence/rigor-tier";

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
  /** Phase 0 rigor classification — derived from row signals (status,
   *  ingested_file_id, flags, llm_label_provenance). Drives the row's
   *  RigorMark glyph + opacity bucket in the canvas card. */
  rigor_tier: RigorTier;
}

interface ForestPlotResponse {
  findings: ForestFinding[];
  /** Whichever effect_metric is most common across the returned findings —
   *  drives the reference line (0 for SMD-family, 1 for ratio-family). */
  primary_metric: string | null;
  /** Phase E: when `?edgeId` is supplied, the subset of `findings.id` that
   *  belong to the edge's endpoint entities. Always present in the response
   *  shape (empty array when no filter is applied) so the client can treat
   *  it uniformly. */
  matched_finding_ids: string[];
  /** Phase E: when `?edgeId` is supplied, a human-friendly label for the
   *  focused edge so the shape's focus chip can render `focused: <label>`.
   *  Falls back to "edge <short-id>" when no relationship/dimension is set. */
  focused_edge_label: string | null;
  /** Phase 0 rigor: which tier filter was applied to produce `findings`.
   *  `anchored` = paper-sourced only (default). `all` = every tier, with
   *  visual differentiation per-row. */
  tier_mode: "anchored" | "all";
  /** Phase 0 rigor: per-tier counts across the FULL eligible pool BEFORE
   *  filtering. Always present; lets the shape footer render an honest
   *  "4 paper-sourced · 2 web · 1 legacy" line regardless of the active
   *  filter. */
  tier_counts: TierCounts;
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
  // Phase 0 rigor: tier filter. `anchored` (default) renders only
  // paper-sourced rows; `all` renders every tier with the shape
  // visually differentiating drifted rows. Accepts the historical
  // `tier=paper` synonym for `anchored` and `tier=*`/`tier=all` for the
  // permissive mode.
  const tierRaw = (url.searchParams.get("tier") ?? "").trim().toLowerCase();
  const tierMode: "anchored" | "all" =
    tierRaw === "all" || tierRaw === "*" ? "all" : "anchored";
  // Phase E: optional edge focus. When present, the response keeps the
  // top-N space-wide findings (so the card never goes empty) but tags
  // which `id`s belong to the edge's two endpoint entities — the shape
  // dims the rest. We deliberately keep all rows visible so the focused
  // row stays in context (the whole point of a forest plot).
  const edgeIdRaw = url.searchParams.get("edgeId");
  const edgeId =
    edgeIdRaw && edgeIdRaw.trim().length > 0 ? edgeIdRaw.trim() : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Phase E: pre-fetch the focused edge's endpoints + label. Done before
  // the findings query so the response always returns a stable shape
  // (even on edge-not-found we degrade to empty matched_finding_ids,
  // not a 4xx — keeps the client trivial).
  let endpointEntityIds: Set<string> = new Set();
  let focused_edge_label: string | null = null;
  if (edgeId) {
    const { data: edgeRow } = await db
      .from("edges")
      .select(
        "id, source_entity_id, target_entity_id, relationship_type, dimension",
      )
      .eq("id", edgeId)
      .eq("space_id", spaceId)
      .maybeSingle();
    if (edgeRow) {
      if (edgeRow.source_entity_id)
        endpointEntityIds.add(String(edgeRow.source_entity_id));
      if (edgeRow.target_entity_id)
        endpointEntityIds.add(String(edgeRow.target_entity_id));
      const rel: string | null = edgeRow.relationship_type ?? null;
      const dim: string | null = edgeRow.dimension ?? null;
      focused_edge_label =
        rel && dim
          ? `${rel} · ${dim}`
          : (rel ?? dim ?? `edge ${String(edgeRow.id).slice(0, 8)}`);
    }
  }

  // Pull rows with both bounds present. We can't sort by abs() server-side
  // without a stored generated column, so over-fetch by ~4x (the tier
  // filter and the abs-sort both narrow downstream — anchored-only mode
  // can drop 50%+ of fetched rows when the pool is web-heavy). Cap at
  // 80 to keep the payload bounded.
  //
  // Phase 0 rigor: SELECT now includes status, ingested_file_id, flags,
  // and llm_label_provenance so classifyRigor can run per-row.
  const overfetchCap = Math.max(limit * 4, 24);
  const { data, error } = await db
    .from("evidence_registries")
    .select(
      "id, outcome_label, intervention_label, population_label, " +
        "effect_size, effect_metric, ci_lower, ci_upper, ci_level, " +
        "n_treatment, n_control, followup_label, attached_entity_id, " +
        "status, ingested_file_id, flags, llm_label_provenance",
    )
    .eq("space_id", spaceId)
    .not("effect_size", "is", null)
    .not("ci_lower", "is", null)
    .not("ci_upper", "is", null)
    // Drop superseded / rejected rows from the forest plot entirely.
    // Both states explicitly signal "do not use for downstream
    // computation"; including them would surface stale or invalidated
    // numbers next to active ones.
    .not("status", "in", "(superseded,rejected)")
    .limit(Math.min(80, overfetchCap));

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
    attached_entity_id: string | null;
    status: string | null;
    ingested_file_id: string | null;
    flags: string[] | null;
    llm_label_provenance: { source_url?: unknown } | null;
  };
  const rows = (data ?? []) as Row[];

  // Phase 0 rigor: classify every fetched row up front. tier_counts is
  // built over the FULL eligible pool (not the post-filter slice) so
  // the shape footer can always show an honest population breakdown
  // even when the active filter hides drifted rows.
  const tier_counts: TierCounts = emptyTierCounts();
  const tierById = new Map<string, RigorTier>();
  for (const r of rows) {
    const tier = classifyRigor({
      status: r.status,
      ingested_file_id: r.ingested_file_id,
      flags: r.flags,
      llm_label_provenance: r.llm_label_provenance,
    });
    tierById.set(String(r.id), tier);
    tier_counts[tier] += 1;
  }

  // Phase E: side-channel — collect the per-row attached_entity_id so we
  // can compute matched_finding_ids AFTER the sort + slice, but BEFORE we
  // drop the field from the public response (it isn't part of ForestFinding).
  const attachedByRowId = new Map<string, string | null>();
  for (const r of rows) {
    attachedByRowId.set(String(r.id), r.attached_entity_id ?? null);
  }

  // Normalize + filter to rows with valid numbers + sensible CI ordering.
  // Each surviving row carries its rigor_tier so downstream filter +
  // sort can reason about tier without re-classifying.
  const normalized: ForestFinding[] = rows
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
      const tier =
        tierById.get(String(r.id)) ?? ("legacy_unsourced" as RigorTier);
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
        rigor_tier: tier,
      };
    })
    .filter((f): f is ForestFinding => f !== null);

  // Phase 0 rigor:
  //   • `anchored` mode (default) drops every drifted row before
  //     sorting. Hallucinated effect sizes never rank against
  //     paper-sourced ones.
  //   • `all` mode keeps every row but bucket-sorts: paper tiers
  //     first (descending by |effect|), drifted tiers after (also
  //     descending). The two groups do NOT interleave — the shape's
  //     visual hierarchy depends on this stability.
  let findings: ForestFinding[];
  if (tierMode === "anchored") {
    findings = normalized
      .filter((f) => isAnchoredTier(f.rigor_tier))
      .sort((a, b) => Math.abs(b.effect_size) - Math.abs(a.effect_size))
      .slice(0, limit);
  } else {
    findings = normalized
      .sort((a, b) => {
        const ra = TIER_META[a.rigor_tier].rank;
        const rb = TIER_META[b.rigor_tier].rank;
        const aAnchored = isAnchoredTier(a.rigor_tier) ? 1 : 0;
        const bAnchored = isAnchoredTier(b.rigor_tier) ? 1 : 0;
        // Primary key: anchored bucket first (1 > 0).
        if (aAnchored !== bAnchored) return bAnchored - aAnchored;
        // Within bucket: descending rank (paper_reviewed > paper_extracted,
        // web_deep_research > web_heuristic > legacy_unsourced).
        if (ra !== rb) return rb - ra;
        return Math.abs(b.effect_size) - Math.abs(a.effect_size);
      })
      .slice(0, limit);
  }

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

  // Phase E: compute matched_finding_ids when an edge filter is applied.
  // A finding matches when its `attached_entity_id` is either endpoint of
  // the focused edge. We match on the POST-sort, POST-slice findings so
  // the shape gets stable indices for highlighting.
  const matched_finding_ids: string[] = [];
  if (edgeId && endpointEntityIds.size > 0) {
    for (const f of findings) {
      const attached = attachedByRowId.get(f.id);
      if (attached && endpointEntityIds.has(attached)) {
        matched_finding_ids.push(f.id);
      }
    }
  }

  const payload: ForestPlotResponse = {
    findings,
    primary_metric,
    matched_finding_ids,
    focused_edge_label,
    tier_mode: tierMode,
    tier_counts,
  };
  return NextResponse.json(payload);
}
