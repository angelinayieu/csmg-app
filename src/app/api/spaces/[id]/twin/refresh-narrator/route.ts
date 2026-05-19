// ── POST /api/spaces/[id]/twin/refresh-narrator ────────────────────
//
// Force-re-runs the Narrator agent and surgically patches the bundle
// cache's narrator_summary field. Used by the "Refresh" button on
// the Overview tab's narrator card.
//
// Surgical patch instead of full cache invalidation so the other
// tabs (System / Outcomes / Operating) stay instant — only the
// narrator paragraph re-renders.
//
// If the cache row doesn't exist yet (first-time refresh on a stale
// space), we return the freshly generated summary and let the next
// bundle GET write it through. The narrator output is also written
// onto the existing cache JSON if present.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { computeTwinState } from "@/lib/twin/compute-twin-state";
import { runNarratorAgent } from "@/lib/twin/agents/narrator-agent";
import { computeRecentChangeNote } from "@/lib/twin/compute-agent-inputs";
import type { Space, Entity, Edge, Cycle } from "@/types";
import type { SynthesisData } from "@/types/synthesis";
import type { ImprovementGoal } from "@/types/goals";

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

  // Auth + cache row lookup in one trip.
  const { data: cacheRow } = await db
    .from("spaces")
    .select("user_id, twin_dashboard_cache")
    .eq("id", spaceId)
    .maybeSingle();

  if (!cacheRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (cacheRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Fetch the inputs the narrator needs. Same shape the bundle endpoint
  // uses — kept in sync via the NarratorInput type.
  const [spaceRes, entRes, edgeRes, cycleRes, goalRes, layerRes] =
    await Promise.all([
      db.from("spaces").select("*").eq("id", spaceId).maybeSingle(),
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
      db.from("cycles").select("*").eq("space_id", spaceId),
      db
        .from("improvement_goals")
        .select("*")
        .eq("space_id", spaceId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from("layer_ontology")
        .select("id")
        .eq("space_id", spaceId),
    ]);

  if (!spaceRes?.data) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const space = spaceRes.data as Space;
  const entities = (entRes.data ?? []) as Entity[];
  const edges = (edgeRes.data ?? []) as Edge[];
  const cycles = (cycleRes.data ?? []) as Cycle[];
  const activeGoal = (goalRes?.data ?? null) as ImprovementGoal | null;
  const layers = (layerRes.data ?? []) as Array<{ id: string }>;

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

  const twinState = computeTwinState(
    space,
    entities,
    edges,
    cycles,
    synthesisData,
    activeGoal,
  );

  const topLeverage =
    synthesisData?.leverage_points?.[0]?.entity_name ?? null;

  // Run the agent. Soft-fail to a polite stub so the UI never sees
  // an opaque 500.
  const recentChangeNote = await computeRecentChangeNote(db, spaceId);
  let summary: string | null = null;
  try {
    const out = await runNarratorAgent({
      spaceName: space.name,
      twinMacro: twinState.macro,
      topLeverageName: topLeverage,
      layerCount: layers.length,
      recentChangeNote,
    });
    summary = out.summary;
  } catch (err) {
    console.warn("[refresh-narrator] agent failed:", err);
    return NextResponse.json(
      { error: "Narrator agent unavailable. Try again in a moment." },
      { status: 502 },
    );
  }

  // Surgical cache patch — preserve everything else in the bundle JSON
  // so the other tabs stay instant. If the cache is missing entirely
  // we skip the write; the next bundle GET will populate it.
  if (cacheRow.twin_dashboard_cache) {
    const next = {
      ...cacheRow.twin_dashboard_cache,
      narrator_summary: summary,
    };
    await db
      .from("spaces")
      .update({
        twin_dashboard_cache: next,
        twin_dashboard_cache_at: new Date().toISOString(),
      })
      .eq("id", spaceId);
  }

  return NextResponse.json({ narrator_summary: summary });
}
