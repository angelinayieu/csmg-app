// ── POST /api/brainstorm/space/[spaceId]/autopilot/start ──────────
//
// Phase 11.0a — canvas-wide autopilot trigger. Returns the work list
// the client iterates (per-room feature ids) and logs ONE parent
// autopilot_run event with scope="canvas" so the Lab Notebook can
// render the whole session as a single header. The per-chain
// score / rd_iterate events fired by the existing routes during the
// loop get visually grouped under this parent by timestamp.
//
// Body: {} — no inputs needed; targets all rooms in the space that
//            have generated entities. (Could later accept a filter
//            { subObjectiveIds?: string[] } if we want partial runs.)
//
// Returns: {
//   targets: Array<{
//     subObjectiveId, subObjectiveTitle, featureIds[]
//   }>,
//   totalChainCount: number,
// }
//
// The actual score+refine loop stays client-side in
// CanvasAutopilotRunner — same pattern as the per-room
// AutopilotRunner. This route is the audit-log header, not the
// orchestrator.

import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { logDecision } from "@/lib/objective-canvas/decision-log";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ spaceId: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { spaceId } = await ctx.params;
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Ownership.
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space || space.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Load all non-root sub-objectives for this space that have at least
  // one entity generated (room_layers_generated_at not null is the
  // canonical "room exists" signal). Skip rooms that haven't been
  // generated — autopilot has nothing to do there.
  const { data: subs } = await db
    .from("improvement_goals")
    .select("id, title, room_layers_generated_at")
    .eq("space_id", spaceId)
    .eq("user_id", auth.user.id)
    .not("parent_goal_id", "is", null)
    .not("room_layers_generated_at", "is", null);
  const subRows = (subs ?? []) as Array<{
    id: string;
    title: string;
    room_layers_generated_at: string | null;
  }>;

  if (subRows.length === 0) {
    return NextResponse.json({
      targets: [],
      totalChainCount: 0,
      message: "No generated rooms yet — generate a room first.",
    });
  }

  const subIds = subRows.map((s) => s.id);

  // Load FEATURE entities for all these rooms in one query. Features
  // are the IV — what autopilot manipulates. Score + refine target the
  // feature entity, so the work list is { subId, featureIds }.
  // Filter by entity_type instead of layer_ontology_id to keep the
  // query slim; the room generator stamps entity_type="feature" on
  // every mechanism row.
  const { data: featureRows } = await db
    .from("entities")
    .select("id, parent_sub_objective_id")
    .in("parent_sub_objective_id", subIds)
    .eq("entity_type", "feature");
  const features = (featureRows ?? []) as Array<{
    id: string;
    parent_sub_objective_id: string;
  }>;

  // Group by sub-objective. Within-room duplicates are dropped — if a
  // feature appears in multiple chains, we still only score+refine it
  // once per canvas-autopilot run.
  const featuresBySub = new Map<string, Set<string>>();
  for (const f of features) {
    const set = featuresBySub.get(f.parent_sub_objective_id) ?? new Set<string>();
    set.add(f.id);
    featuresBySub.set(f.parent_sub_objective_id, set);
  }

  const targets = subRows.map((s) => ({
    subObjectiveId: s.id,
    subObjectiveTitle: s.title,
    featureIds: Array.from(featuresBySub.get(s.id) ?? new Set<string>()),
  }));
  const totalChainCount = targets.reduce(
    (sum, t) => sum + t.featureIds.length,
    0,
  );

  // Phase 11.0a — log the canvas-wide autopilot_run event. The
  // notebook UI groups subsequent per-chain score / rd_iterate events
  // under this header by timestamp proximity. scope="canvas" is the
  // discriminator vs the per-room autopilot_run event the existing
  // sub-objective autopilot/start route emits. sub_objective_id is
  // null so the event lands in the space-scoped feed (it's a canvas-
  // level operation, not a per-room one).
  void logDecision(db, {
    userId: auth.user.id,
    spaceId,
    subObjectiveId: null,
    action: "autopilot_run",
    metadata: {
      scope: "canvas",
      sub_objective_ids: subIds,
      sub_objective_count: subRows.length,
      chain_count: totalChainCount,
    },
  });

  return NextResponse.json({
    targets,
    totalChainCount,
  });
}
