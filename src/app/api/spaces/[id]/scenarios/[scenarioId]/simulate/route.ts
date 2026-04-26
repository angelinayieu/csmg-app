// ── /api/spaces/[id]/scenarios/[scenarioId]/simulate ─────────────────
//
// R5 Phase A — before/after MC lift on a frozen baseline.
//
//   POST /api/spaces/[id]/scenarios/[scenarioId]/simulate
//   Body: { target_entity_id: string, iterations?: number,
//           depth_hops?: number, integrator?: "discrete" | "ode_rk4" }
//
// Runs simulateEntityChain TWICE against the scenario's parent
// snapshot:
//   1. BASELINE — snapshot only (no scenario applied)
//   2. VARIANT  — snapshot + scenario.action_list replayed
//
// Both use the SAME seed (12347 default) so Gaussian noise cancels
// and the p50 delta is pure structural lift from the intervention.
// Flips scenario.status to "testing" on first call (caller triggered
// an actual test). Returns full distributions + lift metrics so the
// UI can render the before/after chart without a second roundtrip.
//
// This is the functional heart of R5 Phase A. Without it the scenario
// primitive is decorative — a place to store action lists but not a
// way to actually test them.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { simulateEntityChain } from "@/lib/simulation/simulate-entity-chain";
import type { Scenario } from "@/types/scenario";

export const dynamic = "force-dynamic";
// Long MC runs + two passes — give the lambda room.
export const maxDuration = 60;

interface Ctx {
  params: Promise<{ id: string; scenarioId: string }>;
}

interface SimulateBody {
  target_entity_id?: unknown;
  iterations?: unknown;
  depth_hops?: unknown;
  seed?: unknown;
  integrator?: unknown;
}

const DEFAULT_SEED = 12347;
const DEFAULT_ITERATIONS = 400;

export async function POST(request: NextRequest, ctx: Ctx) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;
  const { id: spaceId, scenarioId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Load + ownership check ────────────────────────────────────
  const { data: scenarioData } = await db
    .from("scenarios")
    .select("*")
    .eq("id", scenarioId)
    .maybeSingle();
  if (!scenarioData) {
    return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
  }
  const scenario = scenarioData as Scenario;
  if (scenario.space_id !== spaceId) {
    return NextResponse.json(
      { error: "Scenario belongs to a different space" },
      { status: 400 },
    );
  }
  if (scenario.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Parse body ────────────────────────────────────────────────
  const body = (await request.json().catch(() => ({}))) as SimulateBody;
  const targetEntityId =
    typeof body.target_entity_id === "string" &&
    body.target_entity_id.trim().length > 0
      ? body.target_entity_id.trim()
      : null;
  if (!targetEntityId) {
    return NextResponse.json(
      { error: "target_entity_id is required" },
      { status: 400 },
    );
  }
  const iterations =
    typeof body.iterations === "number" &&
    Number.isFinite(body.iterations) &&
    body.iterations > 0
      ? Math.min(2000, Math.floor(body.iterations))
      : DEFAULT_ITERATIONS;
  const depthHops =
    typeof body.depth_hops === "number" &&
    Number.isFinite(body.depth_hops) &&
    body.depth_hops > 0
      ? Math.min(6, Math.floor(body.depth_hops))
      : 3;
  const seed =
    typeof body.seed === "number" && Number.isFinite(body.seed)
      ? Math.floor(body.seed)
      : DEFAULT_SEED;
  const integrator =
    body.integrator === "ode_rk4" ? "ode_rk4" : undefined;

  // ── Run baseline MC (snapshot only, no scenario) ──────────────
  const baseline = await simulateEntityChain(db, {
    spaceId,
    targetEntityId,
    snapshotId: scenario.parent_snapshot_id,
    iterations,
    depthHops,
    seed,
    ...(integrator ? { integrator } : {}),
  });
  if (baseline.error !== null || !baseline.targetDistribution) {
    return NextResponse.json(
      {
        error: `baseline MC failed: ${baseline.error ?? "no distribution"}`,
      },
      { status: 500 },
    );
  }

  // ── Run variant MC (snapshot + scenario) ──────────────────────
  const variant = await simulateEntityChain(db, {
    spaceId,
    targetEntityId,
    snapshotId: scenario.parent_snapshot_id,
    scenarioId,
    iterations,
    depthHops,
    seed,
    ...(integrator ? { integrator } : {}),
  });
  if (variant.error !== null || !variant.targetDistribution) {
    return NextResponse.json(
      {
        error: `variant MC failed: ${variant.error ?? "no distribution"}`,
      },
      { status: 500 },
    );
  }

  // ── Compute lift ──────────────────────────────────────────────
  const baselineP50 = baseline.targetDistribution.p50;
  const variantP50 = variant.targetDistribution.p50;
  const liftAbsolute = variantP50 - baselineP50;
  const liftPct = liftAbsolute / Math.max(Math.abs(baselineP50), 0.01);

  // ── Flip scenario.status to "testing" if still draft ──────────
  // First simulate call = user actually tested. Subsequent calls
  // leave status alone (testing → testing is a no-op).
  if (scenario.status === "draft") {
    try {
      await db
        .from("scenarios")
        .update({ status: "testing" })
        .eq("id", scenarioId);
    } catch (err) {
      console.warn("[scenarios/simulate] status flip failed (non-fatal):", err);
    }
  }

  return NextResponse.json({
    scenarioId,
    snapshotId: scenario.parent_snapshot_id,
    targetEntityId,
    iterations,
    seed,
    integrator: integrator ?? "discrete",
    baseline: baseline.targetDistribution,
    variant: variant.targetDistribution,
    lift: {
      absolute: liftAbsolute,
      pct: liftPct,
      direction: liftAbsolute > 0 ? "up" : liftAbsolute < 0 ? "down" : "flat",
    },
    sampleCount: iterations,
    gateDecisions: {
      baseline: baseline.gateDecisions,
      variant: variant.gateDecisions,
    },
  });
}
