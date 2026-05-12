// ── /api/synergy/requests ──
//
// POST → create a new connection request
// GET  → list requests (direction=incoming|outgoing, default=incoming)
//
// Validation on POST:
//   - from_component_id is owned by the caller
//   - to_component_id exists + visibility != private
//   - target owner has matching_enabled = true
//   - no dedup conflict (unique constraint on (from_component, to_component))
//   - rate limit: caller has < max_pending_requests outgoing pending

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";

interface CreateBody {
  from_component_id?: unknown;
  to_component_id?: unknown;
  message?: unknown;
}

interface ComponentRow {
  id: string;
  owner_id: string;
  visibility: string;
  label_public: string;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<CreateBody>(request);
  if (parseError) return parseError;

  if (
    typeof body.from_component_id !== "string" ||
    typeof body.to_component_id !== "string"
  ) {
    return NextResponse.json(
      { error: "from_component_id + to_component_id required" },
      { status: 400 },
    );
  }
  const message =
    typeof body.message === "string" ? body.message.trim().slice(0, 500) : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Hydrate both components in one query so we can validate ownership +
  // visibility in a single round trip.
  const { data: components } = await db
    .from("brainstorm_components")
    .select("id, owner_id, visibility, label_public")
    .in("id", [body.from_component_id, body.to_component_id]);
  const list = (components ?? []) as ComponentRow[];
  const fromComponent = list.find((c) => c.id === body.from_component_id);
  const toComponent = list.find((c) => c.id === body.to_component_id);
  if (!fromComponent || !toComponent) {
    return NextResponse.json({ error: "Component not found" }, { status: 404 });
  }
  if (fromComponent.owner_id !== user.id) {
    return NextResponse.json(
      { error: "from_component must belong to you" },
      { status: 403 },
    );
  }
  if (toComponent.visibility === "private") {
    return NextResponse.json(
      { error: "target component is not matchable" },
      { status: 403 },
    );
  }
  if (toComponent.owner_id === user.id) {
    return NextResponse.json(
      { error: "cannot request a connection on your own component" },
      { status: 400 },
    );
  }

  // Verify target user has matching_enabled
  const { data: targetProfile } = await db
    .from("synergy_profiles")
    .select("matching_enabled")
    .eq("user_id", toComponent.owner_id)
    .maybeSingle();
  if (targetProfile && targetProfile.matching_enabled === false) {
    return NextResponse.json(
      { error: "this user has disabled matching" },
      { status: 403 },
    );
  }

  // Rate-limit: max_pending_requests
  const { data: ownProfile } = await db
    .from("synergy_profiles")
    .select("max_pending_requests")
    .eq("user_id", user.id)
    .maybeSingle();
  const maxPending = ownProfile?.max_pending_requests ?? 5;

  const { count: pendingCount } = await db
    .from("match_requests")
    .select("id", { count: "exact", head: true })
    .eq("from_user", user.id)
    .eq("status", "pending");

  if ((pendingCount ?? 0) >= maxPending) {
    return NextResponse.json(
      {
        error: `You have ${pendingCount} pending outgoing requests (limit ${maxPending}). Resolve some before sending more.`,
        code: "rate_limited",
      },
      { status: 429 },
    );
  }

  // Insert (unique constraint catches dedup)
  const { data: inserted, error: insertErr } = await db
    .from("match_requests")
    .insert({
      from_user: user.id,
      to_user: toComponent.owner_id,
      from_component: fromComponent.id,
      to_component: toComponent.id,
      message,
      status: "pending",
    })
    .select(
      "id, from_user, to_user, from_component, to_component, message, status, created_at, expires_at",
    )
    .single();

  if (insertErr) {
    // 23505 = unique violation. Surface as 409 with a clear message.
    if (insertErr.code === "23505") {
      return NextResponse.json(
        {
          error: "A request between these components already exists",
          code: "duplicate",
        },
        { status: 409 },
      );
    }
    console.error("[/api/synergy/requests POST] insert error:", insertErr);
    return NextResponse.json(
      { error: sanitizeErrorMessage(insertErr) },
      { status: 500 },
    );
  }

  return NextResponse.json({ request: inserted }, { status: 201 });
}

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const direction = searchParams.get("direction") ?? "incoming";
  const statusFilter = searchParams.get("status");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let query = db
    .from("match_requests")
    .select(
      "id, from_user, to_user, from_component, to_component, message, status, created_at, responded_at, expires_at",
    );

  if (direction === "outgoing") {
    query = query.eq("from_user", user.id);
  } else {
    query = query.eq("to_user", user.id);
  }
  if (
    statusFilter &&
    ["pending", "accepted", "declined", "expired", "withdrawn"].includes(statusFilter)
  ) {
    query = query.eq("status", statusFilter);
  }
  query = query.order("created_at", { ascending: false }).limit(100);

  const { data: requests, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }

  // Hydrate the component labels + (when status='pending' or 'accepted')
  // the other party's display_name. Privacy: declined/withdrawn rows
  // get NO profile reveal — only "still pending" or "we matched" rows
  // expose identity.
  const reqs = (requests ?? []) as Array<{
    id: string;
    from_user: string;
    to_user: string;
    from_component: string;
    to_component: string;
    message: string | null;
    status: string;
    created_at: string;
    responded_at: string | null;
    expires_at: string;
  }>;

  const componentIds = new Set<string>();
  const otherUserIds = new Set<string>();
  for (const r of reqs) {
    componentIds.add(r.from_component);
    componentIds.add(r.to_component);
    const other = r.from_user === user.id ? r.to_user : r.from_user;
    otherUserIds.add(other);
  }

  const { data: components } = await db
    .from("brainstorm_components")
    .select("id, kind, label_public, description_public")
    .in("id", Array.from(componentIds));
  const componentMap = new Map<
    string,
    { kind: string; label_public: string; description_public: string }
  >();
  for (const c of (components ?? []) as Array<{
    id: string;
    kind: string;
    label_public: string;
    description_public: string;
  }>) {
    componentMap.set(c.id, c);
  }

  const { data: profiles } = await db
    .from("synergy_profiles")
    .select("user_id, display_name, bio, avatar_url")
    .in("user_id", Array.from(otherUserIds));
  const profileMap = new Map<
    string,
    { display_name: string; bio: string | null; avatar_url: string | null }
  >();
  for (const p of (profiles ?? []) as Array<{
    user_id: string;
    display_name: string;
    bio: string | null;
    avatar_url: string | null;
  }>) {
    profileMap.set(p.user_id, {
      display_name: p.display_name,
      bio: p.bio,
      avatar_url: p.avatar_url,
    });
  }

  const hydrated = reqs.map((r) => {
    const otherId = r.from_user === user.id ? r.to_user : r.from_user;
    const otherProfile = profileMap.get(otherId);
    const revealProfile =
      r.status === "pending" || r.status === "accepted";
    return {
      id: r.id,
      direction:
        r.from_user === user.id ? "outgoing" : ("incoming" as const),
      status: r.status,
      message: r.message,
      created_at: r.created_at,
      responded_at: r.responded_at,
      expires_at: r.expires_at,
      my_component: componentMap.get(
        r.from_user === user.id ? r.from_component : r.to_component,
      ) ?? null,
      their_component: componentMap.get(
        r.from_user === user.id ? r.to_component : r.from_component,
      ) ?? null,
      // Profile revealed for pending/accepted only
      other_party: revealProfile && otherProfile
        ? {
            display_name: otherProfile.display_name,
            bio: otherProfile.bio,
            avatar_url: otherProfile.avatar_url,
          }
        : null,
    };
  });

  return NextResponse.json({ requests: hydrated });
}
