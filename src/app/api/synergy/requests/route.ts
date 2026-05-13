// ── /api/synergy/requests ──
//
// POST → create a new connection request (with bidirectional-resolve)
// GET  → list requests (direction=incoming|outgoing, default=incoming)
//
// Privacy hardening (Phase 4c v2):
//   - Incoming-PENDING requests do NOT reveal the sender's profile.
//     The receiver makes their accept/decline decision based on the
//     project (component + objective + rationale + message), NOT the
//     person. Profile reveals at the moment-of-decision via the
//     dedicated accept-preview endpoint.
//   - Outgoing-PENDING + ACCEPTED rows DO reveal the other party
//     (sender knows who they reached out to; both sides know each
//     other after accept).
//
// New in v2:
//   - Bidirectional simultaneous request resolve: if user B tries to
//     send A a request while A already has one to B pending, the
//     response steers B to accept A's existing request instead.
//   - match_id + additional_component_ids supported on create
//   - seen_at flipped to now() the first time receiver reads incoming
//   - effective_status = "expired" computed at read-time

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { sendNewRequestEmail } from "@/lib/email/triggers";

interface CreateBody {
  from_component_id?: unknown;
  to_component_id?: unknown;
  match_id?: unknown;
  message?: unknown;
  additional_component_ids?: unknown;
}

interface ComponentRow {
  id: string;
  owner_id: string;
  visibility: string;
  label_public: string;
}

// ── POST: create request ──

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
  const matchId =
    typeof body.match_id === "string" && body.match_id.length > 0
      ? body.match_id
      : null;

  // Sanitize + cap additional component ids
  const additionalRaw = Array.isArray(body.additional_component_ids)
    ? (body.additional_component_ids as unknown[]).filter(
        (x): x is string => typeof x === "string" && x.length > 0,
      )
    : [];
  const additionalIds = additionalRaw.slice(0, 3);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Hydrate the from/to components in one query for ownership +
  // visibility validation. We separately validate additional_ids
  // below since they're a different set of rows.
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

  // ── Bidirectional simultaneous resolve ──
  // Check the canonical pair index: does ANY pending request exist
  // between these two users in either direction? If yes (and not
  // already covered by the unique-pair constraint), short-circuit
  // with an "existing_inbound" hint so the UI can redirect to
  // the inbox.
  const a = user.id < toComponent.owner_id ? user.id : toComponent.owner_id;
  const b = user.id < toComponent.owner_id ? toComponent.owner_id : user.id;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existingPair } = await db
    .from("match_requests")
    .select("id, from_user, to_user, status")
    .eq("status", "pending")
    .or(
      `and(from_user.eq.${a},to_user.eq.${b}),and(from_user.eq.${b},to_user.eq.${a})`,
    )
    .limit(5);
  const inbound = ((existingPair ?? []) as Array<{
    id: string;
    from_user: string;
    to_user: string;
  }>).find((r) => r.to_user === user.id);
  if (inbound) {
    return NextResponse.json(
      {
        kind: "existing_inbound",
        message:
          "This user has already sent you a request. Open your inbox to respond.",
        request_id: inbound.id,
      },
      { status: 409 },
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
        code: "rate_limit_pending",
      },
      { status: 429 },
    );
  }

  // Validate additional_component_ids: each must belong to the caller
  let validatedAdditional: string[] = [];
  if (additionalIds.length > 0) {
    const { data: addRows } = await db
      .from("brainstorm_components")
      .select("id, owner_id")
      .in("id", additionalIds);
    validatedAdditional = ((addRows ?? []) as Array<{ id: string; owner_id: string }>)
      .filter((r) => r.owner_id === user.id)
      .map((r) => r.id);
  }

  // Insert (unique constraint catches direct A→B dedup)
  const { data: inserted, error: insertErr } = await db
    .from("match_requests")
    .insert({
      from_user: user.id,
      to_user: toComponent.owner_id,
      from_component: fromComponent.id,
      to_component: toComponent.id,
      match_id: matchId,
      message,
      additional_component_ids: validatedAdditional,
      status: "pending",
    })
    .select(
      "id, from_user, to_user, from_component, to_component, match_id, message, additional_component_ids, status, created_at, expires_at",
    )
    .single();

  if (insertErr) {
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

  // ── Fire-and-forget email notification ──
  // The trigger itself respects the receiver's per-event opt-in +
  // delivery override + dry-runs gracefully when RESEND_API_KEY is
  // unset. We catch + log failures here so a Resend hiccup never
  // crashes the request flow.
  // Pull the match's rationale (when match_id is set) so the email
  // can include the LLM's "why this match" line for context.
  let matchRationale: string | null = null;
  if (matchId) {
    const { data: matchRow } = await db
      .from("component_matches")
      .select("rationale")
      .eq("id", matchId)
      .maybeSingle();
    matchRationale = (matchRow?.rationale as string | null) ?? null;
  }
  // Look up the sender's session_id so we can include their objective
  // in the email (no PII; objectives are part of the request's
  // matchable-context already).
  const { data: senderSession } = await db
    .from("brainstorm_components")
    .select("session_id")
    .eq("id", fromComponent.id)
    .maybeSingle();
  sendNewRequestEmail({
    to_user_id: toComponent.owner_id,
    to_component_id: toComponent.id,
    match_rationale: matchRationale,
    sender_session_id:
      (senderSession?.session_id as string | undefined) ?? null,
  }).catch((err) =>
    console.warn("[/api/synergy/requests POST] email trigger errored:", err),
  );

  return NextResponse.json({ request: inserted }, { status: 201 });
}

