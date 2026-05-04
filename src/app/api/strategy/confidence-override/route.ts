// POST /api/strategy/confidence-override
//   Body: {
//     space_id: string,
//     strategy_generated_at: string (ISO),
//     ai_composite_score: number (0-100),
//     user_score: number (0-100),
//     user_direction: 'lower' | 'similar' | 'higher',
//     reason?: string
//   }
//   Inserts a row into strategy_confidence_overrides. Append-only — multiple
//   rows per (space, generation) are allowed; the latest one is the active
//   override. RLS enforces owner-only on both read and write.
//
// GET  /api/strategy/confidence-override?space_id=…&strategy_generated_at=…
//   Returns the latest override for this (space, generation), or null.
//   Used by the drawer to pre-fill the override widget on mount.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, safeJsonParse } from "@/lib/api-helpers";

export const maxDuration = 10;

export interface ConfidenceOverrideRow {
  id: string;
  space_id: string;
  user_id: string;
  strategy_generated_at: string;
  ai_composite_score: number;
  user_score: number;
  user_direction: "lower" | "similar" | "higher";
  reason: string | null;
  created_at: string;
}

interface PostBody {
  space_id?: string;
  strategy_generated_at?: string;
  ai_composite_score?: number;
  user_score?: number;
  user_direction?: string;
  reason?: string;
}

function clampScore(n: unknown): number | null {
  if (typeof n !== "number" || Number.isNaN(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<PostBody>(request);
  if (parseError) return parseError;

  const spaceId = body?.space_id;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "space_id is required" }, { status: 400 });
  }
  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const generatedAt = body?.strategy_generated_at;
  if (!generatedAt || typeof generatedAt !== "string" || Number.isNaN(Date.parse(generatedAt))) {
    return NextResponse.json(
      { error: "strategy_generated_at must be a valid ISO timestamp" },
      { status: 400 },
    );
  }

  const aiScore = clampScore(body?.ai_composite_score);
  const userScore = clampScore(body?.user_score);
  if (aiScore === null || userScore === null) {
    return NextResponse.json(
      { error: "ai_composite_score and user_score must be numbers 0-100" },
      { status: 400 },
    );
  }

  const direction = body?.user_direction;
  if (direction !== "lower" && direction !== "similar" && direction !== "higher") {
    return NextResponse.json(
      { error: "user_direction must be one of: lower, similar, higher" },
      { status: 400 },
    );
  }

  const reason =
    typeof body?.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 1000) // hard cap; defensive
      : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: inserted, error } = (await db
    .from("strategy_confidence_overrides")
    .insert({
      space_id: spaceId,
      user_id: user.id,
      strategy_generated_at: generatedAt,
      ai_composite_score: aiScore,
      user_score: userScore,
      user_direction: direction,
      reason,
    })
    .select("*")
    .single()) as { data: ConfidenceOverrideRow | null; error: unknown };

  if (error || !inserted) {
    console.error("[confidence-override POST] insert failed:", error);
    return NextResponse.json({ error: "Failed to save override" }, { status: 500 });
  }
  return NextResponse.json({ override: inserted });
}

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const spaceId = searchParams.get("space_id");
  const generatedAt = searchParams.get("strategy_generated_at");
  if (!spaceId) {
    return NextResponse.json({ error: "space_id is required" }, { status: 400 });
  }

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let query = db
    .from("strategy_confidence_overrides")
    .select("*")
    .eq("space_id", spaceId)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1);
  if (generatedAt) query = query.eq("strategy_generated_at", generatedAt);

  const { data: rows } = (await query) as { data: ConfidenceOverrideRow[] | null };
  return NextResponse.json({ override: rows?.[0] ?? null });
}
