/**
 * POST /api/agent-findings/[id]/review
 *
 * Wave D L3.5 — transition a finding's status. Body:
 *   { action: 'review' | 'act' | 'dismiss', note?: string }
 *
 * Mapping:
 *   review   → status='reviewed'
 *   act      → status='acted_on'
 *   dismiss  → status='dismissed'
 *
 * The trigger on agent_findings stamps `reviewed_at` + `reviewed_by` on
 * status transitions, so this route only writes `status` (and an
 * optional note into payload.review_note so we don't add a nullable
 * review_note column for what's typically one-line text).
 *
 * Also records a user_event of type 'finding.reviewed' so the Wave C
 * digest learns that the user is actively triaging findings — a signal
 * of engagement vs. passive use.
 */

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { recordUserEvent } from "@/lib/user-events/record";
import type { ReviewAgentFindingInput } from "@/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Finding id required" }, { status: 400 });
  }

  const parsed = await safeJsonParse<ReviewAgentFindingInput>(request);
  if (parsed.error) return parsed.error;
  const { action, note } = parsed.data;

  const statusMap: Record<string, string> = {
    review: "reviewed",
    act: "acted_on",
    dismiss: "dismissed",
  };
  const nextStatus = statusMap[action];
  if (!nextStatus) {
    return NextResponse.json(
      { error: "Invalid action — expected review|act|dismiss" },
      { status: 400 },
    );
  }

  // Load the row first so we (a) confirm ownership, (b) merge into existing payload.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error: loadErr } = await (supabase as any)
    .from("agent_findings")
    .select("id, user_id, space_id, ref_kind, ref_id, payload, finding_kind")
    .eq("id", id)
    .single();

  if (loadErr || !existing) {
    return NextResponse.json({ error: "Finding not found" }, { status: 404 });
  }
  if (existing.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const mergedPayload: Record<string, unknown> = {
    ...((existing.payload as Record<string, unknown>) ?? {}),
  };
  if (note && note.trim().length > 0) {
    mergedPayload.review_note = note.trim().slice(0, 500);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updErr } = await (supabase as any)
    .from("agent_findings")
    .update({
      status: nextStatus,
      payload: mergedPayload,
    })
    .eq("id", id);

  if (updErr) {
    console.error("[agent-findings/review] update failed:", updErr);
    return NextResponse.json(
      { error: "Failed to update finding" },
      { status: 500 },
    );
  }

  // Record a user_event so Wave C digest sees the triage action.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await recordUserEvent(supabase as any, {
      user_id: user.id,
      event_type: "misc",
      source: "api:agent-findings:review",
      ref_kind: existing.ref_kind ?? "finding",
      ref_id: existing.ref_id ?? id,
      space_id: existing.space_id ?? undefined,
      payload: {
        subtype: `finding.${action}`,
        finding_id: id,
        finding_kind: existing.finding_kind,
        note: note ?? null,
      },
    });
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({
    id,
    status: nextStatus,
  });
}
