// GET  /api/lab/calibration?space_id=<uuid>
// POST /api/lab/calibration/bypass     — body: { space_id }
//
// Gap B — the simulation lab's gatekeeper.
//
// GET returns the most-recent RealityCalibration row for the space's
// latest strategy_baseline. The CalibrationStatusStrip consumes the
// `{ summary, attempts, bypassed_at }` envelope so it can render the
// right tone + ratio pill + review-gaps drawer.
//
// POST /bypass flips `bypassed_at` / `bypassed_by` on the latest row.
// The status-coherence trigger in 20260529_reality_calibration.sql
// preserves the `bypassed` state across recomputes, so this survives
// the next background calibration pass. The user can clear a bypass
// by letting a fresh calibration recompute and passing — the
// orchestrator resets bypassed_at when a row flips to `calibrated`.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { summarizeCalibration } from "@/types/simulation-mode";
import type {
  RealityCalibration,
  ReproductionAttempt,
} from "@/types/calibration";

interface CalibrationRow {
  id: string;
  strategy_baseline_id: string;
  space_id: string;
  status: RealityCalibration["status"];
  reproduced_count: number;
  total_count: number;
  aggregate_score: number;
  attempts: ReproductionAttempt[];
  agent_version: number;
  bypassed_at: string | null;
  bypassed_by: string | null;
  computed_at: string;
}

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("space_id");
  if (!spaceId) {
    return NextResponse.json(
      { error: "space_id is required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership guard — RLS will also filter, but an explicit 403 reads
  // better than an empty result.
  const { data: space } = await db
    .from("spaces")
    .select("id")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!space) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Most recent row wins. We key by computed_at desc (not by
  // strategy_baseline_id's creation order) so a late-landing
  // recalibration on an older baseline still surfaces.
  const { data: row } = (await db
    .from("reality_calibrations")
    .select(
      "id, strategy_baseline_id, space_id, status, reproduced_count, total_count, aggregate_score, attempts, agent_version, bypassed_at, bypassed_by, computed_at",
    )
    .eq("space_id", spaceId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: CalibrationRow | null };

  if (!row) {
    // No calibration ever run — send back an "unknown" envelope so
    // the strip has a concrete object to render without branching on
    // null. Same shape as a real row.
    return NextResponse.json({
      summary: summarizeCalibration(0, 0),
      attempts: [],
      bypassed_at: null,
      computed_at: null,
      strategy_baseline_id: null,
    });
  }

  const summary = summarizeCalibration(
    row.reproduced_count,
    row.total_count,
    !!row.bypassed_at,
  );
  // Collect unique blocker entity_ids across off+unverifiable attempts
  // so the strip's "review gaps" drawer has a quick chip list.
  const blockerSet = new Set<string>();
  for (const a of row.attempts ?? []) {
    if (a.verdict === "reproduced") continue;
    for (const id of a.blocker_entity_ids ?? []) blockerSet.add(id);
  }

  return NextResponse.json({
    summary: {
      ...summary,
      blockerEntityIds: Array.from(blockerSet),
    },
    attempts: row.attempts ?? [],
    bypassed_at: row.bypassed_at,
    computed_at: row.computed_at,
    strategy_baseline_id: row.strategy_baseline_id,
    aggregate_score: row.aggregate_score,
  });
}

// ── Bypass escape hatch ─────────────────────────────────────────────────
//
// POST { space_id, bypass: true | false }
//   - true:  sets bypassed_at = now(), bypassed_by = user.id
//   - false: clears both (user changed their mind before recomputing)
//
// Keeping this on the same route (via method discrimination) so the
// client only has to remember one path. If the shape grows we'll split
// into /api/lab/calibration/bypass.

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const body = (await request.json().catch(() => ({}))) as {
    space_id?: string;
    bypass?: boolean;
  };
  if (!body.space_id) {
    return NextResponse.json(
      { error: "space_id is required" },
      { status: 400 },
    );
  }
  const wantBypass = body.bypass !== false; // default true

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: space } = await db
    .from("spaces")
    .select("id")
    .eq("id", body.space_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!space) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: row } = (await db
    .from("reality_calibrations")
    .select("id, status")
    .eq("space_id", body.space_id)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: { id: string; status: string } | null };
  if (!row) {
    return NextResponse.json(
      { error: "No calibration to bypass yet" },
      { status: 404 },
    );
  }

  const patch = wantBypass
    ? {
        bypassed_at: new Date().toISOString(),
        bypassed_by: user.id,
        status: "bypassed",
      }
    : {
        bypassed_at: null,
        bypassed_by: null,
        // Trigger will re-derive `status` from the counts on next update.
        // Setting to a sentinel the trigger will immediately overwrite.
        status: "partial",
      };

  const { error } = await db
    .from("reality_calibrations")
    .update(patch)
    .eq("id", row.id);
  if (error) {
    return NextResponse.json(
      { error: `Bypass update failed: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, bypassed: wantBypass });
}
