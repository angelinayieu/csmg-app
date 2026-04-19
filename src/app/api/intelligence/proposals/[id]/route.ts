// ── Proposal action endpoint ──
//
// POST /api/intelligence/proposals/[id]
//   body: { action: "approve" | "dismiss" }
//
// "dismiss" just marks the row dismissed.
// "approve" marks the row approved + fires the underlying pipeline
// (critique / synthesis / strategy regen / etc.) and records the outcome.
//
// This is where the user explicitly opts in to expensive operations.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";

export const maxDuration = 120; // executing proposals can trigger full pipelines

type ProposalRow = {
  id: string;
  space_id: string;
  kind: string;
  reason: string;
  payload: Record<string, unknown> | null;
  status: string;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "proposal id required" }, { status: 400 });

  let action: "approve" | "dismiss";
  try {
    const body = await request.json();
    if (body.action !== "approve" && body.action !== "dismiss") {
      return NextResponse.json({ error: "action must be 'approve' or 'dismiss'" }, { status: 400 });
    }
    action = body.action;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // Fetch proposal + verify ownership
    const { data: proposal } = await db
      .from("router_proposals")
      .select("id, space_id, kind, reason, payload, status")
      .eq("id", id)
      .maybeSingle() as { data: ProposalRow | null };

    if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    if (proposal.status !== "pending") {
      return NextResponse.json({ error: `Proposal already ${proposal.status}` }, { status: 400 });
    }

    const { data: space } = await db
      .from("spaces").select("user_id").eq("id", proposal.space_id).maybeSingle();
    if (!space || space.user_id !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    if (action === "dismiss") {
      await db.from("router_proposals")
        .update({ status: "dismissed", dismissed_at: new Date().toISOString() })
        .eq("id", id);
      return NextResponse.json({ dismissed: true, id });
    }

    // ── Approve: mark + fire the underlying pipeline ──
    await db.from("router_proposals")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", id);

    // Dispatch based on kind. Each branch calls the existing pipeline via
    // internal fetch so all the normal auth/RLS/logging runs. We intentionally
    // wait for the result so the user sees the outcome inline.
    const originRequest = request;
    const origin = new URL(originRequest.url).origin;
    const cookieHeader = originRequest.headers.get("cookie") ?? "";

    let executionResult: Record<string, unknown> | null = null;
    let executionError: string | null = null;

    try {
      switch (proposal.kind) {
        case "critique": {
          const res = await fetch(`${origin}/api/pipeline/critique`, {
            method: "POST",
            headers: { "content-type": "application/json", cookie: cookieHeader },
            body: JSON.stringify({ spaceId: proposal.space_id }),
          });
          executionResult = await res.json().catch(() => ({ outcome: "unknown" }));
          if (!res.ok) executionError = `HTTP ${res.status}`;
          break;
        }
        case "synthesis_refresh": {
          // Prefer layered synthesis for hierarchical spaces; fall back to flat.
          const res = await fetch(`${origin}/api/pipeline/synthesize-layered`, {
            method: "POST",
            headers: { "content-type": "application/json", cookie: cookieHeader },
            body: JSON.stringify({ spaceId: proposal.space_id }),
          });
          if (res.status === 400) {
            // layered requires hierarchical; fallback to flat
            const fallbackRes = await fetch(`${origin}/api/pipeline/synthesize`, {
              method: "POST",
              headers: { "content-type": "application/json", cookie: cookieHeader },
              body: JSON.stringify({ spaceId: proposal.space_id }),
            });
            executionResult = await fallbackRes.json().catch(() => ({ outcome: "unknown" }));
            if (!fallbackRes.ok) executionError = `HTTP ${fallbackRes.status}`;
          } else {
            executionResult = await res.json().catch(() => ({ outcome: "unknown" }));
            if (!res.ok) executionError = `HTTP ${res.status}`;
          }
          break;
        }
        case "strategy_regen": {
          // Call the existing strategy refresh endpoint
          const res = await fetch(`${origin}/api/pipeline/strategy-refresh`, {
            method: "POST",
            headers: { "content-type": "application/json", cookie: cookieHeader },
            body: JSON.stringify({ spaceId: proposal.space_id }),
          });
          executionResult = await res.json().catch(() => ({ outcome: "unknown" }));
          if (!res.ok) executionError = `HTTP ${res.status}`;
          break;
        }
        case "probability_space": {
          const focalId = (proposal.payload?.focal_entity_id as string | undefined) ?? null;
          if (!focalId) {
            executionError = "probability_space proposal missing focal_entity_id in payload";
            break;
          }
          const res = await fetch(`${origin}/api/pipeline/probability-space/for-node`, {
            method: "POST",
            headers: { "content-type": "application/json", cookie: cookieHeader },
            body: JSON.stringify({ space_id: proposal.space_id, focal_entity_id: focalId }),
          });
          executionResult = await res.json().catch(() => ({ outcome: "unknown" }));
          if (!res.ok) executionError = `HTTP ${res.status}`;
          break;
        }
        case "pattern_aggregation": {
          const res = await fetch(`${origin}/api/pipeline/probability-space/aggregate-patterns`, {
            method: "POST",
            headers: { "content-type": "application/json", cookie: cookieHeader },
            body: JSON.stringify({}),
          });
          executionResult = await res.json().catch(() => ({ outcome: "unknown" }));
          if (!res.ok) executionError = `HTTP ${res.status}`;
          break;
        }
        default:
          executionError = `Unknown proposal kind: ${proposal.kind}`;
      }
    } catch (err) {
      executionError = err instanceof Error ? err.message : String(err);
    }

    // Update proposal with outcome
    await db.from("router_proposals")
      .update({
        status: executionError ? "failed" : "executed",
        executed_at: new Date().toISOString(),
        execution_result: executionResult ?? { error: executionError },
      })
      .eq("id", id);

    return NextResponse.json({
      approved: true,
      id,
      fired_pipeline: proposal.kind,
      outcome: executionError ? "failed" : "success",
      error: executionError,
      result: executionResult,
    });
  } catch (err) {
    console.error("[intelligence/proposals] Action error:", err);
    return NextResponse.json(
      { error: `Action failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
