// ── GET /api/synergy/rooms/[id] ──
//
// Load a synergy room: room metadata + both anchor components +
// the OTHER user's profile + all current nodes. Membership-gated:
// only user_a or user_b can read.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface RoomRow {
  id: string;
  user_a: string;
  user_b: string;
  component_a: string;
  component_b: string;
  match_request_id: string | null;
  intersection_objective: string | null;
  archived_at: string | null;
  created_at: string;
}

interface ComponentRow {
  id: string;
  kind: string;
  subkind: string | null;
  label_public: string;
  description_public: string;
}

interface NodeRow {
  id: string;
  room_id: string;
  author_id: string;
  parent_id: string | null;
  kind: string;
  label: string;
  meta: string | null;
  x: number;
  y: number;
  created_at: string;
  updated_at: string;
}

interface ProfileRow {
  user_id: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
}

export async function GET(_request: Request, ctx: RouteContext) {
  const { id: roomId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: room, error: loadErr } = await db
    .from("synergy_rooms")
    .select(
      "id, user_a, user_b, component_a, component_b, match_request_id, intersection_objective, archived_at, created_at",
    )
    .eq("id", roomId)
    .single();
  if (loadErr || !room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  const r = room as RoomRow;

  // Pull both anchor components + the OTHER user's profile + all nodes
  // in parallel. The other_user is computed once for clarity.
  const otherUserId = r.user_a === user.id ? r.user_b : r.user_a;

  const [componentsRes, profileRes, nodesRes] = await Promise.all([
    db
      .from("brainstorm_components")
      .select("id, kind, subkind, label_public, description_public")
      .in("id", [r.component_a, r.component_b]),
    db
      .from("synergy_profiles")
      .select("user_id, display_name, bio, avatar_url")
      .eq("user_id", otherUserId)
      .maybeSingle(),
    db
      .from("synergy_room_nodes")
      .select(
        "id, room_id, author_id, parent_id, kind, label, meta, x, y, created_at, updated_at",
      )
      .eq("room_id", roomId)
      .order("created_at", { ascending: true }),
  ]);

  const components = (componentsRes.data ?? []) as ComponentRow[];
  const myComponentId = r.user_a === user.id ? r.component_a : r.component_b;
  const myComponent = components.find((c) => c.id === myComponentId) ?? null;
  const theirComponent =
    components.find((c) => c.id !== myComponentId) ?? null;
  const nodes = (nodesRes.data ?? []) as NodeRow[];
  const profile = (profileRes.data ?? null) as ProfileRow | null;

  return NextResponse.json({
    room: {
      id: r.id,
      user_a: r.user_a,
      user_b: r.user_b,
      intersection_objective: r.intersection_objective,
      archived_at: r.archived_at,
      created_at: r.created_at,
      // The caller's perspective: am I user_a or user_b?
      i_am: r.user_a === user.id ? "a" : "b",
    },
    my_component: myComponent,
    their_component: theirComponent,
    their_profile: profile,
    nodes,
  });
}

// ── PATCH /api/synergy/rooms/[id] ──
// Currently just archive/unarchive.

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id: roomId } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  let body: { archive?: unknown } = {};
  try {
    body = (await request.json()) as { archive?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const update: Record<string, unknown> = {};
  if (body.archive === true) {
    update.archived_at = new Date().toISOString();
    update.archived_by = user.id;
  } else if (body.archive === false) {
    update.archived_at = null;
    update.archived_by = null;
  } else {
    return NextResponse.json(
      { error: "archive: true | false required" },
      { status: 400 },
    );
  }

  const { data: updated, error } = await db
    .from("synergy_rooms")
    .update(update)
    .eq("id", roomId)
    .select("id, archived_at, archived_by")
    .single();
  if (error || !updated) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }
  return NextResponse.json({ room: updated });
}
