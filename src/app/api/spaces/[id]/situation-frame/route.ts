// GET /api/spaces/[id]/situation-frame
//
// Returns the persisted SituationFrame for a space (output of the
// frame-panel stage, stored on spaces.situation_frame). Used by canvas
// chrome — shell shapes consume `axes[].target_cells` joined with
// `cells[].supporting_lenses` to render lens attribution, and the
// divergence strip reads `divergences[]` + `candidate_framings[]` to
// surface disagreement.
//
// Soft-fail: legacy spaces with no frame return { frame: null } with 200
// (not 404) so the canvas can branch on absence without treating it as
// an error. Schema validation is intentionally light — the frame is
// versioned (`version: 1`) and the writer is the only producer, so we
// pass through and let the client narrow.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import type { SituationFrame } from "@/types/situation-frame";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface SituationFrameResponse {
  frame: SituationFrame | null;
}

export async function GET(_request: Request, { params }: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data, error } = await db
    .from("spaces")
    .select("situation_frame")
    .eq("id", spaceId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to load situation frame" },
      { status: 500 },
    );
  }

  const raw = (data as { situation_frame: unknown } | null)?.situation_frame ?? null;
  const frame = raw && typeof raw === "object" ? (raw as SituationFrame) : null;

  return NextResponse.json<SituationFrameResponse>({ frame });
}
