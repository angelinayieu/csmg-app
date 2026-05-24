// GET /api/spaces/[id]/screens
//
// Returns all generated_screens rows for a space, ordered newest-first.
// Used by the right panel's Screens section to render the gallery.
//
// Optional query params:
//   ?target_kind=app|variation|strategy|twin|intervention|generic
//   ?target_id=<uuid>     — filter to one target's screens
//   ?status=ready|generating|error
//   ?limit=<n>            — default 40, max 100

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export interface ScreenRow {
  id: string;
  space_id: string;
  target_kind: string;
  target_id: string | null;
  target_label: string | null;
  artifact_type: string;
  aspect_ratio: string;
  prompt_brief: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  status: string;
  error_message: string | null;
  generated_at: string | null;
  created_at: string;
}

export interface ScreensListResponse {
  screens: ScreenRow[];
  // Count grouped by target so the right panel can show
  // "Sleep Window Optimizer · 3 screens" without a second query.
  counts_by_target: Record<string, number>; // key = `${target_kind}:${target_id ?? 'none'}`
  total: number;
}

export async function GET(
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

  const url = new URL(request.url);
  const targetKindFilter = url.searchParams.get("target_kind");
  const targetIdFilter = url.searchParams.get("target_id");
  const statusFilter = url.searchParams.get("status");
  const limitRaw = url.searchParams.get("limit");
  const limit = Math.min(100, Math.max(1, parseInt(limitRaw ?? "40", 10) || 40));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let q = db
    .from("generated_screens")
    .select(
      "id, space_id, target_kind, target_id, target_label, artifact_type, aspect_ratio, prompt_brief, image_url, thumbnail_url, status, error_message, generated_at, created_at",
    )
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (targetKindFilter) q = q.eq("target_kind", targetKindFilter);
  if (targetIdFilter) q = q.eq("target_id", targetIdFilter);
  if (statusFilter) q = q.eq("status", statusFilter);

  const { data, error } = (await q) as {
    data: ScreenRow[] | null;
    error: { message: string } | null;
  };
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const screens = data ?? [];

  // Build counts_by_target.
  const counts_by_target: Record<string, number> = {};
  for (const s of screens) {
    const key = `${s.target_kind}:${s.target_id ?? "none"}`;
    counts_by_target[key] = (counts_by_target[key] ?? 0) + 1;
  }

  return NextResponse.json<ScreensListResponse>({
    screens,
    counts_by_target,
    total: screens.length,
  });
}
