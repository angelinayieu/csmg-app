// POST /api/ingest/[assetId]/skip
//
// HITL extraction-checklist flow phase 2 alternative path. The user
// dismissed the review drawer without selecting any candidates —
// flip extraction_status to 'skipped' so the asset card stops
// showing the "Review N candidates" badge. The cached preview stays
// in extraction_preview so the user can reopen the drawer later if
// they change their mind (in which case the status flips back to
// 'previewed' on the next /preview call).
//
// No body required.
//
// Response: { asset_id, extraction_status: "skipped" }
//
// Auth: asset owner.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
} from "@/lib/api-helpers";

export const maxDuration = 10;
export const runtime = "nodejs";

interface AssetRow {
  id: string;
  user_id: string;
  space_id: string | null;
  extraction_status: string | null;
}

// Next 16 generates a stricter route-handler validator that expects
// the request param to be NextRequest (not the global Request). The
// previous `_request: Request` signature triggered TS2344 in
// .next/dev/types/validator.ts. Wider types are tolerated for the
// context.params, but the request slot must match exactly.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: asset, error: assetErr } = (await db
    .from("ingested_files")
    .select("id, user_id, space_id, extraction_status")
    .eq("id", assetId)
    .maybeSingle()) as { data: AssetRow | null; error: { message?: string } | null };

  if (assetErr || !asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
  if (asset.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (asset.space_id) {
    const owns = await verifySpaceOwnership(supabase, asset.space_id, user.id);
    if (!owns) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
  }

  // Idempotent: already-extracted assets ignore /skip (it's a no-op
  // semantically — the user already committed). The drawer shouldn't
  // be reachable for extracted assets but defending against it.
  if (asset.extraction_status === "extracted") {
    return NextResponse.json({
      asset_id: assetId,
      extraction_status: "extracted",
      noop: true,
    });
  }

  await db
    .from("ingested_files")
    .update({ extraction_status: "skipped" })
    .eq("id", assetId);

  return NextResponse.json({
    asset_id: assetId,
    extraction_status: "skipped",
  });
}
