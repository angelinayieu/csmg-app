// PATCH /api/edges/[id]
//
// Updates a subset of edge fields. Researcher-mode editing path —
// lets a user override an LLM-extracted edge's relationship type,
// dynamics (response model: linear / hill / emax / threshold / etc),
// polarity, or strength.
//
// Body (all optional, partial updates):
//   {
//     dynamics?: "linear" | "hill" | "emax" | "threshold" |
//                "compounding" | "exponential" | "logarithmic" |
//                "decay" | "step_function" | "delayed",
//     dynamics_properties?: Record<string, unknown>,
//     polarity?: "positive" | "negative" | "neutral" | "conditional",
//     strength?: number (0..1),
//     relationship_type?: string,
//   }
//
// Auth: user must own the edge's space (verified via space_id +
// spaces.user_id).
//
// Response: { edge: <updated row> }

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";

export const runtime = "nodejs";

const VALID_DYNAMICS = [
  "linear",
  "hill",
  "emax",
  "threshold",
  "compounding",
  "exponential",
  "logarithmic",
  "decay",
  "step_function",
  "delayed",
];
const VALID_POLARITY = ["positive", "negative", "neutral", "conditional"];

interface PatchBody {
  dynamics?: string;
  dynamics_properties?: Record<string, unknown>;
  polarity?: string;
  strength?: number;
  relationship_type?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: edgeId } = await params;
  if (!edgeId) {
    return NextResponse.json({ error: "edge id required" }, { status: 400 });
  }
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: body, error: bodyErr } = await safeJsonParse<PatchBody>(request);
  if (bodyErr) return bodyErr;
  if (!body) {
    return NextResponse.json(
      { error: "request body required" },
      { status: 400 },
    );
  }

  // Load the edge to discover its space, then check ownership.
  const { data: edgeRow, error: loadErr } = await db
    .from("edges")
    .select("id, space_id")
    .eq("id", edgeId)
    .maybeSingle();
  if (loadErr || !edgeRow) {
    return NextResponse.json({ error: "Edge not found" }, { status: 404 });
  }
  const spaceId = edgeRow.space_id as string;

  const { data: spaceRow } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!spaceRow || spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Validate + assemble patch payload.
  const patch: Record<string, unknown> = {};
  if (body.dynamics !== undefined) {
    if (!VALID_DYNAMICS.includes(body.dynamics)) {
      return NextResponse.json(
        { error: `dynamics must be one of: ${VALID_DYNAMICS.join(", ")}` },
        { status: 400 },
      );
    }
    patch.dynamics = body.dynamics;
  }
  if (body.dynamics_properties !== undefined) {
    if (
      typeof body.dynamics_properties !== "object" ||
      body.dynamics_properties === null
    ) {
      return NextResponse.json(
        { error: "dynamics_properties must be an object" },
        { status: 400 },
      );
    }
    patch.dynamics_properties = body.dynamics_properties;
  }
  if (body.polarity !== undefined) {
    if (!VALID_POLARITY.includes(body.polarity)) {
      return NextResponse.json(
        { error: `polarity must be one of: ${VALID_POLARITY.join(", ")}` },
        { status: 400 },
      );
    }
    patch.polarity = body.polarity;
  }
  if (body.strength !== undefined) {
    if (
      typeof body.strength !== "number" ||
      !Number.isFinite(body.strength) ||
      body.strength < 0 ||
      body.strength > 1
    ) {
      return NextResponse.json(
        { error: "strength must be a number in [0,1]" },
        { status: 400 },
      );
    }
    patch.strength = body.strength;
  }
  if (body.relationship_type !== undefined) {
    if (
      typeof body.relationship_type !== "string" ||
      body.relationship_type.length > 200
    ) {
      return NextResponse.json(
        { error: "relationship_type must be a string ≤200 chars" },
        { status: 400 },
      );
    }
    patch.relationship_type = body.relationship_type.trim();
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "no updatable fields supplied" },
      { status: 400 },
    );
  }

  const { data: updated, error: updErr } = await db
    .from("edges")
    .update(patch)
    .eq("id", edgeId)
    .select("*")
    .single();
  if (updErr || !updated) {
    return NextResponse.json(
      { error: `Edge update failed: ${updErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ edge: updated });
}
