/**
 * GET /api/agent-findings
 *
 * Wave D L3.5 — prime endpoint for the realtime findings hook
 * (use-realtime-agent-findings.ts). Returns the user's recent findings,
 * newest first. Supports optional filters:
 *   ?limit=50                 — cap (default 50, max 200)
 *   ?space_id=<uuid>          — restrict to a single space
 *   ?status=unread|reviewed|acted_on|dismissed
 *   ?severity=urgent|notable|info
 *
 * RLS is user-scoped at the table level — we still pass user_id
 * explicitly for belt-and-suspenders + predictable query plans.
 */

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { AgentFinding, AgentFindingStatus, AgentFindingSeverity } from "@/types";

const VALID_STATUSES: AgentFindingStatus[] = ["unread", "reviewed", "acted_on", "dismissed"];
const VALID_SEVERITIES: AgentFindingSeverity[] = ["info", "notable", "urgent"];

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const limitParam = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(limitParam)
    ? Math.max(1, Math.min(200, limitParam))
    : 50;
  const spaceId = url.searchParams.get("space_id");
  const statusParam = url.searchParams.get("status");
  const severityParam = url.searchParams.get("severity");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("agent_findings")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (spaceId) query = query.eq("space_id", spaceId);
  if (statusParam && VALID_STATUSES.includes(statusParam as AgentFindingStatus)) {
    query = query.eq("status", statusParam);
  }
  if (
    severityParam &&
    VALID_SEVERITIES.includes(severityParam as AgentFindingSeverity)
  ) {
    query = query.eq("severity", severityParam);
  }

  const { data, error } = await query;
  if (error) {
    // Graceful degradation: when the `agent_findings` table hasn't
    // been migrated yet (PGRST205 = schema-cache miss on missing
    // table), return an empty findings list instead of 500. The
    // realtime hook polls every ~10s; hot-500-looping against a
    // non-existent table otherwise DOS's the dev server with
    // hundreds of errors per minute and bleeds into real request
    // latency.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errCode = (error as any)?.code;
    if (errCode === "PGRST205" || errCode === "42P01") {
      return NextResponse.json({ findings: [] });
    }
    console.error("[agent-findings] fetch failed:", error);
    return NextResponse.json(
      { error: "Failed to load findings" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    findings: (data ?? []) as AgentFinding[],
  });
}
