// POST /api/apps/:id/action — uniform action dispatch for widgets.
//
// Body: { kind: ActionKind | "custom:<name>", payload?: Record<string,unknown> }
//
// This is the single seam every widget uses to mutate. Keeps widgets
// ignorant of the underlying endpoints + gives agents a stable surface to
// extend via custom: handlers (see src/lib/apps/action-dispatcher.ts).

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { hydrateApp } from "@/types/app";
import type { AppRow } from "@/types/app";
import { dispatchAction } from "@/lib/apps/action-dispatcher";
// Side-effect import: registers Item 4 digital-twin handlers
// (log_prediction, start_experiment, end_experiment, apply_validation_result,
// record_deviation, escalate_to_research, run_simulation, resolve_predictions)
// with the dispatcher at module load.
import "@/lib/apps/action-handlers-item4";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<{
    kind?: string;
    payload?: Record<string, unknown>;
  }>(request);
  if (parseError) return parseError;

  const kind = body?.kind;
  if (typeof kind !== "string" || !kind) {
    return NextResponse.json(
      { error: "Missing action kind" },
      { status: 400 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Load app + ownership check.
  const { data: row } = (await db
    .from("apps")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle()) as { data: AppRow | null };

  if (!row) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  const result = await dispatchAction({
    kind,
    db,
    userId: user.id,
    app: hydrateApp(row),
    payload: body?.payload,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason ?? "Action failed" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    app: result.updated_app,
    extra: result.extra ?? null,
  });
}
