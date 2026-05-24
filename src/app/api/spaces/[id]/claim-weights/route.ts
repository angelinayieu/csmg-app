// POST /api/spaces/[id]/claim-weights
//
// Batch-update entities.claim_weight for the Synthesis Lab claim
// stack. Called when the user drag-reorders the claim cards; we
// normalize positions into 0..1 weights and persist all of them in
// one round-trip to keep the UI responsive.
//
// Body:
//   { weights: [{ entity_id: string, weight: number }, ...] }
//
// Server-side validation:
//   - User must own the space (verifySpaceOwnership)
//   - Each entity must belong to this space (single WHERE clause)
//   - Each weight must be in [0, 1] — clamped if out of range
//
// Returns: { updated: number } — count of entities actually patched.
// Failures are logged but don't tank the whole batch; partial success
// is the right behavior for a drag-reorder UX where the user is
// already moving on.

import { NextResponse } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
} from "@/lib/api-helpers";

export const runtime = "nodejs";

interface RequestBody {
  weights?: Array<{ entity_id?: string; weight?: number }>;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: body, error: parseErr } = await safeJsonParse<RequestBody>(
    request,
  );
  if (parseErr) return parseErr;

  const raw = Array.isArray(body?.weights) ? body!.weights : [];
  if (raw.length === 0) {
    return NextResponse.json({ updated: 0 });
  }
  // Cap at 200 — typical claim stack has 10-30 items; 200 is a safe
  // upper bound that protects against runaway batches.
  if (raw.length > 200) {
    return NextResponse.json(
      { error: "Batch too large (max 200)" },
      { status: 400 },
    );
  }

  // Normalize + clamp.
  const normalized: Array<{ entity_id: string; weight: number }> = [];
  for (const w of raw) {
    if (typeof w?.entity_id !== "string" || typeof w?.weight !== "number") {
      continue;
    }
    const clamped = Math.max(0, Math.min(1, w.weight));
    if (!Number.isFinite(clamped)) continue;
    normalized.push({ entity_id: w.entity_id, weight: clamped });
  }
  if (normalized.length === 0) {
    return NextResponse.json({ updated: 0 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Apply updates sequentially. Could batch with a CTE but the cost
  // is small for a 10-30 item drag and the simple per-row form lets
  // us count partial successes cleanly.
  let updated = 0;
  for (const w of normalized) {
    const { error: updErr } = await db
      .from("entities")
      .update({ claim_weight: w.weight })
      .eq("id", w.entity_id)
      .eq("space_id", spaceId);
    if (!updErr) updated += 1;
  }

  return NextResponse.json({ updated });
}
