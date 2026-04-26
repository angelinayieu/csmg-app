// GET    /api/reports/:id  → single frozen report with full payload + manifest.
// DELETE /api/reports/:id  → hard-delete (reports are snapshots; no soft-state).

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("reports")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[report GET] query failed:", error);
    return NextResponse.json({ error: "Failed to load report" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  return NextResponse.json({ report: data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db
    .from("reports")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error("[report DELETE] failed:", error);
    return NextResponse.json({ error: "Failed to delete report" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
