// ── GET /api/spaces/[id]/preflight ────────────────────────────────────
//
// Returns the full PreflightView for a space — the scientist's contract
// surface before downstream pipeline runs. Pure read; the aggregator
// is defensive against partial schema, so this works against the
// current DB even before all EnvironmentDefinition migrations land.
//
// Query params:
//   ?subject={subject_id}           anchor to a specific persona
//   ?include_preview=false          skip the M1+M2+M3 mediator preview
//                                   (faster; useful for refresh polls)
//
// Owner-only auth via safeAuth.
//
// Status semantics:
//   200 — preflight returned
//   401 — not authenticated
//   404 — space not found OR user doesn't own it
//   500 — unexpected internal error

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { loadPreflightView } from "@/lib/preflight/load-preflight";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const subjectId = url.searchParams.get("subject");
  const includePreview = url.searchParams.get("include_preview") !== "false";

  const result = await loadPreflightView({
    db: supabase,
    space_id: spaceId,
    subject_id: subjectId,
    user_id: user.id,
    include_mediator_preview: includePreview,
  });

  if (!result.ok) {
    if (result.reason === "space_not_found" || result.reason === "not_authorized") {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: "Failed to load preflight", detail: result.detail ?? null },
      { status: 500 },
    );
  }

  return NextResponse.json(result.preflight);
}
