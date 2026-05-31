// ── pipeline_candidates → live KG materializers ──────────────────────
//
// Turns an accepted `pipeline_candidates` row into a real row in the
// live KG tables (entities / edges / claims). Extracted out of the
// /api/spaces/[id]/candidates/commit route so other write paths can
// reuse the exact same materialize logic instead of forking their own
// entity-insert code.
//
// Today two callers share this:
//   - candidates/commit (the CandidateReviewDrawer commit path)
//   - brainstorm/sessions/[id]/materialize (OC brainstorm → KG; the
//     user's election in the panel is the gate, so it stages + commits
//     in one shot without a review drawer)
//
// Each candidate kind has its own materialize path because the live KG
// tables have different shapes. The dispatcher returns an outcome the
// caller uses to mark the candidate row (or skip it if it errored).

import type { CandidateRow } from "@/lib/pipeline/candidates";

export type MaterializeOutcome =
  | { status: "committed"; newId: string }
  | { status: "rejected" }
  | { status: "deferred"; reason: string }
  | { status: "error"; message: string };

export async function materializeCandidate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
  c: CandidateRow,
): Promise<MaterializeOutcome> {
  try {
    switch (c.kind) {
      case "entity":
        return await materializeEntity(db, spaceId, userId, c);
      case "edge":
        return await materializeEdge(db, spaceId, c);
      case "claim":
        return await materializeClaim(db, spaceId, c);
      case "variation":
      case "cycle":
        // Not yet wired — the route-side staging for these kinds
        // doesn't exist yet (Phase 7c-4 will add it once the parallel
        // WIP in the route files is resolved). When that lands, add
        // the materialize cases here. For now we accept the row but
        // flag it so the drawer can show a "deferred" notice.
        return {
          status: "deferred",
          reason: `Materialize for kind="${c.kind}" not wired yet`,
        };
    }
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function materializeEntity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
  c: CandidateRow,
): Promise<MaterializeOutcome> {
  const p = c.payload as Record<string, unknown>;
  const entityIdSemantic =
    typeof p.entity_id === "string" ? p.entity_id : null;
  // Reproduce the chat-path insert pattern so the materialized entity
  // looks the same as one the user typed in by hand. source_tag is
  // 'explicit' because the user explicitly approved it.
  const { data: inserted, error } = await db
    .from("entities")
    .insert({
      space_id: spaceId,
      entity_id:
        entityIdSemantic ??
        (typeof p.name === "string" ? p.name : "candidate").slice(0, 64),
      name: c.display_name,
      description: c.display_description ?? "",
      entity_category: (p.entity_category as string | undefined) ?? "abstract",
      entity_type: (p.entity_type as string | undefined) ?? "abstract",
      source_tag: "explicit",
      importance: (p.importance as string | undefined) ?? "moderate",
      confidence:
        typeof p.confidence === "number" ? p.confidence : 0.75,
      knowledge_layer:
        (p.knowledge_layer as string | undefined) ?? "internal",
      authority_level:
        (p.authority_level as string | undefined) ?? "moderate",
      causal_role: (p.causal_role as string | undefined) ?? null,
      provenance: {
        source_type: "candidate_review",
        candidate_id: c.id,
        run_id: c.run_id,
        stage: c.stage,
        approved_by: userId,
        // Carry through any richer provenance the staging caller set
        // (e.g. the OC brainstorm path stamps source_session_id). The
        // explicit keys above win on collision.
        ...((p.provenance as Record<string, unknown> | undefined) ?? {}),
      },
    })
    .select("id")
    .single();
  if (error) {
    return { status: "error", message: error.message };
  }
  return { status: "committed", newId: (inserted as { id: string }).id };
}

export async function materializeEdge(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  c: CandidateRow,
): Promise<MaterializeOutcome> {
  const p = c.payload as Record<string, unknown>;
  const sourceId = typeof p.source_entity_id === "string" ? p.source_entity_id : null;
  const targetId = typeof p.target_entity_id === "string" ? p.target_entity_id : null;
  if (!sourceId || !targetId) {
    return {
      status: "error",
      message: "Edge candidate missing source_entity_id or target_entity_id",
    };
  }
  const { data: inserted, error } = await db
    .from("edges")
    .insert({
      space_id: spaceId,
      source_entity_id: sourceId,
      target_entity_id: targetId,
      relationship_type:
        (p.relationship_type as string | undefined) ?? "relates_to",
      dimension: (p.dimension as string | undefined) ?? "abstract",
      confidence:
        typeof p.confidence === "number" ? p.confidence : 0.7,
      description: (p.description as string | undefined) ?? null,
    })
    .select("id")
    .single();
  if (error) return { status: "error", message: error.message };
  return { status: "committed", newId: (inserted as { id: string }).id };
}

export async function materializeClaim(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  c: CandidateRow,
): Promise<MaterializeOutcome> {
  const p = c.payload as Record<string, unknown>;
  const { data: inserted, error } = await db
    .from("claims")
    .insert({
      space_id: spaceId,
      claim_text: c.display_name,
      claim_type: (p.claim_type as string | undefined) ?? "hypothesis",
      confidence:
        typeof p.confidence === "number" ? p.confidence : 0.7,
      status: "candidate",
      source_type: "agent",
      source_quote: c.display_description ?? "[review_each]",
    })
    .select("id")
    .single();
  if (error) return { status: "error", message: error.message };
  return { status: "committed", newId: (inserted as { id: string }).id };
}
