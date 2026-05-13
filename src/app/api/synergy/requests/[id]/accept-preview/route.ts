// ── POST /api/synergy/requests/[id]/accept-preview ──
//
// Moment-of-decision profile reveal. The receiver of a pending
// request calls this endpoint when they're ABOUT TO ACCEPT (e.g.
// they clicked Accept → confirmation modal opens). The response
// includes the sender's display_name + bio + avatar so the
// receiver can decide with full info.
//
// This is the privacy contract: profiles never appear in the GET
// /requests listing for incoming pending rows. They appear only
// here, gated by:
//   1. The caller is the to_user of the request
//   2. The request is pending (not expired)
//   3. The request exists
//
// Calling this endpoint does NOT change the request status. It's
// just a guarded read. The actual accept happens via the existing
// PATCH endpoint after the user confirms in the modal.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: existing, error: loadErr } = await db
    .from("match_requests")
    .select("id, from_user, to_user, status, expires_at, message, additional_component_ids")
    .eq("id", id)
    .single();
  if (loadErr || !existing) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  if (existing.to_user !== user.id) {
    return NextResponse.json(
      { error: "Only the recipient can preview" },
      { status: 403 },
    );
  }
  if (existing.status !== "pending") {
    return NextResponse.json(
      { error: `Request is ${existing.status} — preview unavailable` },
      { status: 409 },
    );
  }
  if (new Date(existing.expires_at).getTime() < Date.now()) {
    return NextResponse.json(
      { error: "Request has expired", code: "expired" },
      { status: 410 },
    );
  }

  const { data: profile } = await db
    .from("synergy_profiles")
    .select("display_name, bio, avatar_url")
    .eq("user_id", existing.from_user)
    .maybeSingle();

  // Hydrate any additional components the sender wanted to share
  const addIds = (existing.additional_component_ids ?? []) as string[];
  let additionalComponents: Array<{
    kind: string;
    label_public: string;
    description_public: string;
  }> = [];
  if (addIds.length > 0) {
    const { data: comps } = await db
      .from("brainstorm_components")
      .select("kind, label_public, description_public")
      .in("id", addIds);
    additionalComponents = (comps ?? []) as Array<{
      kind: string;
      label_public: string;
      description_public: string;
    }>;
  }

  // Also return the receiver's OWN profile so the modal can show
  // "they'll see your name as: ..." (and offer a bio-edit link).
  const { data: myProfile } = await db
    .from("synergy_profiles")
    .select("display_name, bio, avatar_url")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    sender_profile: profile ?? null,
    my_profile: myProfile ?? null,
    additional_components: additionalComponents,
    expires_at: existing.expires_at,
  });
}

function unused() {
  return sanitizeErrorMessage;
}
void unused;
