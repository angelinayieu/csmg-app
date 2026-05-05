// ── POST /api/pipeline/extract-subsystems ─────────────────────────────
//
// Extracts typed compositional subsystems from synthesis output and
// persists them to spaces.synthesis_data.subsystems[]. A subsystem is
// a recognizable functional unit composed of entities + edges + cycles
// + axioms — e.g. "the onboarding feedback loop", "the retention
// bottleneck cluster", "the L4 working-memory invariant chain".
//
// Two-stage pipeline:
//   1. Deterministic skeleton extraction (loops, leverage neighborhoods,
//      tension zones, L4 invariants, insight convergences, master
//      bottleneck) → merge overlapping → rank by structural_value
//   2. Single batched LLM call to name the skeletons and fill contracts
//      (does/needs/produces). LLM cannot add or remove constituents.
//
// Temporal slot in the synthesize handoff chain:
//   synthesize → audit-edges → [THIS ENDPOINT] → root-trace →
//     materialize-signatures → space-strategizer → strategy-refresh
//
// Strategy-refresh consumes synthesis_data.subsystems as constraint-
// bearing units (every micro_tactic must name a target subsystem).
// Soft-fail: if this hop dies, strategy generation falls back to flat
// finding lists.
//
// Gated behind ENABLE_SUBSYSTEMS_EXTRACTION. With the flag off, the
// route returns { subsystems: [], skipped: "feature_disabled" } with
// no DB reads or writes. Old syntheses without the field are handled
// downstream by treating subsystems as an empty array.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { extractSubsystems } from "@/lib/subsystems/extract";
import { ENABLE_SUBSYSTEMS_EXTRACTION } from "@/lib/feature-flags/subsystems";
import type { SynthesisData } from "@/types/synthesis";
import type { Cycle, Entity, Edge } from "@/types";

export const maxDuration = 90;
export const runtime = "nodejs";

interface ExtractSubsystemsRequest {
  space_id: string;
  run_id?: string | null;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<Partial<ExtractSubsystemsRequest>>(request);
  if (parseError) return parseError;

  const spaceId = body?.space_id;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json(
      { error: "space_id is required" },
      { status: 400 },
    );
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  if (!ENABLE_SUBSYSTEMS_EXTRACTION) {
    return NextResponse.json({
      space_id: spaceId,
      run_id: body?.run_id ?? null,
      subsystems: [],
      skipped: "feature_disabled",
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const startedAt = Date.now();

  try {
    const [
      { data: spaceRow },
      { data: entityRows },
      { data: edgeRows },
      { data: cycleRows },
    ] = await Promise.all([
      db.from("spaces").select("synthesis_data").eq("id", spaceId).single(),
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("edges").select("*").eq("space_id", spaceId),
      db.from("cycles").select("*").eq("space_id", spaceId),
    ]);

    const synthRaw = spaceRow?.synthesis_data;
    const synthData = (
      typeof synthRaw === "string" ? JSON.parse(synthRaw) : synthRaw
    ) as SynthesisData | null;

    if (!synthData) {
      return NextResponse.json({
        space_id: spaceId,
        run_id: body?.run_id ?? null,
        subsystems: [],
        skipped: "no_synthesis",
      });
    }

    const subsystems = await extractSubsystems({
      synthesis: synthData,
      entities: (entityRows ?? []) as Entity[],
      edges: (edgeRows ?? []) as Edge[],
      cycles: (cycleRows ?? []) as Cycle[],
    });

    // Re-read defensively — concurrent stages (memory write-back, etc.)
    // may have touched synthesis_data between our initial read and now.
    const { data: fresh } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .single();
    const freshSynth = (
      typeof fresh?.synthesis_data === "string"
        ? JSON.parse(fresh.synthesis_data)
        : (fresh?.synthesis_data ?? {})
    ) as Record<string, unknown>;

    await db
      .from("spaces")
      .update({ synthesis_data: { ...freshSynth, subsystems } })
      .eq("id", spaceId);

    return NextResponse.json({
      space_id: spaceId,
      run_id: body?.run_id ?? null,
      subsystems,
      count: subsystems.length,
      duration_ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error("[extract-subsystems] failed:", err);
    return NextResponse.json(
      { error: `Subsystem extraction failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
