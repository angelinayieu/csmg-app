// ── POST /api/invite/[token]/accept ───────────────────────────────
//
// Redeem a board-share invite. The caller must be signed in; for v1 we
// require the authenticated email to match the invited email (prevents
// link-forwarding). On success: insert/upsert a space_members row,
// stamp the invite accepted, and return the spaceId so the client can
// route onto the board.
//
// Uses the service-role client because the invite token IS the secret —
// the invitee has no prior access to the space's rows under RLS.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/service";

export const maxDuration = 15;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const { user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  const { data: invite } = await svc
    .from("space_invites")
    .select("id, space_id, invitee_email, role, accepted_at, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!invite)
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  if (new Date(invite.expires_at).getTime() < Date.now())
    return NextResponse.json({ error: "This invite has expired." }, { status: 410 });

  // Email-match gate (anti-forwarding). Owner-invited email must equal the
  // signed-in account's email.
  const myEmail = (user.email ?? "").toLowerCase();
  if (
    myEmail &&
    String(invite.invitee_email).toLowerCase() !== myEmail
  ) {
    return NextResponse.json(
      {
        error:
          "This invite was sent to a different email. Sign in with the invited address to accept.",
      },
      { status: 403 },
    );
  }

  // Owner accepting their own invite is a no-op (they already have access).
  const { data: space } = await svc
    .from("spaces")
    .select("user_id")
    .eq("id", invite.space_id)
    .maybeSingle();
  if (space?.user_id === user.id) {
    return NextResponse.json({ ok: true, spaceId: invite.space_id });
  }

  // Upsert membership (idempotent — re-accepting keeps the latest role).
  const { error: memErr } = await svc.from("space_members").upsert(
    {
      space_id: invite.space_id,
      user_id: user.id,
      role: invite.role,
      invited_by: null,
    },
    { onConflict: "space_id,user_id" },
  );
  if (memErr) {
    console.error("[invite/accept]", memErr);
    return NextResponse.json({ error: "Could not join board" }, { status: 500 });
  }

  // Stamp the invite accepted (best-effort — membership already exists).
  await svc
    .from("space_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  return NextResponse.json({ ok: true, spaceId: invite.space_id, role: invite.role });
}