// ── GET: list requests ──

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
      "id, from_user, to_user, from_component, to_component, match_id, message, additional_component_ids, status, created_at, responded_at, expires_at, seen_at",
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

  interface RawRow {
    id: string;
    from_user: string;
    to_user: string;
    from_component: string;
    to_component: string;
    match_id: string | null;
    message: string | null;
    additional_component_ids: string[];
    status: string;
    created_at: string;
    responded_at: string | null;
    expires_at: string;
    seen_at: string | null;
  }
  const reqs = (requests ?? []) as RawRow[];

  // ── seen_at side-effect ──
  // Mark unseen incoming-pending rows as seen on first read. Decoupled
  // from the response so a slow update doesn't delay the user.
  if (direction === "incoming") {
    const unseen = reqs
      .filter((r) => r.to_user === user.id && r.status === "pending" && r.seen_at === null)
      .map((r) => r.id);
    if (unseen.length > 0) {
      void db
        .from("match_requests")
        .update({ seen_at: new Date().toISOString() })
        .in("id", unseen);
    }
  }

  // ── Effective expired computation ──
  // Rows still flagged 'pending' but past expires_at are surfaced as
  // 'expired' in the response. A separate cron / on-PATCH-touch
  // updates the DB; for read consistency we project here.
  const now = Date.now();
  const projected = reqs.map((r) => {
    if (r.status === "pending" && new Date(r.expires_at).getTime() < now) {
      return { ...r, status: "expired" };
    }
    return r;
  });

  // ── Hydration: components on both sides + privacy-gated profile ──
  const componentIds = new Set<string>();
  const additionalIds = new Set<string>();
  const otherUserIds = new Set<string>();
  for (const r of projected) {
    componentIds.add(r.from_component);
    componentIds.add(r.to_component);
    for (const id of r.additional_component_ids ?? []) additionalIds.add(id);
    const other = r.from_user === user.id ? r.to_user : r.from_user;
    otherUserIds.add(other);
  }

  const allComponentIds = Array.from(
    new Set<string>([...componentIds, ...additionalIds]),
  );
  const { data: components } = await db
    .from("brainstorm_components")
    .select("id, kind, label_public, description_public")
    .in("id", allComponentIds);
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

  // Hydrate matches for the rationale + scores (when match_id set).
  const matchIds = projected
    .map((r) => r.match_id)
    .filter((id): id is string => typeof id === "string");
  const matchMap = new Map<
    string,
    {
      rationale: string;
      final_score: number;
      complementarity_score: number;
      goal_alignment_score: number;
    }
  >();
  if (matchIds.length > 0) {
    const { data: matches } = await db
      .from("component_matches")
      .select(
        "id, rationale, final_score, complementarity_score, goal_alignment_score",
      )
      .in("id", matchIds);
    for (const m of (matches ?? []) as Array<{
      id: string;
      rationale: string;
      final_score: number;
      complementarity_score: number;
      goal_alignment_score: number;
    }>) {
      matchMap.set(m.id, {
        rationale: m.rationale,
        final_score: m.final_score,
        complementarity_score: m.complementarity_score,
        goal_alignment_score: m.goal_alignment_score,
      });
    }
  }

  // ── PRIVACY GATE ──
  // Receiver does NOT see sender's profile on pending. Profile reveals
  // at accept-preview / accepted only.
  const profileReveal = (r: RawRow): boolean => {
    if (r.status === "accepted") return true;
    if (r.from_user === user.id && r.status === "pending") {
      // Outgoing pending — sender sees the receiver they reached
      // out to. (Sender already chose to engage.)
      return true;
    }
    return false;
  };

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

  const hydrated = projected.map((r) => {
    const otherId = r.from_user === user.id ? r.to_user : r.from_user;
    const otherProfile = profileMap.get(otherId);
    return {
      id: r.id,
      direction:
        r.from_user === user.id ? "outgoing" : ("incoming" as const),
      status: r.status,
      message: r.message,
      additional_components: (r.additional_component_ids ?? [])
        .map((id) => componentMap.get(id))
        .filter(
          (
            c,
          ): c is {
            kind: string;
            label_public: string;
            description_public: string;
          } => !!c,
        ),
      match: r.match_id ? matchMap.get(r.match_id) ?? null : null,
      created_at: r.created_at,
      responded_at: r.responded_at,
      expires_at: r.expires_at,
      seen_at: r.seen_at,
      my_component:
        componentMap.get(
          r.from_user === user.id ? r.from_component : r.to_component,
        ) ?? null,
      their_component:
        componentMap.get(
          r.from_user === user.id ? r.to_component : r.from_component,
        ) ?? null,
      other_party:
        profileReveal(r) && otherProfile
          ? {
              // user_id exposed alongside the profile so the inbox UI
              // can deep-link to /app/synergy/profile/[user_id]. Only
              // surfaced when profileReveal is true — incoming-pending
              // rows still hide identity completely.
              user_id: otherId,
              display_name: otherProfile.display_name,
              bio: otherProfile.bio,
              avatar_url: otherProfile.avatar_url,
            }
          : null,
    };
  });

  return NextResponse.json({ requests: hydrated });
}
