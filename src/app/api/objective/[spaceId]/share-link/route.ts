// ── POST /api/objective/[spaceId]/share-link ──────────────────────
//
// Owner-only. Mint a sharable open-link invite to the objective whiteboard
// (anyone signed in who opens the link is added as a member at the chosen
// role). Returns the `/invite/[token]` URL the modal copies.
//
// Distinct from /share (the email invite): no invitee_email, no email
// delivery, idempotent per (space, role) — re-clicking "Copy link" reuses
// the existing open invite so a single shared link stays stable.
//
// Body: { role?: 'editor' | 'viewer' }

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/service";

export const maxDuration = 15;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  if (!(await verifySpaceOwnership(supabase, spaceId, user.id)))
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const { data: body } = await safeJsonParse<{ role?: string }>(request);
  const role: "editor" | "viewer" =
    body?.role === "viewer" ? "viewer" : "editor";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  try {
    // Reuse a still-valid open invite for the same role — keeps the
    // shared URL stable across "Copy link" clicks. An open invite is one
    // with no invitee_email (the column was made nullable in
    // 20260928_open_share_links.sql).
    const nowIso = new Date().toISOString();
    const { data: existing } = await svc
      .from("space_invites")
      .select("token")
      .eq("space_id", spaceId)
      .is("invitee_email", null)
      .eq("role", role)
      .is("accepted_at", null)
      .gt("expires_at", nowIso)
      .limit(1)
      .maybeSingle();

    if (existing?.token) {
      return NextResponse.json({
        ok: true,
        role,
        invite_url: `/invite/${existing.token}`,
      });
    }

    const token = randomBytes(24).toString("base64url");
    const { error: insErr } = await svc.from("space_invites").insert({
      space_id: spaceId,
      invitee_email: null,
      role,
      token,
      invited_by: user.id,
    });
    if (insErr) {
      console.error("[objective/share-link/POST]", insErr);
      return NextResponse.json(
        { error: "Could not create share link" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      role,
      invite_url: `/invite/${token}`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Share link failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
