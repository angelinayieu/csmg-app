// GET /api/objective/[spaceId]/board/history/[snapshotId] → { snapshot } | 404
//
// Read one historical board snapshot for restore. Ownership-checked.

import { NextResponse } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";

export const maxDuration = 15;

interface Ctx {
  params: Promise<{ spaceId: string; snapshotId: string }>;
}

export async function GET(_req: Request, { params }: Ctx) {
  const { spaceId, snapshotId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;
  if (!(await verifySpaceOwnership(supabase, spaceId, user.id)))
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

   
  const db = supabase as any;
  try {
    const { data } = await db
      .from("objective_board_snapshots")
      .select("snapshot")
      .eq("space_id", spaceId)
      .eq("id", snapshotId)
      .maybeSingle();
    if (!data)
      return NextResponse.json({ snapshot: null }, { status: 404 });
    return NextResponse.json({ snapshot: data.snapshot });
  } catch (err) {
    return NextResponse.json(
      { error: `Load failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
