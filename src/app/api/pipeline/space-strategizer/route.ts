// POST /api/pipeline/space-strategizer
//
// Produces a SpacePlan for a given space: the strategizer's decision
// about which probability-space work to execute next, under a token
// budget. Plan + work queue rows are persisted; executors read from
// the queue asynchronously (not by this endpoint).
//
// This endpoint does NOT execute the plan. It only plans. That
// separation is important: the plan is a standalone audit artifact,
// and the user (or a downstream orchestrator) decides whether to
// actually carry it out. If executors were wired here, a bad plan
// would burn tokens before anyone could veto it.
//
// GET /api/pipeline/space-strategizer?space_id=...
//   returns the most recent plan for the space (lightweight — no
//   candidates_considered to keep the response small).

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { runSpaceStrategizer } from "@/lib/pipeline/space-strategizer";
import type { SpacePlanRequest } from "@/types/space-plan";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;
  const req = (body ?? {}) as Partial<SpacePlanRequest>;

  if (!req.space_id || typeof req.space_id !== "string") {
    return NextResponse.json({ error: "space_id is required" }, { status: 400 });
  }
  if (typeof req.budget_tokens !== "number" || req.budget_tokens < 500) {
    return NextResponse.json(
      { error: "budget_tokens is required and must be ≥ 500" },
      { status: 400 },
    );
  }

  // Ownership check via the space row — mirrors other pipeline routes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: spaceRow } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", req.space_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!spaceRow) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const request_normalized: SpacePlanRequest = {
    space_id: req.space_id,
    run_id: req.run_id ?? null,
    budget_tokens: req.budget_tokens,
    max_items: typeof req.max_items === "number" ? req.max_items : 8,
    shortlist_size: typeof req.shortlist_size === "number" ? req.shortlist_size : 20,
    score_floor: typeof req.score_floor === "number" ? req.score_floor : 0.35,
    min_kind_diversity: typeof req.min_kind_diversity === "number" ? req.min_kind_diversity : 2,
    weight_overrides: req.weight_overrides,
    focal_goal_entity_id: req.focal_goal_entity_id ?? null,
  };

  try {
    const result = await runSpaceStrategizer(db, user.id, request_normalized);
    if (!result) {
      return NextResponse.json(
        { error: "Could not load space graph for strategizer" },
        { status: 500 },
      );
    }
    return NextResponse.json({
      plan: result.plan,
      persisted: result.persisted,
      invariant_violations: result.invariant_violations,
      retried: result.retried,
    });
  } catch (err) {
    console.error("[space-strategizer POST] threw:", err);
    return NextResponse.json(
      {
        error: "Strategizer failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("space_id");
  if (!spaceId) {
    return NextResponse.json({ error: "space_id is required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("space_plans")
    .select("id, space_id, run_id, generated_at, budget_tokens, budget_headroom, planner_model, planner_temperature, plan_document")
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[space-strategizer GET] query failed:", error);
    return NextResponse.json({ error: "Failed to load plan" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ plan: null });
  }
  return NextResponse.json({ plan: data });
}
