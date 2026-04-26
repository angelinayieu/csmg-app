// POST /api/lab/bootstrap
//
// Gap B's third rung: bootstrap resampling. Where monte-carlo runs N
// numeric iterations with parameter-noise sampled from a Gaussian, this
// route runs N iterations whose SEED is sampled with replacement from
// the target metric's actual historical deltas. The uncertainty
// envelope is therefore grounded in what the target has actually done,
// not in a fabricated σ.
//
// Body: same shape as /api/lab/monte-carlo + /api/lab/what-if
//   {
//     target_entity_id,
//     direction: "strengthen" | "weaken" | "remove",
//     magnitude: 0.1..1.0,
//     iterations?: 50..2000,
//     include_cross_space?: boolean
//   }
//
// Preflight:
//   { preflight: true, target_entity_id }
//   → returns `canRunBootstrap(...)` so the panel can decide whether
//     to offer the Bootstrap tab or grey it out with the reason.
//
// Tracker match: the engine needs period-to-period deltas for the
// target entity's corresponding metric tracker. There's no structural
// FK between entities and trackers, so we match heuristically:
//   1. Pull metric_trackers in the target's space
//   2. Case-insensitive substring match between tracker.label and
//      entity.name (either direction)
//   3. Pick the highest-match tracker; if none, 409.
// This is best-effort — the reality-calibration agent does a more
// thorough linking job, but we don't want to block bootstrap on an
// agent call. A mis-match leads to a meaningless distribution; the
// UI shows the matched tracker label so the user can spot it.

import { NextResponse } from "next/server";
import { z } from "zod";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  runBootstrap,
  canRunBootstrap,
  computePeriodDeltas,
  DEFAULT_ITERATIONS,
} from "@/lib/pipeline/bootstrap-simulation";
import type { CycleInfo } from "@/lib/pipeline/monte-carlo";
import { loadCrossSpaceBridgeEdges } from "@/lib/pipeline/cross-space-edges";
import type { Entity, Edge } from "@/types";

export const maxDuration = 30;

const BootstrapRequestSchema = z.object({
  target_entity_id: z.string().uuid(),
  direction: z.enum(["strengthen", "weaken", "remove"]),
  magnitude: z.number().min(0.1).max(1.0),
  iterations: z.number().int().min(50).max(2000).optional(),
  include_cross_space: z.boolean().optional(),
});

const PreflightRequestSchema = z.object({
  preflight: z.literal(true),
  target_entity_id: z.string().uuid(),
  include_cross_space: z.boolean().optional(),
});

interface MetricTrackerLite {
  id: string;
  label: string;
}

interface MetricObservationLite {
  tracker_id: string;
  value: number | null;
  recorded_at: string;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Preflight branch ────────────────────────────────────────────────
  const pre = PreflightRequestSchema.safeParse(body);
  if (pre.success) {
    const ctx = await loadContext(db, user.id, pre.data.target_entity_id);
    if ("error" in ctx) return ctx.error;
    // Bridges broaden the downstream-reachable gate (parallels MC).
    const preBridgeLoad =
      (pre.data.include_cross_space ?? true)
        ? await loadCrossSpaceBridgeEdges(
            db,
            ctx.entities.map((e) => e.id),
          )
        : { edges: [], entities: [], bridge_count: 0 };
    const gate = canRunBootstrap(
      pre.data.target_entity_id,
      [...ctx.entities, ...preBridgeLoad.entities],
      [...ctx.edges, ...preBridgeLoad.edges],
      ctx.targetHistoricalDeltas,
    );
    return NextResponse.json({
      preflight: gate,
      matched_tracker: ctx.matchedTracker,
      matched_tracker_score: ctx.matchedTrackerScore,
    });
  }

  // ── Full run ────────────────────────────────────────────────────────
  const parsed = BootstrapRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { target_entity_id, direction, magnitude, iterations, include_cross_space } =
    parsed.data;

  const ctx = await loadContext(db, user.id, target_entity_id);
  if ("error" in ctx) return ctx.error;

  // Splice in cross-space bridges — same rationale as monte-carlo.
  // Bootstrap's empirical volatility comes from the target metric, but
  // the propagation substrate it walks downstream should match what
  // the narrative walk sees, or we're running three simulations
  // against three different graphs.
  const wantBridges = include_cross_space ?? true;
  const bridgeLoad = wantBridges
    ? await loadCrossSpaceBridgeEdges(
        db,
        ctx.entities.map((e) => e.id),
      )
    : { edges: [], entities: [], bridge_count: 0 };
  const effectiveEntities = [...ctx.entities, ...bridgeLoad.entities];
  const effectiveEdges = [...ctx.edges, ...bridgeLoad.edges];

