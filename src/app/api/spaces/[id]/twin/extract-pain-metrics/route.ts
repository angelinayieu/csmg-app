// ── POST /api/spaces/[id]/twin/extract-pain-metrics ─────────────────
//
// Re-runs the PainExtractor agent against the current synthesis +
// entity flags, INSERTs new pain_metric rows, returns them, and
// invalidates the twin dashboard cache.
//
// Replace semantics: re-running this endpoint REPLACES the existing
// pain_metrics for the space (delete then insert). The user controls
// when to refresh; the Twin Detail Page's Outcomes tab will have a
// "Refresh pain metrics" affordance that calls this.
//
// The synthesis pipeline ALSO calls this internally (via the helper
// runPainExtractorAndPersist) so newly-bootstrapped spaces get pain
// metrics automatically without the user clicking anything.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { runPainExtractorAgent } from "@/lib/twin/agents/pain-extractor-agent";
import { invalidateTwinDashboardCache } from "@/lib/twin/invalidate-dashboard-cache";
import type { Space, Entity } from "@/types";
import type { SynthesisData } from "@/types/synthesis";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(_req: Request, ctx: Ctx) {
  const { id: spaceId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Auth + fetch needed data in parallel.
  const [spaceRes, entRes] = await Promise.all([
    db.from("spaces").select("*").eq("id", spaceId).maybeSingle(),
    db
      .from("entities")
      .select(
        "id, name, description, is_bottleneck, is_risk_point, has_friction, has_cost",
      )
      .eq("space_id", spaceId),
  ]);

  if (!spaceRes?.data) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  const space = spaceRes.data as Space;
  if (space.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const entities = (entRes.data ?? []) as Array<
    Pick<Entity, "id" | "name" | "description"> & {
      is_bottleneck?: boolean | null;
      is_risk_point?: boolean | null;
      has_friction?: boolean | null;
      has_cost?: boolean | null;
    }
  >;

  // Parse synthesis_data (string or object).
  let synthesisData: SynthesisData | null = null;
  const rawSynth = (space as unknown as { synthesis_data?: unknown })
    .synthesis_data ?? null;
  if (rawSynth && typeof rawSynth === "object") {
    synthesisData = rawSynth as SynthesisData;
  } else if (typeof rawSynth === "string") {
    try {
      synthesisData = JSON.parse(rawSynth) as SynthesisData;
    } catch {
      synthesisData = null;
    }
  }

  // Build candidate entities — only those flagged with at least one
  // signal. Avoids polluting the prompt with neutral entities.
  const candidateEntities = entities
    .filter(
      (e) =>
        e.is_bottleneck || e.is_risk_point || e.has_friction || e.has_cost,
    )
    .map((e) => {
      const flags: string[] = [];
      if (e.is_bottleneck) flags.push("bottleneck");
      if (e.is_risk_point) flags.push("risk_point");
      if (e.has_friction) flags.push("friction");
      if (e.has_cost) flags.push("cost");
      return {
        id: e.id,
        name: e.name,
        description: e.description ?? null,
        flags,
      };
    });

  // Run agent.
  const extractorOutput = await runPainExtractorAgent({
    spaceName: space.name,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    spaceDescription: (space as any).description ?? null,
    synthesisData,
    candidateEntities,
  });

  // Replace semantics: delete existing rows, insert new ones.
  await db.from("pain_metrics").delete().eq("space_id", spaceId);

  let inserted: unknown[] = [];
  if (extractorOutput.pain_metrics.length > 0) {
    const rows = extractorOutput.pain_metrics.map((pm) => ({
      space_id: spaceId,
      user_id: user.id,
      name: pm.name.slice(0, 200),
      category: pm.category,
      baseline_value: pm.baseline_value,
      current_value: pm.current_value,
      target_value: pm.target_value,
      unit: pm.unit.slice(0, 50),
      direction: pm.direction,
      source_entity_ids: pm.source_entity_ids,
    }));
    const { data: insertedRows, error: insertErr } = await db
      .from("pain_metrics")
      .insert(rows)
      .select("*");
    if (insertErr) {
      console.warn("[extract-pain-metrics] insert failed:", insertErr);
    } else {
      inserted = insertedRows ?? [];
    }
  }

  // Invalidate the bundle cache so the next GET reflects the new
  // pain metrics.
  await invalidateTwinDashboardCache(db, spaceId);

  return NextResponse.json({
    pain_metrics: inserted,
    count: inserted.length,
    generated_at: extractorOutput.generated_at,
  });
}
