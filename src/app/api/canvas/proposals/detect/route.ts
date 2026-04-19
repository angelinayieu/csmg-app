// POST /api/canvas/proposals/detect
//
// Sprint 3 — span-anchored ambient detection. Called by the canvas client
// (debounced 600ms on keystroke). Rewrites pending proposals for the
// given (canvas_id, note_id) pair:
//
//   1. Verify the user owns the canvas.
//   2. Segment note_text into candidate spans (lib/canvas/segment.ts).
//   3. For each span, run semantic retrieval against memory_items
//      (kind='entity'), filtering by similarity threshold.
//   4. For each span+candidate pair, upsert a concept_proposals row.
//      The partial unique index uq_proposals_pending_unique guarantees
//      we don't pile up duplicates when the user types a character and
//      the same span is re-analyzed.
//   5. Mark any previously-pending proposals for this note that no
//      longer correspond to a live span as 'superseded'.
//   6. Return proposals grouped by span, so the rail can render without
//      a second GET.
//
// The endpoint is idempotent — calling it twice in a row with identical
// text writes no new rows. This is load-bearing: the client debounces
// but the server must stay cheap if the client misfires.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { ProposalDetectRequestSchema } from "@/lib/schemas/canvas-substrate";
import { segmentText, type TextSegment } from "@/lib/canvas/segment";
import { retrieveEntities } from "@/lib/memory/retrieve";
import type { ConceptProposal, Canvas } from "@/types";

export const maxDuration = 15;

interface DetectResponseSpan {
  start_offset: number;
  end_offset: number;
  anchored_text: string;
  proposals: Array<ConceptProposal & {
    entity_name?: string | null;
    entity_space_name?: string | null;
  }>;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse(request);
  if (parseError) return parseError;

  const parsed = ProposalDetectRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const {
    canvas_id,
    note_id,
    note_text,
    min_similarity = 0.35,
    candidates_per_span = 3,
  } = parsed.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // 1. Canvas ownership check — use scope + ref for downstream retrieval filter.
  const { data: canvas } = (await db
    .from("canvases")
    .select("id, owner_id, scope, scope_ref_id")
    .eq("id", canvas_id)
    .eq("owner_id", user.id)
    .maybeSingle()) as { data: Pick<Canvas, "id" | "scope" | "scope_ref_id"> | null };

  if (!canvas) {
    return NextResponse.json({ error: "Canvas not found" }, { status: 404 });
  }

  // 2. Segment the note
  const segments = segmentText(note_text);
  if (segments.length === 0) {
    await supersedeStalePending(db, user.id, canvas_id, note_id, []);
    return NextResponse.json({ spans: [] });
  }

  // 3. Retrieval per span — parallel, capped
  const retrievals = await Promise.all(
    segments.map(async (seg) => {
      const hits = await retrieveEntities(db, {
        owner_id: user.id,
        query_text: seg.text,
        k: candidates_per_span,
      });
      return { segment: seg, hits: hits.filter((h) => h.similarity >= min_similarity) };
    }),
  );

  // 4. Hydrate candidate entity info so the client can render names + spaces
  //    without a separate query per proposal.
  const candidateEntityIds = Array.from(
    new Set(
      retrievals.flatMap((r) => r.hits.map((h) => h.item.ref_id)),
    ),
  );
  const entityHydrationById = new Map<
    string,
    { name: string; description: string | null; space_id: string; space_name: string | null }
  >();
  if (candidateEntityIds.length > 0) {
    const { data: entityRows } = (await db
      .from("entities")
      .select("id, name, description, space_id")
      .in("id", candidateEntityIds)) as {
      data: Array<{
        id: string;
        name: string;
        description: string | null;
        space_id: string;
      }> | null;
    };
    const spaceIdsNeeded = Array.from(
      new Set((entityRows ?? []).map((e) => e.space_id)),
    );
    const { data: spaceRows } = (await db
      .from("spaces")
      .select("id, name")
      .in("id", spaceIdsNeeded)) as {
      data: Array<{ id: string; name: string }> | null;
    };
    const spaceNameById = new Map(
      (spaceRows ?? []).map((s) => [s.id, s.name]),
    );
    for (const e of entityRows ?? []) {
      entityHydrationById.set(e.id, {
        name: e.name,
        description: e.description,
        space_id: e.space_id,
        space_name: spaceNameById.get(e.space_id) ?? null,
      });
    }
  }

  // 5. Compute target_canvas_id for each candidate entity.
  //    If the candidate lives in a space that is NOT the current canvas's
  //    scope_ref (and the current canvas is project-scope), accepting the
  //    proposal should create a cross-canvas bridge. We surface
  //    target_canvas_id on the proposal so the ProposalRail + resolve
  //    handler know to promote to bridges.
  //
  //    For universal/objective canvases, target_canvas_id is the entity's
  //    owning space-canvas (looked up by scope_ref_type='space', scope_ref_id=entity.space_id).
  const entitySpaceIds = Array.from(
    new Set(
      Array.from(entityHydrationById.values()).map((e) => e.space_id),
    ),
  );
  const canvasBySpaceId = new Map<string, string>();
  if (entitySpaceIds.length > 0) {
    const { data: spaceCanvases } = (await db
      .from("canvases")
      .select("id, scope_ref_id")
      .eq("owner_id", user.id)
      .eq("scope", "project")
      .eq("scope_ref_type", "space")
      .eq("archived", false)
      .in("scope_ref_id", entitySpaceIds)) as {
      data: Array<{ id: string; scope_ref_id: string }> | null;
    };
    for (const row of spaceCanvases ?? []) {
      canvasBySpaceId.set(row.scope_ref_id, row.id);
    }
  }

