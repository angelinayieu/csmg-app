// POST /api/proposals/[id]/resolve
//
// Sprint 3 — action a pending concept proposal.
//
//   action='accept'    →
//     1. Insert a note_entity_spans row (status='accepted', anchored to
//        the proposal's (canvas_id, note_id, start_offset, end_offset)).
//     2. If the proposal carries target_canvas_id, also insert a bridges
//        row of origin='ambient_promoted', status='user_confirmed',
//        bridge_type='identity' (most common for ambient promotions).
//     3. Mark proposal status='accepted'.
//
//   action='reject'    → proposal status='rejected'. Kept as "do not
//                        resurface" signal; the next detect run skips
//                        reproposing the same (canvas, note, span, entity)
//                        because the partial unique index's filter on
//                        status='pending' still lets a new row be
//                        inserted, but we gate the insert by checking
//                        rejected rows first (future refinement).
//
//   action='dismiss'   → proposal status='dismissed'. Same effect as
//                        reject from the UI perspective, but marked
//                        distinctly for analytics / future re-surfacing.
//
// Accept path is additive-only — it never deletes. Re-accepting the same
// (canvas, note, entity, span) is idempotent thanks to the note_entity_spans
// partial unique index (uq_spans_accepted).

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { ResolveProposalInputSchema } from "@/lib/schemas/canvas-substrate";
import type { ConceptProposal, Canvas } from "@/types";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: proposalId } = await ctx.params;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const parsed = ResolveProposalInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Load the proposal (ownership enforced by RLS + explicit owner filter).
  const { data: proposal } = (await db
    .from("concept_proposals")
    .select("*")
    .eq("id", proposalId)
    .eq("owner_id", user.id)
    .maybeSingle()) as { data: ConceptProposal | null };

  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }
  if (proposal.status !== "pending") {
    return NextResponse.json(
      { error: `Proposal is already ${proposal.status}` },
      { status: 409 },
    );
  }

  // ── Reject / dismiss — cheap status flip ──
  if (input.action === "reject" || input.action === "dismiss") {
    const nextStatus = input.action === "reject" ? "rejected" : "dismissed";
    const { data: updated, error } = (await db
      .from("concept_proposals")
      .update({
        status: nextStatus,
        resolved_by: user.id,
      })
      .eq("id", proposalId)
      .select("*")
      .single()) as { data: ConceptProposal | null; error: unknown };
    if (error) {
      console.error("[proposal resolve reject] error:", error);
      return NextResponse.json(
        { error: "Failed to resolve proposal" },
        { status: 500 },
      );
    }

    // Wave C — log user event for digest agent.
    try {
      const { recordUserEvent } = await import("@/lib/user-events/record");
      await recordUserEvent(db, {
        user_id: user.id,
        event_type:
          input.action === "reject"
            ? "proposal.rejected"
            : "proposal.dismissed",
        source: `user:${input.action}:${user.id}`,
        ref_kind: "proposal",
        ref_id: proposalId,
        payload: {
          candidate_entity_id: proposal.entity_id,
          source: proposal.source,
          confidence: proposal.confidence,
        },
      });
    } catch {
      /* non-fatal */
    }

    return NextResponse.json({ proposal: updated });
  }

  // ── Accept path ──
  if (input.action !== "accept") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  // Sprint 3 constraint: only accept proposals with a concrete entity_id.
  // Creating a new entity from proposed_entity_name is deferred to a
  // later sprint because it requires picking a target space (ambiguous
  // for universal-scope canvases) and running at least the entity-sanitize
  // step. For now, reject with a clear 501.
  if (!proposal.entity_id) {
    return NextResponse.json(
      {
        error:
          "Accepting a new concept (proposed_entity_name) isn't supported yet. Reject for now; entity materialization ships in a later sprint.",
      },
      { status: 501 },
    );
  }

  // Need canvas scope for span + optional bridge construction.
  const { data: canvas } = (await db
    .from("canvases")
    .select("id, scope, scope_ref_id")
    .eq("id", proposal.canvas_id)
    .eq("owner_id", user.id)
    .maybeSingle()) as {
    data: Pick<Canvas, "id" | "scope" | "scope_ref_id"> | null;
  };
  if (!canvas) {
    return NextResponse.json(
      { error: "Canvas not found for this proposal" },
      { status: 404 },
    );
  }

  // 1. Insert / reuse note_entity_spans row.
  let spanId: string | null = null;
  if (proposal.start_offset !== null && proposal.end_offset !== null) {
    // Try insert; on conflict with uq_spans_accepted, select the existing row.
    const { data: existing } = (await db
      .from("note_entity_spans")
      .select("id")
      .eq("canvas_id", proposal.canvas_id)
      .eq("note_id", proposal.note_id)
      .eq("entity_id", proposal.entity_id)
      .eq("start_offset", proposal.start_offset)
      .eq("end_offset", proposal.end_offset)
      .eq("status", "accepted")
      .maybeSingle()) as { data: { id: string } | null };

    if (existing) {
      spanId = existing.id;
    } else {
      const { data: inserted, error: spanErr } = (await db
        .from("note_entity_spans")
        .insert({
          owner_id: user.id,
          canvas_id: proposal.canvas_id,
          note_id: proposal.note_id,
          entity_id: proposal.entity_id,
          start_offset: proposal.start_offset,
          end_offset: proposal.end_offset,
          anchored_text: proposal.anchored_text,
          status: "accepted",
          source:
            proposal.source === "ambient" ? "ambient" : "manual",
          confidence: proposal.confidence,
          resolved_by: user.id,
        })
        .select("id")
        .single()) as { data: { id: string } | null; error: unknown };
      if (spanErr) {
        console.error("[proposal accept] span insert failed:", spanErr);
        return NextResponse.json(
          { error: "Failed to create span" },
          { status: 500 },
        );
      }
      spanId = inserted?.id ?? null;
    }
  }

  // 2. If cross-canvas, promote to a bridge.
  let bridgeId: string | null = null;
  if (proposal.target_canvas_id) {
    // We need a source_entity on the CURRENT canvas. The current canvas
    // may not have an entity that represents this sticky note — the span
    // IS the source. For Sprint 3 we create a minimal bridge referencing
    // the accepted entity on both sides (identity link) — Sprint 4 lets
    // the user hand-refine source/target. This keeps synthesis useful
    // without blocking on editor work.
    //
    // Concretely: bridges requires source_entity_id + target_entity_id
    // both non-null. For this ambient-promoted case we use the accepted
    // entity as both endpoints — a structural self-identity that signals
    // "this entity was confirmed present in this canvas's context."
    //
    // If the target canvas's scope_ref is a space (project canvas), we
    // need source_space_id too.

    const { data: targetCanvas } = (await db
      .from("canvases")
      .select("scope, scope_ref_type, scope_ref_id")
      .eq("id", proposal.target_canvas_id)
      .eq("owner_id", user.id)
      .maybeSingle()) as {
      data: {
        scope: string;
        scope_ref_type: string | null;
        scope_ref_id: string | null;
      } | null;
    };

    // Resolve source space: prefer the current canvas's space, fall back
    // to the target's space (self-bridge).
    const sourceSpaceId =
      canvas.scope_ref_id && canvas.scope === "project"
        ? canvas.scope_ref_id
        : targetCanvas?.scope_ref_id ?? null;
    const targetSpaceId = targetCanvas?.scope_ref_id ?? null;

    if (sourceSpaceId && targetSpaceId) {
      const { data: bridgeRow, error: bridgeErr } = (await db
        .from("bridges")
        .insert({
          source_space_id: sourceSpaceId,
          source_entity_id: proposal.entity_id,
          target_space_id: targetSpaceId,
          target_entity_id: proposal.entity_id,
          bridge_type: "identity",
          coupling_strength: "moderate",
          coupling_direction: "bidirectional",
          shared_variable_name: "ambient_confirmed",
          description: proposal.rationale ?? "Confirmed present via ambient detection",
          discovery_method: "manual",
          confidence: proposal.confidence,
          canvas_id: proposal.canvas_id,
          origin: "ambient_promoted",
          status: "user_confirmed",
          created_by: user.id,
          rationale: proposal.rationale,
        })
        .select("id")
        .single()) as { data: { id: string } | null; error: unknown };
      if (bridgeErr) {
        // The unique-active-triple index can collide if an identical
        // active bridge already exists. That's fine — log + continue.
        console.warn("[proposal accept] bridge insert non-fatal:", bridgeErr);
      } else {
        bridgeId = bridgeRow?.id ?? null;
      }
    }
  }

  // 3. Flip proposal status
  const { data: updated, error: updErr } = (await db
    .from("concept_proposals")
    .update({
      status: "accepted",
      span_id: spanId,
      resolved_by: user.id,
    })
    .eq("id", proposalId)
    .select("*")
    .single()) as { data: ConceptProposal | null; error: unknown };

  if (updErr) {
    console.error("[proposal accept] status update failed:", updErr);
    return NextResponse.json(
      { error: "Failed to mark proposal accepted" },
      { status: 500 },
    );
  }

  // Wave C — log user event: proposal accepted + optional bridge created.
  try {
    const { recordUserEvent } = await import("@/lib/user-events/record");
    await recordUserEvent(db, {
      user_id: user.id,
      event_type: "proposal.accepted",
      source: `user:accept:${user.id}`,
      ref_kind: "proposal",
      ref_id: proposalId,
      payload: {
        entity_id: proposal.entity_id,
        span_id: spanId,
        bridge_id: bridgeId,
        source: proposal.source,
        confidence: proposal.confidence,
        cross_canvas: !!bridgeId,
      },
    });
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({
    proposal: updated,
    span_id: spanId,
    bridge_id: bridgeId,
  });
}
