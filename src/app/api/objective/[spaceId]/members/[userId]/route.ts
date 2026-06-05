// ── DELETE /api/objective/[spaceId]/members/[userId] ──────────────
//
// Revoke a member's access. Allowed for the space OWNER (remove anyone)
// or a member removing THEMSELVES (leave). Owner can't be removed (they
// own the space row, not a membership row).

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, sanitizeErrorMessage } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/service";

export const maxDuration = 15;

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ spaceId: string; userId: string }> },
) {
  const { spaceId, userId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  const isSelf = userId === user.id;
  if (!isOwner && !isSelf)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  try {
    const { error } = await svc
      .from("space_members")
      .delete()
      .eq("space_id", spaceId)
      .eq("user_id", userId);
    if (error) {
      console.error("[members/DELETE]", error);
      return NextResponse.json({ error: "Remove failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: `Remove failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
