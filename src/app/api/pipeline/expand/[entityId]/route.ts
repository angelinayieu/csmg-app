import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

// GET — fetch cached expansion for an entity
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { entityId } = await params;

  const { data: expansion } = await db
    .from("expansions")
    .select("*")
    .eq("entity_id", entityId)
    .eq("stale", false)
    .maybeSingle();

  if (!expansion) return NextResponse.json({ error: "No expansion found" }, { status: 404 });
  return NextResponse.json({ expansion });
}

// DELETE — invalidate (mark stale) an expansion and all its children
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ entityId: string }> }
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { entityId } = await params;

  // Mark the expansion and all descendants as stale
  const { data: expansion } = await db
    .from("expansions")
    .select("id")
    .eq("entity_id", entityId)
    .maybeSingle();

  if (!expansion) return NextResponse.json({ error: "No expansion found" }, { status: 404 });

  // Mark this expansion stale
  await db.from("expansions").update({ stale: true }).eq("id", expansion.id);

  // Mark all child expansions stale (cascade)
  await db.from("expansions").update({ stale: true }).eq("parent_expansion_id", expansion.id);

  // Reset entity flags
  await db.from("entities").update({ is_expanded: false, expansion_id: null }).eq("id", entityId);

  return NextResponse.json({ invalidated: true });
}
