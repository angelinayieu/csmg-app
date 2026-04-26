/**
 * DELETE /api/memory/clear
 *
 * Permanently deletes all memory_items rows for the authenticated user.
 * Used by the global settings page "Clear memory store" action.
 *
 * Soft-fail in all DB error cases — returns 500 with an error message
 * so the client can display it, but never crashes silently.
 */

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export async function DELETE() {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { supabase, user } = auth;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { error } = await db
    .from("memory_items")
    .delete()
    .eq("owner_id", user.id);

  if (error) {
    console.error("[memory/clear] delete failed:", error);
    return NextResponse.json(
      { error: "Failed to clear memory store. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, message: "Memory store cleared." });
}
