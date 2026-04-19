import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import type { SynthesisData } from "@/types/synthesis";
import {
  applyObservation,
  type Observation,
  type PosteriorMap,
  LIGHT_PROXY_OBSERVATION_VARIANCE,
  HEAVY_PROXY_OBSERVATION_VARIANCE,
} from "@/lib/upf/posterior";

/**
 * Per-depth-tier observation variance. `mid` lives between the two constants
 * in posterior.ts — hard-coded here rather than exported as its own named
 * constant because no other caller needs the exact number.
 */
const MID_PROXY_OBSERVATION_VARIANCE = 0.22;

function varianceForDepthTier(
  tier: "light" | "mid" | "heavy" | null | undefined
): number {
  if (tier === "heavy") return HEAVY_PROXY_OBSERVATION_VARIANCE;
  if (tier === "mid") return MID_PROXY_OBSERVATION_VARIANCE;
  // null + light both fall back to light.
  return LIGHT_PROXY_OBSERVATION_VARIANCE;
}

/**
 * GET /api/metric-trackers/[id]/observations
 * Returns time-series observations for a tracker (asc by recorded_at).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { id: trackerId } = await params;

  // Verify tracker ownership (RLS also enforces this, but early-exit with cleaner 404)
  const { data: tracker } = await db
    .from("metric_trackers")
    .select("id")
    .eq("id", trackerId)
    .eq("user_id", user.id)
    .single();

  if (!tracker) {
    return NextResponse.json({ error: "Tracker not found" }, { status: 404 });
  }

  const { data, error } = await db
    .from("metric_observations")
    .select("*")
    .eq("tracker_id", trackerId)
    .order("recorded_at", { ascending: true });

  if (error) {
    console.error("[observations] list error:", error);
    return NextResponse.json({ error: "Failed to fetch observations" }, { status: 500 });
  }

  return NextResponse.json({ observations: data ?? [] });
}

/**
 * POST /api/metric-trackers/[id]/observations
 * Body: { value?: number; value_text?: string; note?: string; source?: "manual"|"ai_estimated"|"integration" }
 *
 * Inserts an observation and updates the tracker's current_value / current_text.
 *
 * Phase 4c-final+: also fans the observation out through the UPF posterior
 * map stored in the space's `synthesis_data.construct_posteriors`. The
 * observation updates:
 *   1. `metric:<label>` — the metric's own construct
 *   2. For every infrastructure proposal in this space that `metrics_tracked`
 *      this label: the proposal construct + each of its `source_components`
 *      as `entity:<id>` constructs
 *
 * Net effect: one observation on a tracker causes posterior variance drops
 * across every related entity, question, and proposal — so the synthesis-view
 * spotlight and the strategy cascade both re-rank on the next render. The
 * same entity knownness pill gains percentage.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<{
    value?: number | null;
    value_text?: string | null;
    note?: string | null;
    source?: "manual" | "ai_estimated" | "integration";
  }>(request);
  if (parseError) return parseError;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { id: trackerId } = await params;

  const value =
    typeof body.value === "number" && Number.isFinite(body.value) ? body.value : null;
  const valueText =
    typeof body.value_text === "string" && body.value_text.trim().length > 0
      ? body.value_text.trim()
      : null;

  if (value == null && valueText == null) {
    return NextResponse.json(
      { error: "Provide at least one of `value` (number) or `value_text` (string)" },
      { status: 400 }
    );
  }

  const source =
    body.source === "ai_estimated" || body.source === "integration"
      ? body.source
      : "manual";

  // Verify ownership + load the tracker fields the posterior fan-out needs.
  const { data: tracker } = await db
    .from("metric_trackers")
    .select("id,user_id,space_id,label,depth_tier")
    .eq("id", trackerId)
    .eq("user_id", user.id)
    .single();

  if (!tracker) {
    return NextResponse.json({ error: "Tracker not found" }, { status: 404 });
  }

  // Insert observation
  const { data: entry, error: insErr } = await db
    .from("metric_observations")
    .insert({
      tracker_id: trackerId,
      value,
      value_text: valueText,
      note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
      source,
    })
    .select()
    .single();

  if (insErr) {
    console.error("[observations] insert error:", insErr);
    return NextResponse.json({ error: "Failed to record observation" }, { status: 500 });
  }

  // Update tracker's current value
  const updatePayload: Record<string, unknown> = {};
  if (value != null) updatePayload.current_value = value;
  if (valueText != null) updatePayload.current_text = valueText;
  if (Object.keys(updatePayload).length > 0) {
    await db.from("metric_trackers").update(updatePayload).eq("id", trackerId);
  }

  // ── Phase 4c-final+: UPF posterior fan-out ──
  // Soft-fail — logging an observation must succeed even if posterior
  // bookkeeping hits a transient error.
  let posterior_updates = 0;
  try {
    const recordedAt = new Date().toISOString();
    const obsVariance = varianceForDepthTier(
      tracker.depth_tier as "light" | "mid" | "heavy" | null
    );

    // 1. Load the space's current posterior map.
    const { data: spaceRow } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", tracker.space_id)
      .single();

    const synthData = (spaceRow?.synthesis_data ?? {}) as SynthesisData;
    const priorPosteriors: PosteriorMap =
      (synthData.construct_posteriors as PosteriorMap | undefined) ?? {};

    // 2. Compute the set of construct_ids this observation probes.
    const label = (tracker.label as string | null)?.trim().toLowerCase() ?? "";
    const metricConstructId = `metric:${label}`;
    const constructIds = new Set<string>();
    constructIds.add(metricConstructId);

    // Find all proposals in this space whose metrics_tracked includes our
    // label; pull their entity constructs (source_components) in as well.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stratRec = (synthData.strategic_recommendation as any)?.recommendation;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proposals: Array<{
      id: string;
      name: string;
      metrics_tracked?: string[];
      source_components?: string[];
    }> = stratRec?.infrastructure_proposals ?? [];

    for (const p of proposals) {
      const metrics = (p.metrics_tracked ?? []).map((m) =>
        (m ?? "").trim().toLowerCase()
      );
      if (!metrics.includes(label)) continue;
      constructIds.add(`proposal:${(p.name ?? "").trim().toLowerCase()}`);
      for (const eid of p.source_components ?? []) {
        if (eid && eid !== "NEW") constructIds.add(`entity:${eid}`);
      }
    }

    // 3. Apply the observation to every probed construct.
    let nextPosteriors: PosteriorMap = priorPosteriors;
    for (const cid of constructIds) {
      const obs: Observation = {
        construct_id: cid,
        value: value ?? 1.0, // knownness signal even if no numeric value
        observation_variance: obsVariance,
        recorded_at: recordedAt,
        metadata: {
          source: "metric_observation",
          tracker_id: trackerId,
          tracker_label: tracker.label,
        },
      };
      nextPosteriors = applyObservation(nextPosteriors, obs);
      posterior_updates += 1;
    }

    // 4. Write back — merge with existing synthesis_data so we don't clobber
    // other fields. Same pattern as the rest of the app.
    if (posterior_updates > 0) {
      await db
        .from("spaces")
        .update({
          synthesis_data: {
            ...(synthData as object),
            construct_posteriors: nextPosteriors,
          },
        })
        .eq("id", tracker.space_id);
    }
  } catch (err) {
    console.warn("[observations] posterior fan-out failed (non-critical):", err);
  }

  return NextResponse.json({
    observation: entry,
    posterior_updates,
  });
}
