// POST /api/pipeline/deepen-signature
//
// User-initiated deepening of a single entity's canonical signature.
// Wraps the existing `deepenNodeSignature()` helper from
// signature-materializer.ts (which previously was only called from
// internal pipeline stages — strategizer, executors). Now reachable
// from the entity-detail drawer's "Deepen" button.
//
// Body: { space_id: string, entity_id: string, run_id?: string | null }
//
// Returns:
//   {
//     ok: true,
//     signature: NodeSignature,    // the deepened (or pinned) signature
//     added: BasisElement | null,  // the new ring, or null if pinned
//     stop_reason: string,         // human-readable explanation
//   }
//
// Behavior notes:
//   - If the entity has NO signature yet, we seed first then deepen.
//   - The deepen call is bounded ~500 tokens; LLM cost ≈ $0.001 per
//     call. Safe to expose to user-driven invocation.
//   - Persists the new signature back to entities.node_signature on
//     success and emits `signature_deepened` if a run_id was provided
//     (so the canvas painter can paint a "ring added" pulse).
//   - Pure read on failure: if the LLM returns no_new_ring, the
//     signature is pinned (resolution.pinned_because = "saturated")
//     and persisted that way so future calls don't keep paying the
//     LLM cost for the same answer.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, verifySpaceOwnership } from "@/lib/api-helpers";
import {
  seedNodeSignature,
  deepenNodeSignature,
  persistSignature,
  emitSignatureDeepened,
  loadAxisMembershipsByEntityId,
} from "@/lib/pipeline/signature-materializer";
import type { Entity, Edge } from "@/types";
import type { ProbabilitySpaceAxis } from "@/types/pipeline-events";

export const maxDuration = 30;
export const runtime = "nodejs";

interface DeepenRequest {
  space_id: string;
  entity_id: string;
  /** Optional pipeline_runs.id — when provided, a `signature_deepened`
   *  event is emitted so the canvas painter can render a "ring added"
   *  pulse. Omit for orthogonal user-driven calls (no SSE in flight). */
  run_id?: string | null;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<Partial<DeepenRequest>>(request);
  if (parseError) return parseError;

