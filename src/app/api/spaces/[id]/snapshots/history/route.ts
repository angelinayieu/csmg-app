// GET /api/spaces/[id]/snapshots/history
//
// Returns a chronological time series of the twin's health_score —
// purpose-built for the dashboard sparkline. Projects only the fields
// the chart needs from `twin_snapshots.twin_state` so the response
// stays small even when the user has hundreds of snapshots.
//
// Distinct from the sibling list endpoint (which returns scalar meta
// without twin_state). This one DOES read the JSONB but projects to
// just (captured_at, health_score, health_label, reason) per row.

import { NextResponse, type NextRequest } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export interface TwinHistoryPoint {
  captured_at: string;
  health_score: number;
  health_label: string | null;
  reason: string;
  /** Optional — present when caller asks for include=axes. Lets the
   *  state-space radar replay each snapshot's full 4-axis shape. */
  coverage_pct?: number;
  risk_pct?: number;
  dynamics_pct?: number;
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase, user } = auth;
  const { id: spaceId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Verify ownership before reading.
  const { data: space } = await db
    .from("spaces")
    .select("id, user_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (!space) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((space as { user_id: string }).user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw
    ? Math.min(500, Math.max(1, parseInt(limitRaw, 10)))
    : 200;
  const includeAxes = url.searchParams.get("include") === "axes";

  const { data, error } = await db
    .from("twin_snapshots")
    .select("captured_at, reason, twin_state")
    .eq("space_id", spaceId)
    .order("captured_at", { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const points: TwinHistoryPoint[] = (data ?? [])
    .map((row: { captured_at: string; reason: string; twin_state: unknown }) => {
      const ts = row.twin_state as Record<string, unknown> | null;
      if (!ts) return null;
      const macro = (ts.macro ?? ts) as Record<string, unknown>;
      const health =
        typeof macro.health_score === "number" ? macro.health_score : null;
      if (health == null) return null;
      const point: TwinHistoryPoint = {
        captured_at: row.captured_at,
        health_score: health,
        health_label:
          typeof macro.health_label === "string" ? macro.health_label : null,
        reason: row.reason ?? "user_request",
      };
      if (includeAxes) {
        const coverage = macro.coverage as
          | { orphan_ratio?: number }
          | undefined;
        const risk = macro.risk_exposure as
          | { critical_risks?: number; total_risk_points?: number }
          | undefined;
        const dynamics = macro.dynamics as
          | { total_loops?: number; leverage_points?: number }
          | undefined;
        if (coverage && typeof coverage.orphan_ratio === "number") {
          point.coverage_pct = Math.round((1 - coverage.orphan_ratio) * 100);
        }
        if (risk) {
          // Risk axis: invert so high = low-risk (good). Cap at 5 critical risks.
          const crit = risk.critical_risks ?? 0;
          point.risk_pct = Math.max(0, 100 - Math.min(100, crit * 20));
        }
        if (dynamics) {
          const loops = dynamics.total_loops ?? 0;
          const lev = dynamics.leverage_points ?? 0;
          point.dynamics_pct = Math.min(100, loops * 10 + lev * 8);
        }
      }
      return point;
    })
    .filter((p: TwinHistoryPoint | null): p is TwinHistoryPoint => p !== null);

  return NextResponse.json({ points });
}
