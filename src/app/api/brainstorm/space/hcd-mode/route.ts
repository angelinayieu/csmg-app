// ── GET + POST /api/brainstorm/space/hcd-mode ─────────────────────
//
// Phase 11 — Human-Centered Design toggle. Flips a boolean stored at
// spaces.synthesis_data.objective_canvas.hcd_mode. When true, sub-
// objective propose generation gets an HCD bias mixin (see
// decompose-prompt.ts) that pushes proposals toward user-role-
// grounded, prototypable framings.
//
// Body for POST: { spaceId, enabled: boolean }
//
// Storage decision: lives in the existing objective_canvas state
// slice (alongside stage + clarifying) so reads happen in the same
// pass that already loads canvas state — no extra DB round trip
// during generation routes.
//
// Logs `constraints_set` with metadata { hcd_mode } so the Lab
// Notebook records the toggle as a curatorial moment. (Re-using
// constraints_set rather than minting a new action keeps the
// notebook's "Updated constraints" label coherent for the user.)

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  patchObjectiveCanvasState,
  readObjectiveCanvasState,
} from "@/lib/objective-canvas/clarifying-state";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";

interface PostBody {
  spaceId?: string;
  enabled?: boolean;
}

export async function GET(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const spaceId = req.nextUrl.searchParams.get("spaceId") ?? "";
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const state = readObjectiveCanvasState(space.synthesis_data);
  return NextResponse.json({ hcd_mode: state.hcd_mode === true });
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<PostBody>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  const enabled = body?.enabled === true;
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id, synthesis_data")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const state = readObjectiveCanvasState(space.synthesis_data);
  const nextSynth = patchObjectiveCanvasState(space.synthesis_data, {
    stage: state.stage,
    clarifying: state.clarifying,
    hcd_mode: enabled,
  });

  const writeRes = await db
    .from("spaces")
    .update({ synthesis_data: nextSynth })
    .eq("id", spaceId);
  if (writeRes.error) {
    return NextResponse.json(
      { error: "persist failed", detail: writeRes.error.message },
      { status: 500 },
    );
  }

  // Log the toggle so the Lab Notebook reflects intent shifts. Re-uses
  // constraints_set action; metadata.hcd_mode differentiates from
  // OperationalConstraints writes (which carry constraints_summary).
  void logDecision(db, {
    userId: auth.user.id,
    spaceId,
    subObjectiveId: null,
    action: "constraints_set",
    metadata: {
      constraints_summary: enabled ? "HCD bias: on" : "HCD bias: off",
      hcd_mode: enabled,
    },
  });

  return NextResponse.json({ hcd_mode: enabled });
}