  const gate = canRunBootstrap(
    target_entity_id,
    effectiveEntities,
    effectiveEdges,
    ctx.targetHistoricalDeltas,
  );
  if (!gate.ok) {
    // 409 — distinct from a 400 schema error. The UI catches 409 and
    // renders a fallback card ("not enough history — switch to
    // monte-carlo or narrative").
    return NextResponse.json(
      {
        error: "bootstrap_unavailable",
        reason: gate.reason,
        historical_n: gate.historical_n,
        downstream_reachable_count: gate.downstream_reachable_count,
        matched_tracker: ctx.matchedTracker,
        matched_tracker_score: ctx.matchedTrackerScore,
      },
      { status: 409 },
    );
  }

  // Cycle load — mirrors the monte-carlo route so bootstrap and MC
  // honor the same feedback structure. Without this, a user switching
  // modes on the same target would see amplification vanish on the
  // bootstrap tab purely from load-order drift.
  const subgraphEntityIds = new Set(effectiveEntities.map((e) => e.id));
  const { data: cycleRows } = (await db
    .from("cycles")
    .select("cycle_id, classification, entity_ids, estimated_multiplier")
    .eq("space_id", ctx.spaceId)) as { data: CycleInfo[] | null };
  const relevantCycles = (cycleRows ?? []).filter((c) =>
    c.entity_ids?.some((id) => subgraphEntityIds.has(id)),
  );

  const result = runBootstrap({
    targetEntityId: target_entity_id,
    direction,
    magnitude,
    entities: effectiveEntities,
    edges: effectiveEdges,
    targetHistoricalDeltas: ctx.targetHistoricalDeltas,
    cycles: relevantCycles,
    iterations: iterations ?? DEFAULT_ITERATIONS,
  });

  // Persist to scenarios — same rationale as the monte-carlo route.
  // Name carries the matched tracker label in parentheses so the
  // chamber's scenario list makes the provenance obvious without the
  // user having to click through to the condition JSON.
  const targetEntity = effectiveEntities.find((e) => e.id === target_entity_id);
  const p50 = result.aggregate_distribution.p50;
  try {
    await db.from("scenarios").insert({
      space_id: ctx.spaceId,
      name: `Bootstrap: ${direction} ${targetEntity?.name ?? "target"}${
        ctx.matchedTracker ? ` (via ${ctx.matchedTracker.label})` : ""
      }`,
      conditions: JSON.stringify({
        simulation_mode: "bootstrap",
        target_entity_id,
        direction,
        magnitude,
        iterations: result.iterations,
        historical_n: result.historical_n,
        matched_tracker_id: ctx.matchedTracker?.id ?? null,
        cross_space_bridges_included: bridgeLoad.bridge_count,
      }),
      outcome_label: "Empirical impact (p50)",
      outcome_value: `${p50}%`,
      probability: p50 >= 70 ? "likely" : p50 >= 40 ? "possible" : "unlikely",
    });
  } catch (persistErr) {
    console.warn("[bootstrap] scenario persist failed (non-fatal):", persistErr);
  }

