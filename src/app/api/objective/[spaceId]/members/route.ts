// ── GET /api/objective/[spaceId]/members ──────────────────────────
//
// Lists the people on a shared board: the owner, accepted members
// (editor/viewer), and — for the owner only — pending email invites.
// Drives the Share modal roster, the live-collaboration avatar stack,
// and the client's `enabled` gate (collaboration only spins up when the
// board is shared with ≥1 other person).
//
// Readable by any participant (owner or member). Member emails are
// resolved via the service-role admin API (auth.users isn't directly
// selectable).

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceAccess, sanitizeErrorMessage } from "@/lib/api-helpers";
import { createServiceClient } from "@/lib/supabase/service";

export const maxDuration = 15;

export interface BoardMember {
  userId: string;
  email: string | null;
  name: string | null;
  role: "owner" | "editor" | "viewer";
  isOwner: boolean;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const myRole = await verifySpaceAccess(supabase, spaceId, user.id);
  if (!myRole)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;

  try {
    const { data: space } = await svc
      .from("spaces")
      .select("user_id")
      .eq("id", spaceId)
      .maybeSingle();
    const ownerId = space?.user_id as string | undefined;

    const { data: memberRows } = await svc
      .from("space_members")
      .select("user_id, role")
      .eq("space_id", spaceId);

    const ids = new Set<string>();
    if (ownerId) ids.add(ownerId);
    for (const m of (memberRows ?? []) as Array<{ user_id: string }>)
      ids.add(m.user_id);

    // Resolve email + name per user via the admin API (best-effort).
    const profile = await resolveProfiles(svc, [...ids]);

    const members: BoardMember[] = [];
    if (ownerId) {
      members.push({
        userId: ownerId,
        email: profile[ownerId]?.email ?? null,
        name: profile[ownerId]?.name ?? null,
        role: "owner",
        isOwner: true,
      });
    }
    for (const m of (memberRows ?? []) as Array<{
      user_id: string;
      role: "editor" | "viewer";
    }>) {
      members.push({
        userId: m.user_id,
        email: profile[m.user_id]?.email ?? null,
        name: profile[m.user_id]?.name ?? null,
        role: m.role,
        isOwner: false,
      });
    }

    // Pending invites are owner-only (they expose invited emails).
    let invites: Array<{ email: string; role: string }> = [];
    if (myRole === "owner") {
      const { data: inviteRows } = await svc
        .from("space_invites")
        .select("invitee_email, role")
        .eq("space_id", spaceId)
        .is("accepted_at", null)
        .gt("expires_at", new Date().toISOString());
      invites = (
        (inviteRows ?? []) as Array<{ invitee_email: string; role: string }>
      ).map((r) => ({ email: r.invitee_email, role: r.role }));
    }

    return NextResponse.json({
      myRole,
      ownerId: ownerId ?? null,
      members,
      invites,
      // Collaboration is "live" only when at least one OTHER participant exists.
      shared: members.length > 1,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Load failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveProfiles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  svc: any,
  userIds: string[],
): Promise<Record<string, { email: string | null; name: string | null }>> {
  const out: Record<string, { email: string | null; name: string | null }> = {};
  // Pull display names in one query; emails one-by-one via admin API.
  const { data: profiles } = await svc
    .from("synergy_profiles")
    .select("user_id, display_name")
    .in("user_id", userIds);
  const nameById = new Map<string, string | null>(
    ((profiles ?? []) as Array<{ user_id: string; display_name: string | null }>).map(
      (p) => [p.user_id, p.display_name],
    ),
  );
  await Promise.all(
    userIds.map(async (id) => {
      let email: string | null = null;
      try {
        const { data } = await svc.auth.admin.getUserById(id);
        email = (data?.user?.email as string | null) ?? null;
      } catch {
        /* best-effort */
      }
      out[id] = { email, name: nameById.get(id) ?? null };
    }),
  );
  return out;
}
