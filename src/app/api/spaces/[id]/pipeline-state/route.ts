// GET /api/spaces/[id]/pipeline-state
//
// Returns the live status of each of the 12 operational pipeline
// phases for a space. Used by:
//   - /app/space/[id]/timeline (server page renders this on load)
//   - Future SSE/polling client surfaces that want to refresh state
//     without a full page reload.
//
// Response shape:
//   { phases: PhaseLiveState[], space_id: string, fetched_at: string }
//
// All status derivation lives in lib/pipeline/derive-pipeline-state.ts
// so the server page can call the same function directly without
// paying for an HTTP roundtrip to its own API.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";
import {
  derivePipelineState,
  type PipelineStateResponse,
} from "@/lib/pipeline/derive-pipeline-state";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const owns = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    const phases = await derivePipelineState(db, spaceId);
    const response: PipelineStateResponse = {
      phases,
      space_id: spaceId,
      fetched_at: new Date().toISOString(),
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error("[pipeline-state] derive failed:", err);
    return NextResponse.json(
      {
        error: `Failed to derive pipeline state: ${
          err instanceof Error ? err.message : "unknown"
        }`,
      },
      { status: 500 },
    );
  }
}
