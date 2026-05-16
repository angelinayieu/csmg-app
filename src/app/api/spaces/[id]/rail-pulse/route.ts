// GET /api/spaces/[id]/rail-pulse
//
// Thin aggregator for the right-rail Ambient mode. Returns a single
// rail-shaped object so the rail doesn't need to make 4 sequential
// fetches (insights-summary + twin-proposal + pulse-events + a snapshot
// query) every time it refreshes.
//
// Source rules:
//   • DOES NOT duplicate synthesis_data parsing — pulls the same fields
//     /api/spaces/[id]/insights-summary projects, but returns a narrower
//     subset focused on the rail's State + Live zones.
//   • DOES NOT replace /api/spaces/[id]/pulse-events — that's still the
//     source for the rail's Activity feed (streaming via SSE).
//   • DOES NOT replace /api/spaces/[id]/twin-proposal — that's still the
//     source for the full strategy picker. We only project the active
//     rank's compact form for the rail's State zone.
//
// 3 cheap queries:
//   1. spaces row    — counts + synthesis_data + reasoning_settings
//   2. pairwise count — pending (user_verdict IS NULL) + stale (revisit_required)
//   3. fresh pairwise — top 3 recent edge_proposed=true rows
//
// All return null-safe values; the rail renders an empty State zone +
// quiet Live zone when nothing has been synthesized yet.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type {
  SynthesisData,
  RichLeveragePoint,
  RichRiskPoint,
  RichBottleneck,
  RichOpenQuestion,
  Axiom,
} from "@/types/synthesis";
import type { RankedStrategy } from "@/types/strategy";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface RailPulseSnapshot {
  entity_count: number;
  edge_count: number;
  cycle_count: number;
  /** ISO timestamp of the most recent paper landed (set by /api/ingest/[id]/extract Phase 3). */
  last_paper_landed_at: string | null;
  last_paper_asset_id: string | null;
}

export interface RailPulseActiveStrategy {
  rank: number;
  title: string;
  summary: string;
  confidence: number | null;
  posture: string;
}

export interface RailPulseLockedInsight {
  entity_id: string;
  /** The entity's display name. Null when synthesis returned the
   *  point without a hydrated name — the rail uses this as the
   *  primary title and falls back to a one-line summary excerpt
   *  when null. */
  entity_name: string | null;
  /** The synthesis paragraph for this point. Rendered as the
   *  subtitle / "why" line under the entity name. Always trimmed
   *  to a sentence boundary before display. */
  summary: string;
}

export interface RailPulseBottleneck {
  entity_id: string;
  /** Hydrated entity name when available; null when synthesis
   *  didn't supply one. The rail prefers this for the card title. */
  entity_name: string | null;
  /** Synthesis paragraph — rendered as the "why" line. */
  summary: string;
  /** Raw blast_radius from synthesis. Kept for callers that want
   *  the number; the rail itself renders `scope_label` instead. */
  blast_radius: number | null;
  /** Human-readable scope band derived from blast_radius. One of
   *  "narrow scope", "moderate scope", "wide scope", "system-wide".
   *  Null when blast_radius is missing. */
  scope_label: string | null;
  /** What unblocks if this constraint is resolved. From
   *  master_bottleneck.counterfactual_unlock. The rail surfaces
   *  this as a third line when present. */
  unlock_summary: string | null;
}

export interface RailPulseFreshPair {
  source_name: string;
  target_name: string;
  confidence: number | null;
  observed_at: string;
}

export interface RailPulseResponse {
  /** ISO timestamp of when this response was computed. */
  computed_at: string;
  /** null when the space row is missing required count columns. */
  snapshot: RailPulseSnapshot | null;
  /** null when the space hasn't been synthesized into a strategy yet. */
  active_strategy: RailPulseActiveStrategy | null;
  locked_insights: {
    bottleneck: RailPulseBottleneck | null;
    leverage_top: RailPulseLockedInsight[];
    risk_top: RailPulseLockedInsight[];
    axiom_count: number;
  };
  live: {
    pending_pairwise: number;
    stale_pair_checks: number;
    open_question_count: number;
    fresh_pairwise: RailPulseFreshPair[];
  };
  /** True when synthesis_data exists and has at least one tier populated. */
  has_synthesis: boolean;
  /** True when the KG has entities but synthesis hasn't run / finished
   *  yet — lets the rail render a "Synthesizing…" state instead of
   *  partially-broken cards. */
  synthesis_in_progress: boolean;
}