  const spaceId = body?.space_id;
  const entityId = body?.entity_id;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json(
      { error: "space_id is required" },
      { status: 400 },
    );
  }
  if (!entityId || typeof entityId !== "string") {
    return NextResponse.json(
      { error: "entity_id is required" },
      { status: 400 },
    );
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Load entity + immediate neighborhood ──────────────────────────
  const { data: entityRow, error: entErr } = await db
    .from("entities")
    .select("*")
    .eq("id", entityId)
    .eq("space_id", spaceId)
    .maybeSingle();
  if (entErr || !entityRow) {
    return NextResponse.json(
      { error: "entity not found" },
      { status: 404 },
    );
  }
  const entity = entityRow as Entity;

  // Pull all edges incident to this entity. Two queries (in/out) so
  // each result naturally typed by direction; cheap at single-entity
  // scope.
  const { data: incomingRows } = await db
    .from("edges")
    .select("relationship_type, mechanism, source_entity_id")
    .eq("space_id", spaceId)
    .eq("target_entity_id", entityId);
  const { data: outgoingRows } = await db
    .from("edges")
    .select("relationship_type, mechanism, target_entity_id")
    .eq("space_id", spaceId)
    .eq("source_entity_id", entityId);

  // Fetch names for the other endpoint of each edge so the LLM has
  // human-readable context. Single batched lookup over the union.
  const otherIds = new Set<string>();
  for (const r of (incomingRows ?? []) as Array<{ source_entity_id: string }>) {
    otherIds.add(r.source_entity_id);
  }
  for (const r of (outgoingRows ?? []) as Array<{ target_entity_id: string }>) {
    otherIds.add(r.target_entity_id);
  }
  const idToName = new Map<string, string>();
  if (otherIds.size > 0) {
    const { data: nameRows } = await db
      .from("entities")
      .select("id, name")
      .in("id", Array.from(otherIds));
    for (const r of (nameRows ?? []) as Array<{ id: string; name: string }>) {
      idToName.set(r.id, r.name);
    }
  }

  const incoming = ((incomingRows ?? []) as Array<{
    relationship_type: string | null;
    mechanism: string | null;
    source_entity_id: string;
  }>).map((r) => ({
    relation: r.relationship_type ?? "related_to",
    from_name: idToName.get(r.source_entity_id) ?? "(unknown)",
    mechanism: r.mechanism,
  }));
  const outgoing = ((outgoingRows ?? []) as Array<{
    relationship_type: string | null;
    mechanism: string | null;
    target_entity_id: string;
  }>).map((r) => ({
    relation: r.relationship_type ?? "related_to",
    to_name: idToName.get(r.target_entity_id) ?? "(unknown)",
    mechanism: r.mechanism,
  }));

  // ── Axis memberships — loadAxisMembershipsByEntityId returns a map
  //    keyed by normalized name; resolve our entity's axes. ──────
  const axisMap = await loadAxisMembershipsByEntityId(db, spaceId);
  const normalizedName = entity.name.toLowerCase().trim();
  let axes: ProbabilitySpaceAxis[] = axisMap.get(normalizedName) ?? [];
  // Defensive: also try the un-normalized variant in case the loader
  // already normalized.
  if (axes.length === 0) {
    axes = axisMap.get(entity.name) ?? [];
  }

  // ── Seed if no signature, then deepen ───────────────────────────
  // The materializer's seed function takes an Entity + edges + axes.
  // We need to assemble Edge[] from the rows we already have.
  // entity.node_signature is typed as `Json | null` in DB types but
  // is structurally a NodeSignature when present — cast on read.
  let signature: import("@/types/node-signature").NodeSignature | null =
    (entity.node_signature as unknown as
      | import("@/types/node-signature").NodeSignature
      | null) ?? null;
  if (!signature) {
    const seedEdges: Edge[] = [
      ...((incomingRows ?? []) as Array<{
        relationship_type: string | null;
        mechanism: string | null;
        source_entity_id: string;
      }>).map(
        (r): Edge =>
          ({
            // Minimum fields the seeder reads — relationship_type,
            // mechanism, source_entity_id, target_entity_id. Other
            // Edge fields are not read; cast keeps types happy
            // without fabricating unused data.
            relationship_type: r.relationship_type ?? "related_to",
            mechanism: r.mechanism,
            source_entity_id: r.source_entity_id,
            target_entity_id: entityId,
          }) as unknown as Edge,
      ),
      ...((outgoingRows ?? []) as Array<{
        relationship_type: string | null;
        mechanism: string | null;
        target_entity_id: string;
      }>).map(
        (r): Edge =>
          ({
            relationship_type: r.relationship_type ?? "related_to",
            mechanism: r.mechanism,
            source_entity_id: entityId,
            target_entity_id: r.target_entity_id,
          }) as unknown as Edge,
      ),
    ];
    signature = seedNodeSignature({
      entity,
      edges: seedEdges,
      axisMemberships: axes,
    });
  }

  // Now deepen. The deepen function calls the LLM and returns the
  // new ring (or null if the model decided not to add one).
  let deepened;
  try {
    deepened = await deepenNodeSignature({
      entity,
      currentSignature: signature,
      neighborhood: {
        incoming,
        outgoing,
        axisMemberships: axes,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: `deepen failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }

  // Persist whether or not a ring was added — pinning the signature
  // also needs to be saved so the next call doesn't pay LLM cost for
  // the same "saturated" answer.
  await persistSignature(db, entityId, deepened.updated);

  // Emit the canvas event when a run id is in scope. Best-effort.
  if (deepened.added && body?.run_id) {
    try {
      await emitSignatureDeepened(
        db,
        body.run_id,
        deepened.updated,
        deepened.added,
      );
    } catch {
      /* non-fatal */
    }
  }

  return NextResponse.json({
    ok: true,
    signature: deepened.updated,
    added: deepened.added,
    stop_reason: deepened.stopReason,
  });
}
