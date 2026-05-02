// ── /api/spaces/[id]/pin-summary ─────────────────────────────────────
//
// GET    → list all pinned syntheses for this space
//          (returns { pins: PinnedSummary[] }, newest first).
// POST   → append a SummaryCardShape's contents to
//          `space.synthesis_data.pinned_summaries[]`. Idempotent on
//          summaryId — re-pinning the same summaryId replaces the
//          existing entry (useful after Regenerate-then-Pin).
// DELETE → remove a pin by summaryId
//          (?summaryId=<id> query param).
//
// The endpoint is the canonical store: the canvas-side `meta.pinned`
// flag is cosmetic-only. Pins survive shape deletion and reload.
//
// We deliberately store the snapshot at pin-time (title + body +
// sourceCount + sourceLabel + generatedAt). Re-reading the live
// shape isn't reliable — the user might delete the card, and we
// want pins to outlive their canvas representation.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
} from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

interface IncomingBody {
  summaryId?: string;
  title?: string;
  body?: string;
  sourceCount?: number;
  sourceLabel?: string;
  generatedAt?: string;
}

interface PinnedSummary {
  summaryId: string;
  title: string;
  body: string;
  sourceCount: number;
  sourceLabel: string;
  generatedAt: string;
  pinnedAt: string;
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const parsed = await safeJsonParse<IncomingBody>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  if (
    !body.summaryId ||
    typeof body.summaryId !== "string" ||
    typeof body.title !== "string" ||
    typeof body.body !== "string"
  ) {
    return NextResponse.json(
      { error: "summaryId, title, body required" },
      { status: 400 },
    );
  }

  const newPin: PinnedSummary = {
    summaryId: body.summaryId,
    title: body.title.slice(0, 200),
    body: body.body.slice(0, 4000),
    sourceCount: typeof body.sourceCount === "number" ? body.sourceCount : 0,
    sourceLabel: typeof body.sourceLabel === "string" ? body.sourceLabel.slice(0, 200) : "",
    generatedAt:
      typeof body.generatedAt === "string"
        ? body.generatedAt
        : new Date().toISOString(),
    pinnedAt: new Date().toISOString(),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: spaceRow, error: readErr } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readErr) {
    console.warn("[pin-summary] read failed:", readErr);
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }

  const synthesisData =
    (spaceRow?.synthesis_data as Record<string, unknown> | null) ?? {};
  const existingPins = Array.isArray(synthesisData.pinned_summaries)
    ? (synthesisData.pinned_summaries as PinnedSummary[])
    : [];

  // Idempotent: replace if same summaryId already pinned.
  const filtered = existingPins.filter((p) => p.summaryId !== newPin.summaryId);
  const updatedPins = [newPin, ...filtered].slice(0, 100); // hard cap

  const { error: writeErr } = await db
    .from("spaces")
    .update({
      synthesis_data: {
        ...synthesisData,
        pinned_summaries: updatedPins,
      },
    })
    .eq("id", spaceId)
    .eq("user_id", user.id);

  if (writeErr) {
    console.warn("[pin-summary] write failed:", writeErr);
    return NextResponse.json({ error: writeErr.message }, { status: 500 });
  }

  return NextResponse.json({
    pinned: newPin,
    totalPins: updatedPins.length,
  });
}

// ── GET ──────────────────────────────────────────────────────────────

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: spaceRow, error } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    console.warn("[pin-summary] list failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const synthesisData =
    (spaceRow?.synthesis_data as Record<string, unknown> | null) ?? {};
  const pins = Array.isArray(synthesisData.pinned_summaries)
    ? (synthesisData.pinned_summaries as PinnedSummary[])
    : [];

  // Sort newest-first by pinnedAt (defensive — POST already inserts at
  // the head, but JSONB serialization order isn't guaranteed across
  // updates).
  const sorted = [...pins].sort(
    (a, b) =>
      new Date(b.pinnedAt ?? 0).getTime() - new Date(a.pinnedAt ?? 0).getTime(),
  );

  return NextResponse.json({ pins: sorted });
}

// ── DELETE ───────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const summaryId = new URL(request.url).searchParams.get("summaryId");
  if (!summaryId) {
    return NextResponse.json(
      { error: "summaryId query parameter required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: spaceRow, error: readErr } = await db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", spaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (readErr) {
    console.warn("[pin-summary] read for delete failed:", readErr);
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }

  const synthesisData =
    (spaceRow?.synthesis_data as Record<string, unknown> | null) ?? {};
  const existingPins = Array.isArray(synthesisData.pinned_summaries)
    ? (synthesisData.pinned_summaries as PinnedSummary[])
    : [];

  const filtered = existingPins.filter((p) => p.summaryId !== summaryId);
  const removed = existingPins.length - filtered.length;

  if (removed === 0) {
    return NextResponse.json({ removed: 0, totalPins: filtered.length });
  }

  const { error: writeErr } = await db
    .from("spaces")
    .update({
      synthesis_data: { ...synthesisData, pinned_summaries: filtered },
    })
    .eq("id", spaceId)
    .eq("user_id", user.id);

  if (writeErr) {
    console.warn("[pin-summary] delete write failed:", writeErr);
    return NextResponse.json({ error: writeErr.message }, { status: 500 });
  }

  return NextResponse.json({ removed, totalPins: filtered.length });
}
