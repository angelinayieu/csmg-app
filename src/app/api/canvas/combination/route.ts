// ── Canvas combination interpretation ──
//
// POST /api/canvas/combination
//   body: { spaceId, entityIds: [string, string, ...] }
//   → CombinationResult
//
// Thin HTTP wrapper around runCanvasCombination (src/lib/canvas/combination.ts).
// All LLM logic lives in the helper so the strategizer's intervention_combination
// executor can call the same code path without an HTTP roundtrip.
//
// Max 4 entities at once to keep the prompt lean. If fewer than 2 are
// provided, returns 400.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage, verifySpaceOwnership } from "@/lib/api-helpers";
import { runCanvasCombination } from "@/lib/canvas/combination";

export const maxDuration = 25;

interface CombinationRequest {
  spaceId: string;
  entityIds: string[];
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<CombinationRequest>(request);
  if (parseError) return parseError;

  const { spaceId, entityIds } = body;
  if (typeof spaceId !== "string" || !Array.isArray(entityIds) || entityIds.length < 2) {
    return NextResponse.json(
      { error: "spaceId + entityIds[2..4] required" },
      { status: 400 },
    );
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  try {
    const result = await runCanvasCombination(db, entityIds);
    if (!result) {
      return NextResponse.json({ error: "Entities not found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.warn("[canvas/combination]", err);
    return NextResponse.json(
      { error: `Combination failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