  // 6. Upsert concept_proposals + collect live proposal ids for the supersede sweep
  const liveProposalIds: string[] = [];
  const responseSpans: DetectResponseSpan[] = [];

  for (const { segment, hits } of retrievals) {
    const spanProposals: DetectResponseSpan["proposals"] = [];

    for (const hit of hits) {
      const hydration = entityHydrationById.get(hit.item.ref_id);
      if (!hydration) continue;

      // Skip if this entity already has an accepted span for this note —
      // the retrieval can't know about acceptance state, so we check here.
      const { data: existingAccepted } = (await db
        .from("note_entity_spans")
        .select("id")
        .eq("canvas_id", canvas_id)
        .eq("note_id", note_id)
        .eq("entity_id", hit.item.ref_id)
        .eq("status", "accepted")
        .maybeSingle()) as { data: { id: string } | null };
      if (existingAccepted) continue;

      // Compute target_canvas_id (null if the entity lives in the same
      // space this canvas is already scoped to).
      const entitySpaceId = hydration.space_id;
      const entityCanvasId = canvasBySpaceId.get(entitySpaceId) ?? null;
      const sameCanvas =
        canvas.scope_ref_id === entitySpaceId ||
        (entityCanvasId && entityCanvasId === canvas_id);
      const target_canvas_id = sameCanvas ? null : entityCanvasId;

      const rationale = buildRationale(segment, hydration, hit.similarity);

      // Upsert via the partial unique index
      const payload = {
        owner_id: user.id,
        canvas_id,
        note_id,
        start_offset: segment.start,
        end_offset: segment.end,
        anchored_text: segment.text,
        entity_id: hit.item.ref_id,
        target_canvas_id,
        rationale,
        confidence: Math.max(0, Math.min(1, hit.similarity)),
        source: "ambient" as const,
        status: "pending" as const,
      };

      // First try update of an already-pending row; if not found, insert.
      const { data: existingPending } = (await db
        .from("concept_proposals")
        .select("id")
        .eq("canvas_id", canvas_id)
        .eq("note_id", note_id)
        .eq("status", "pending")
        .eq("start_offset", segment.start)
        .eq("end_offset", segment.end)
        .eq("entity_id", hit.item.ref_id)
        .maybeSingle()) as { data: { id: string } | null };

      let proposalId: string | null = null;
      if (existingPending) {
        const { data: updated } = (await db
          .from("concept_proposals")
          .update({
            anchored_text: segment.text,
            rationale,
            confidence: payload.confidence,
            target_canvas_id,
          })
          .eq("id", existingPending.id)
          .select("*")
          .single()) as { data: ConceptProposal | null };
        if (updated) {
          proposalId = updated.id;
          spanProposals.push({
            ...updated,
            entity_name: hydration.name,
            entity_space_name: hydration.space_name,
          });
        }
      } else {
        const { data: inserted, error: insertErr } = (await db
          .from("concept_proposals")
          .insert(payload)
          .select("*")
          .single()) as { data: ConceptProposal | null; error: unknown };
        if (insertErr) {
          console.warn("[proposals/detect] insert failed:", insertErr);
          continue;
        }
        if (inserted) {
          proposalId = inserted.id;
          spanProposals.push({
            ...inserted,
            entity_name: hydration.name,
            entity_space_name: hydration.space_name,
          });
        }
      }

      if (proposalId) liveProposalIds.push(proposalId);
    }

    if (spanProposals.length > 0) {
      responseSpans.push({
        start_offset: segment.start,
        end_offset: segment.end,
        anchored_text: segment.text,
        proposals: spanProposals,
      });
    }
  }

  // 7. Supersede stale pending proposals (spans that no longer exist after
  //    this round of detection).
  await supersedeStalePending(db, user.id, canvas_id, note_id, liveProposalIds);

  return NextResponse.json({ spans: responseSpans });
}

/**
 * Mark any pending proposals on this note whose id is not in the live set
 * as 'superseded'. Called after each detect run to keep the rail clean.
 */
async function supersedeStalePending(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  ownerId: string,
  canvasId: string,
  noteId: string,
  liveIds: string[],
): Promise<void> {
  const { data: pending } = (await db
    .from("concept_proposals")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("canvas_id", canvasId)
    .eq("note_id", noteId)
    .eq("status", "pending")) as { data: Array<{ id: string }> | null };

  const liveSet = new Set(liveIds);
  const stale = (pending ?? [])
    .filter((p) => !liveSet.has(p.id))
    .map((p) => p.id);
  if (stale.length === 0) return;

  await db
    .from("concept_proposals")
    .update({ status: "superseded" })
    .in("id", stale);
}

function buildRationale(
  segment: TextSegment,
  entity: { name: string; description: string | null; space_name: string | null },
  similarity: number,
): string {
  const sim = Math.round(similarity * 100);
  if (entity.space_name) {
    return `“${entity.name}” from ${entity.space_name} (${sim}% match)`;
  }
  return `“${entity.name}” (${sim}% match)`;
}