function emptyResponse(): RailPulseResponse {
  return {
    computed_at: new Date().toISOString(),
    snapshot: null,
    active_strategy: null,
    locked_insights: {
      bottleneck: null,
      leverage_top: [],
      risk_top: [],
      axiom_count: 0,
    },
    live: {
      pending_pairwise: 0,
      stale_pair_checks: 0,
      open_question_count: 0,
      fresh_pairwise: [],
    },
    has_synthesis: false,
    synthesis_in_progress: false,
  };
}

export async function GET(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── 1. Spaces row + synthesis_data ─────────────────────────────────
  const { data: spaceRow } = (await db
    .from("spaces")
    .select(
      "id, user_id, entity_count, edge_count, cycle_count, synthesis_data",
    )
    .eq("id", spaceId)
    .maybeSingle()) as {
    data: {
      id: string;
      user_id: string;
      entity_count: number | null;
      edge_count: number | null;
      cycle_count: number | null;
      synthesis_data: unknown;
    } | null;
  };

  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // synthesis_data may be JSON-string or parsed object depending on driver.
  let synthesis: SynthesisData | null = null;
  const rawSynth = spaceRow.synthesis_data ?? null;
  if (rawSynth && typeof rawSynth === "object") {
    synthesis = rawSynth as SynthesisData;
  } else if (typeof rawSynth === "string") {
    try {
      synthesis = JSON.parse(rawSynth) as SynthesisData;
    } catch {
      synthesis = null;
    }
  }

  const synthRaw = (synthesis ?? {}) as Record<string, unknown>;
  const lastPaperAt =
    typeof synthRaw.last_paper_landed_at === "string"
      ? (synthRaw.last_paper_landed_at as string)
      : null;
  const lastPaperAssetId =
    typeof synthRaw.last_paper_asset_id === "string"
      ? (synthRaw.last_paper_asset_id as string)
      : null;

  const snapshot: RailPulseSnapshot = {
    entity_count: spaceRow.entity_count ?? 0,
    edge_count: spaceRow.edge_count ?? 0,
    cycle_count: spaceRow.cycle_count ?? 0,
    last_paper_landed_at: lastPaperAt,
    last_paper_asset_id: lastPaperAssetId,
  };

  // ── 2. Active strategy (compact projection) ────────────────────────
  // Pull from synthesis_data.ranked_strategies[0] when present, else
  // fall back to extracting from strategic_recommendation. This mirrors
  // twin-proposal's extractTwinProposalFromStrategy fallback path
  // without re-importing it (avoids the heavier dependency for a
  // narrow response shape).
  // ranked_strategies[0] (the canonical "active" rank) is preferred;
  // fallback to synthesis.strategic_recommendation.recommendation
  // (StrategicRecommendationData nests the StrategicRecommendation
  // object — same shape, just one level deeper).
  let activeStrategy: RailPulseActiveStrategy | null = null;
  if (synthesis) {
    const ranked = (synthesis as unknown as {
      ranked_strategies?: RankedStrategy[];
    }).ranked_strategies;
    if (Array.isArray(ranked) && ranked.length > 0) {
      const top = ranked[0];
      const rec = top.recommendation;
      activeStrategy = {
        rank: top.rank ?? 1,
        title: rec?.title ?? "Active strategy",
        summary: rec?.summary ?? "",
        // StrategicRecommendation.confidence is already 0-100.
        confidence: typeof rec?.confidence === "number" ? rec.confidence : null,
        posture: rec?.strategic_posture ?? "unknown",
      };
    } else if (synthesis.strategic_recommendation) {
      const recData = synthesis.strategic_recommendation;
      const rec = (recData as { recommendation?: typeof recData.recommendation })
        .recommendation;
      if (rec) {
        activeStrategy = {
          rank: 1,
          title: rec.title ?? "Active strategy",
          summary: rec.summary ?? "",
          confidence:
            typeof rec.confidence === "number" ? rec.confidence : null,
          posture: rec.strategic_posture ?? "unknown",
        };
      }
    }
  }

  // ── 3. Locked insights (top tier only, summary projection) ─────────
  const leveragePoints: RichLeveragePoint[] = synthesis?.leverage_points ?? [];
  const riskPoints: RichRiskPoint[] = synthesis?.risk_points ?? [];
  const bottleneck: RichBottleneck | null = synthesis?.master_bottleneck ?? null;
  const axioms: Axiom[] = (synthesis as unknown as { axioms?: Axiom[] })
    ?.axioms ?? [];
  const openQuestions: RichOpenQuestion[] = synthesis?.open_questions ?? [];

  // Synthesis sometimes omits the hydrated entity_name on
  // leverage/risk/bottleneck. Fall back to the entities table so the
  // rail never has to fabricate a title from a truncated summary.
  const insightEntityIds = new Set<string>();
  for (const lp of leveragePoints.slice(0, 3)) {
    if (lp.entity_id) insightEntityIds.add(lp.entity_id);
  }
  for (const rp of riskPoints.slice(0, 3)) {
    if (rp.entity_id) insightEntityIds.add(rp.entity_id);
  }
  if (bottleneck?.entity_id) insightEntityIds.add(bottleneck.entity_id);

  let entityNameById = new Map<string, string>();
  if (insightEntityIds.size > 0) {
    const { data: nameRows } = (await db
      .from("entities")
      .select("entity_id, name")
      .eq("space_id", spaceId)
      .in("entity_id", Array.from(insightEntityIds))) as {
      data: Array<{ entity_id: string; name: string }> | null;
    };
    entityNameById = new Map(
      (nameRows ?? [])
        .filter((r) => typeof r.name === "string" && r.name.trim().length > 0)
        .map((r) => [r.entity_id, r.name.trim()]),
    );
  }

  const resolveName = (
    entity_id: string | null | undefined,
    explicit: string | undefined,
  ): string | null => {
    const ex = typeof explicit === "string" ? explicit.trim() : "";
    if (ex.length > 0) return ex;
    if (entity_id && entityNameById.has(entity_id)) {
      return entityNameById.get(entity_id) ?? null;
    }
    return null;
  };

  const lockedLeverage: RailPulseLockedInsight[] = leveragePoints
    .slice(0, 3)
    .map((lp) => ({
      entity_id: lp.entity_id,
      entity_name: resolveName(
        lp.entity_id,
        (lp as unknown as { entity_name?: string }).entity_name,
      ),
      summary: typeof lp.summary === "string" ? lp.summary.trim() : "",
    }));
  const lockedRisks: RailPulseLockedInsight[] = riskPoints
    .slice(0, 3)
    .map((rp) => ({
      entity_id: rp.entity_id,
      entity_name: resolveName(
        rp.entity_id,
        (rp as unknown as { entity_name?: string }).entity_name,
      ),
      summary: typeof rp.summary === "string" ? rp.summary.trim() : "",
    }));

  // ── 4. Live counts — pairwise_connection_checks ────────────────────
  let pendingPairwise = 0;
  let stalePairChecks = 0;
  let freshPairwise: RailPulseFreshPair[] = [];
  try {
    // Pending review — edge_proposed=true rows the user hasn't acted on.
    const { count: pendingCount } = await db
      .from("pairwise_connection_checks")
      .select("id", { count: "exact", head: true })
      .eq("space_id", spaceId)
      .eq("edge_proposed", true)
      .is("user_verdict", null);
    pendingPairwise = typeof pendingCount === "number" ? pendingCount : 0;

    // Stale — pairs flagged for revisit because their neighborhood
    // topology changed (Phase 3 we set this when papers land).
    const { count: staleCount } = await db
      .from("pairwise_connection_checks")
      .select("id", { count: "exact", head: true })
      .eq("space_id", spaceId)
      .eq("revisit_required", true);
    stalePairChecks = typeof staleCount === "number" ? staleCount : 0;

    // Top 3 fresh pairwise findings — proposed edges, no verdict yet,
    // sorted most-recent first. We project name + confidence so the
    // rail can render LiveCards without a second roundtrip.
    const { data: freshRows } = (await db
      .from("pairwise_connection_checks")
      .select(
        "entity_a_id, entity_b_id, confidence, checked_at",
      )
      .eq("space_id", spaceId)
      .eq("edge_proposed", true)
      .is("user_verdict", null)
      .order("checked_at", { ascending: false })
      .limit(3)) as {
      data: Array<{
        entity_a_id: string;
        entity_b_id: string;
        confidence: number | null;
        checked_at: string;
      }> | null;
    };

    if (freshRows && freshRows.length > 0) {
      // Resolve entity names in one query so the rail doesn't have to.
      const entityIds = Array.from(
        new Set(freshRows.flatMap((r) => [r.entity_a_id, r.entity_b_id])),
      );
      const { data: nameRows } = (await db
        .from("entities")
        .select("id, name")
        .in("id", entityIds)) as {
        data: Array<{ id: string; name: string }> | null;
      };
      const nameById = new Map(
        (nameRows ?? []).map((n) => [n.id, n.name]),
      );
      freshPairwise = freshRows.map((r) => ({
        source_name: nameById.get(r.entity_a_id) ?? "(unknown)",
        target_name: nameById.get(r.entity_b_id) ?? "(unknown)",
        confidence: r.confidence,
        observed_at: r.checked_at,
      }));
    }
  } catch (err) {
    // Pair-check table missing or RLS issue — soft-fail. The rail just
    // shows no pairwise items, not an error.
    console.warn("[rail-pulse] pairwise queries failed (non-fatal):", err);
  }

  const hasSynthesis =
    !!synthesis &&
    (leveragePoints.length > 0 ||
      riskPoints.length > 0 ||
      !!bottleneck ||
      axioms.length > 0 ||
      !!activeStrategy);

  // Bottleneck projection — when synthesis is sparse, prefer entities-
  // table name over the literal word "Bottleneck"; convert blast_radius
  // into a human scope band; surface the counterfactual unlock so the
  // rail can show a third meaningful line.
  const bottleneckProjection: RailPulseBottleneck | null = bottleneck
    ? {
        entity_id: bottleneck.entity_id,
        entity_name: resolveName(
          bottleneck.entity_id,
          (bottleneck as unknown as { entity_name?: string }).entity_name,
        ),
        summary:
          typeof bottleneck.summary === "string"
            ? bottleneck.summary.trim()
            : "",
        blast_radius:
          typeof bottleneck.blast_radius === "number"
            ? bottleneck.blast_radius
            : null,
        scope_label:
          typeof bottleneck.blast_radius === "number"
            ? scopeLabelFromBlastRadius(bottleneck.blast_radius)
            : null,
        unlock_summary:
          typeof bottleneck.counterfactual_unlock === "string" &&
          bottleneck.counterfactual_unlock.trim().length > 0
            ? bottleneck.counterfactual_unlock.trim()
            : null,
      }
    : null;

  // "Synthesizing" — we have a KG but no synthesis output yet. Means the
  // pipeline is mid-run (or failed silently). Either way the rail
  // shouldn't render half-baked cards; it should say so explicitly.
  const synthesisInProgress = !hasSynthesis && (spaceRow.entity_count ?? 0) > 0;

  const response: RailPulseResponse = {
    computed_at: new Date().toISOString(),
    snapshot,
    active_strategy: activeStrategy,
    locked_insights: {
      bottleneck: bottleneckProjection,
      leverage_top: lockedLeverage,
      risk_top: lockedRisks,
      axiom_count: axioms.length,
    },
    live: {
      pending_pairwise: pendingPairwise,
      stale_pair_checks: stalePairChecks,
      open_question_count: openQuestions.length,
      fresh_pairwise: freshPairwise,
    },
    has_synthesis: hasSynthesis,
    synthesis_in_progress: synthesisInProgress,
  };

  if (!hasSynthesis) {
    // Fall through with the partial snapshot — rail's Ambient mode
    // renders a quiet "no synthesis yet" State zone but still surfaces
    // KG counts.
    return NextResponse.json({
      ...emptyResponse(),
      snapshot,
      computed_at: response.computed_at,
      synthesis_in_progress: synthesisInProgress,
    });
  }

  return NextResponse.json(response);
}

// ── Helpers ────────────────────────────────────────────────────────

// Map raw blast_radius (a dimensionless number set by synthesis) to a
// human band. The thresholds are calibrated to typical KG sizes — a
// blast of 30+ in a 50-node graph saturates the graph; a blast of 3
// is local. Thresholds are conservative to avoid screaming
// "system-wide" on tiny graphs.
function scopeLabelFromBlastRadius(blastRadius: number): string {
  if (!Number.isFinite(blastRadius)) return "—";
  if (blastRadius >= 30) return "system-wide impact";
  if (blastRadius >= 15) return "wide impact";
  if (blastRadius >= 5) return "moderate impact";
  return "narrow impact";
}
