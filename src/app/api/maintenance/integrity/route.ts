// POST /api/maintenance/integrity
//
// Sprint 5 — run the per-owner integrity check (see
// lib/maintenance/integrity-check.ts) and return the report. Advisory only;
// no mutations. Admins / cron can ping this; the response is small JSON.
//
// A future scheduled variant should iterate all users with a service-role
// key; for now this is per-authenticated-user.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { runIntegrityCheck } from "@/lib/maintenance/integrity-check";

export const maxDuration = 60;

export async function POST() {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    const report = await runIntegrityCheck(db, user.id);
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    console.error("[maintenance/integrity] error:", err);
    return NextResponse.json(
      {
        error: "Integrity check failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
