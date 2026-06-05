// ── POST /api/objective/[spaceId]/share ───────────────────────────
//
// Owner-only. Invite someone to collaborate on the objective whiteboard
// by email. Creates a tokened `space_invites` row and emails the invitee
// an accept link (/invite/[token]). The invitee signs in/up with that
// email to accept, which materializes a `space_members` row (see
// /api/invite/[token]/accept).
//
// Body: { email: string, role?: 'editor' | 'viewer' }

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/service";
import { sendBoardInviteEmail } from "@/lib/email/triggers";

export const maxDuration = 15;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // Only the owner can share a board.
  if (!(await verifySpaceOwnership(supabase, spaceId, user.id)))
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const { data: body, error: parseError } = await safeJsonParse<{
    email?: string;
    role?: string;
  }>(request);
  if (parseError) return parseError;

  const email = (body.email ?? "").trim().toLowerCase();
  const role: "editor" | "viewer" =
    body.role === "editor" ? "editor" : "viewer";

  if (!email || !EMAIL_RE.test(email))
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });

  // Don't let an owner invite their own account.
  if (user.email && email === user.email.toLowerCase())
    return NextResponse.json(
      { error: "You already own this board." },
      { status: 400 },
    );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  try {
    // Board title for the email + a friendlier UI.
    const { data: space } = await svc
      .from("spaces")
      .select("name, description, input_text")
      .eq("id", spaceId)
      .maybeSingle();
    const boardTitle =
      (typeof space?.description === "string" && space.description.trim()) ||
      (typeof space?.name === "string" && space.name.trim()) ||
      (typeof space?.input_text === "string" && space.input_text.trim()) ||
      "a whiteboard";

    // Fresh token per invite (so a stale link can be superseded). Replace
    // any unaccepted invite for the same (space, email) to avoid a pile-up
    // and keep the latest role authoritative.
    await svc
      .from("space_invites")
      .delete()
      .eq("space_id", spaceId)
      .ilike("invitee_email", email)
      .is("accepted_at", null);

    const token = randomBytes(24).toString("base64url");
    const { error: insErr } = await svc.from("space_invites").insert({
      space_id: spaceId,
      invitee_email: email,
      role,
      token,
      invited_by: user.id,
    });
    if (insErr) {
      console.error("[objective/share/POST]", insErr);
      return NextResponse.json({ error: "Could not create invite" }, { status: 500 });
    }

    const sent = await sendBoardInviteEmail({
      invitee_email: email,
      board_title: boardTitle,
      role,
      token,
      inviter_user_id: user.id,
    });

    return NextResponse.json({
      ok: true,
      email,
      role,
      dry_run: sent.dry_run,
      // Surface the link so the owner can copy it directly (handy in
      // dry-run / no-RESEND-key dev mode where no email is delivered).
      invite_url: `/invite/${token}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Share failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