  // Fire-and-forget event log — matches the MC/walk routes so the
  // digest agent sees bootstrap runs with the same provenance chrome.
  try {
    const { recordUserEvent } = await import("@/lib/user-events/record");
    await recordUserEvent(db, {
      user_id: user.id,
      event_type: "lab.bootstrap_run",
      source: `user:bootstrap:${user.id}`,
      ref_kind: "entity",
      ref_id: target_entity_id,
      space_id: ctx.spaceId,
      payload: {
        direction,
        magnitude,
        iterations: result.iterations,
        historical_n: result.historical_n,
        matched_tracker_id: ctx.matchedTracker?.id ?? null,
        p50: result.aggregate_distribution.p50,
        cross_space_bridges: bridgeLoad.bridge_count,
      },
    });
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({
    result: { ...result, cross_space_bridges_included: bridgeLoad.bridge_count },
    matched_tracker: ctx.matchedTracker,
    matched_tracker_score: ctx.matchedTrackerScore,
  });
}

// ── Context loader ─────────────────────────────────────────────────────
//
// Combines the monte-carlo subgraph load with a tracker-match +
// history fetch. Kept in this file rather than extracted because the
// tracker-match heuristic is bootstrap-specific; MC and narrative walk
// don't need it.

interface BootstrapContext {
  entities: Entity[];
  edges: Edge[];
  spaceId: string;
  targetHistoricalDeltas: number[];
  matchedTracker: MetricTrackerLite | null;
  /** fuzzyMatchTracker score (0=no match, 1=weak token overlap, 2=substring,
   *  3=exact). Surfaced to the client so the result card can flag
   *  "low-confidence match" when the score is ≤ 1 — the user then
   *  treats the bootstrap distribution as suggestive rather than
   *  authoritative. */
  matchedTrackerScore: number;
}

async function loadContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
  targetEntityId: string,
): Promise<BootstrapContext | { error: NextResponse }> {
  // 1. Target + ownership.
  const { data: target } = (await db
    .from("entities")
    .select("id, name, space_id")
    .eq("id", targetEntityId)
    .maybeSingle()) as {
    data: { id: string; name: string; space_id: string } | null;
  };
  if (!target) {
    return {
      error: NextResponse.json({ error: "Entity not found" }, { status: 404 }),
    };
  }

  const { data: space } = (await db
    .from("spaces")
    .select("id")
    .eq("id", target.space_id)
    .eq("user_id", userId)
    .maybeSingle()) as { data: { id: string } | null };
  if (!space) {
    return {
      error: NextResponse.json({ error: "Not authorized" }, { status: 403 }),
    };
  }

  // 2. Two-hop subgraph — same shape as monte-carlo for consistency.
  const { data: firstHop } = (await db
    .from("edges")
    .select("*")
    .eq("space_id", target.space_id)
    .or(
      `source_entity_id.eq.${targetEntityId},target_entity_id.eq.${targetEntityId}`,
    )) as { data: Edge[] | null };
  const directEdges = firstHop ?? [];

  const neighborIds = Array.from(
    new Set(
      directEdges
        .flatMap((e) => [e.source_entity_id, e.target_entity_id])
        .filter((id) => id !== targetEntityId),
    ),
  );

  let secondHopEdges: Edge[] = [];
  if (neighborIds.length > 0) {
    const { data } = (await db
      .from("edges")
      .select("*")
      .eq("space_id", target.space_id)
      .or(
        `source_entity_id.in.(${neighborIds.join(",")}),target_entity_id.in.(${neighborIds.join(",")})`,
      )) as { data: Edge[] | null };
    secondHopEdges = data ?? [];
  }

  const edges = Array.from(
    new Map(
      [...directEdges, ...secondHopEdges].map((e) => [e.id, e]),
    ).values(),
  );

  const entityIds = Array.from(
    new Set([
      targetEntityId,
      ...edges.flatMap((e) => [e.source_entity_id, e.target_entity_id]),
    ]),
  );

  const { data: entities } = (await db
    .from("entities")
    .select("*")
    .in("id", entityIds)) as { data: Entity[] | null };

  // 3. Tracker match — substring fuzz between entity.name and tracker.label.
  //    Active trackers only; don't resample against an archived metric.
  const { data: trackers } = (await db
    .from("metric_trackers")
    .select("id, label")
    .eq("space_id", target.space_id)
    .eq("status", "active")) as { data: MetricTrackerLite[] | null };
  const match = fuzzyMatchTracker(target.name, trackers ?? []);
  const matchedTracker = match?.tracker ?? null;
  const matchedTrackerScore = match?.score ?? 0;

  // 4. Historical observations — load latest ~100 in time order. 100
  //    is plenty for a bootstrap distribution and keeps this query
  //    bounded; a pathologically chatty tracker won't burst the payload.
  let targetHistoricalDeltas: number[] = [];
  if (matchedTracker) {
    const { data: obs } = (await db
      .from("metric_observations")
      .select("tracker_id, value, recorded_at")
      .eq("tracker_id", matchedTracker.id)
      .not("value", "is", null)
      .order("recorded_at", { ascending: true })
      .limit(200)) as { data: MetricObservationLite[] | null };
    const values = (obs ?? [])
      .map((o) => o.value)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    targetHistoricalDeltas = computePeriodDeltas(values);
  }

  return {
    entities: entities ?? [],
    edges,
    spaceId: target.space_id,
    targetHistoricalDeltas,
    matchedTracker,
    matchedTrackerScore,
  };
}

/**
 * Best-effort tracker selection for an entity.
 *
 * Scoring:
 *   - exact case-insensitive equality → 3
 *   - either side contains the other → 2
 *   - any shared meaningful token (len >= 4) → 1
 *   - otherwise 0
 *
 * Returns the best-scoring {tracker, score} pair, or null if no
 * candidate clears score 1. Keep this pure so the preflight and
 * full-run paths agree. Score is surfaced to the UI so weak matches
 * (score 1 — shared token only) can be flagged "low-confidence match"
 * rather than silently presented as authoritative.
 */
function fuzzyMatchTracker(
  entityName: string,
  trackers: MetricTrackerLite[],
): { tracker: MetricTrackerLite; score: number } | null {
  if (trackers.length === 0) return null;
  const nameLower = entityName.toLowerCase().trim();
  const nameTokens = new Set(
    nameLower.split(/\W+/).filter((t) => t.length >= 4),
  );

  let best: { tracker: MetricTrackerLite; score: number } | null = null;
  for (const t of trackers) {
    const labelLower = t.label.toLowerCase().trim();
    let score = 0;
    if (labelLower === nameLower) {
      score = 3;
    } else if (
      labelLower.includes(nameLower) ||
      nameLower.includes(labelLower)
    ) {
      score = 2;
    } else {
      const labelTokens = new Set(
        labelLower.split(/\W+/).filter((t) => t.length >= 4),
      );
      for (const tok of nameTokens) {
        if (labelTokens.has(tok)) {
          score = 1;
          break;
        }
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { tracker: t, score };
    }
  }

  return best;
}
