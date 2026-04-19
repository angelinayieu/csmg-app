// POST /api/bridges/[id]/resolve
//
// Sprint 4 — confirm or reject a bridge (typically a ghost bridge
// returned from the /api/canvases/[id]/weave run). Confirm → status
// 'user_confirmed'; reject → 'user_rejected' (kept as audit + "do not
// resurface" signal — the partial unique index excludes rejected rows
// from the dedup key so a user can deliberately recreate later).

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { ResolveBridgeInputSchema } from "@/lib/schemas/canvas-substrate";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: bridgeId } = await ctx.params;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const parsed = ResolveBridgeInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership gate — fetch via the source/target space ownership check.
  // RLS policy owner_all_bridges also enforces, but we want clear 404 for
  // truly missing rows.
  const { data: bridge } = (await db
    .from("bridges")
    .select("id, source_space_id, target_space_id, status")
    .eq("id", bridgeId)
    .maybeSingle()) as {
    data: {
      id: string;
      source_space_id: string;
      target_space_id: string;
      status: string;
    } | null;
  };
  if (!bridge) {
    return NextResponse.json({ error: "Bridge not found" }, { status: 404 });
  }

  const { data: spaces } = (await db
    .from("spaces")
    .select("id")
    .eq("user_id", user.id)
    .in("id", [bridge.source_space_id, bridge.target_space_id])) as {
    data: Array<{ id: string }> | null;
  };
  const ownedSet = new Set((spaces ?? []).map((s) => s.id));
  if (
    !ownedSet.has(bridge.source_space_id) &&
    !ownedSet.has(bridge.target_space_id)
  ) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const nextStatus =
    parsed.data.action === "confirm" ? "user_confirmed" : "user_rejected";

  const { data: updated, error } = (await db
    .from("bridges")
    .update({ status: nextStatus })
    .eq("id", bridgeId)
    .select("*")
    .single()) as { data: { id: string; status: string } | null; error: unknown };

  if (error) {
    console.error("[bridge resolve] error:", error);
    return NextResponse.json(
      { error: "Failed to resolve bridge" },
      { status: 500 },
    );
  }

  return NextResponse.json({ bridge: updated });
}
