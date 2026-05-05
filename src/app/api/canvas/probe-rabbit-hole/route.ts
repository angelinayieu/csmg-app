// POST /api/canvas/probe-rabbit-hole
//
// User clicks "Probe" on a card or dispatches the dock:probe event;
// this endpoint generates a trail tree (probe → decompose → 2-4 sub-
// questions → result terminal) and returns it for the canvas to spawn
// as a probe-trail tldraw shape near the source card.
//
// MVP scope (2026-07-04): trail visualizes the agent's PLAN. Each
// sub-question node is initially "idle" — clicking one fires
// /api/pipeline/research-deep with the question as focusAreas (handled
// by the shape's onClick, not this endpoint).
//
// Body: { entity_id: string, question: string, observed_relationships?: string[] }
// Response: ProbeTrail (see probe-orchestrator.ts) on success;
//   { error } on auth/validation failure. The orchestrator NEVER
//   throws — it falls back to a minimal trail when LLM fails. So
//   200 here means "trail is renderable," not "LLM succeeded." The
//   `llm_succeeded` field on the response distinguishes.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage, safeJsonParse } from "@/lib/api-helpers";
import { generateProbeTrail, type ProbeTrail } from "@/lib/pipeline/probe-orchestrator";

export const maxDuration = 30;
export const runtime = "nodejs";

interface RequestBody {
  entity_id?: string;
  question?: string;
  /** Optional. When the caller already has the neighborhood context
   *  (e.g., the card menu has it in scope), passing it here saves a
   *  second DB roundtrip. Otherwise we fetch it. */
  observed_relationships?: string[];
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseErr } = await safeJsonParse<RequestBody>(request);
  if (parseErr) return parseErr;

  const entityId = typeof body?.entity_id === "string" ? body.entity_id : "";
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!entityId) {
    return NextResponse.json({ error: "entity_id required" }, { status: 400 });
  }
  if (question.length < 4) {
    return NextResponse.json(
      { error: "question must be substantive (≥4 chars)" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Load entity + verify ownership
  const { data: entity } = (await db
    .from("entities")
    .select("id, entity_id, space_id, name, description, layer")
    .eq("id", entityId)
    .maybeSingle()) as {
    data: {
      id: string;
      entity_id: string;
      space_id: string;
      name: string;
      description: string | null;
      layer: string | null;
    } | null;
  };
  if (!entity) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }
  const { data: space } = (await db
    .from("spaces")
    .select("id, synthesis_data")
    .eq("id", entity.space_id)
    .eq("user_id", user.id)
    .maybeSingle()) as {
    data: { id: string; synthesis_data: Record<string, unknown> | null } | null;
  };
  if (!space) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Fetch neighborhood relationships if caller didn't provide. Same
  // shape as research-questions endpoint uses — keeps the LLM
  // grounded in the actual graph topology.
  let relationships: string[];
  if (Array.isArray(body?.observed_relationships)) {
    relationships = body.observed_relationships
      .filter((r): r is string => typeof r === "string")
      .slice(0, 24);
  } else {
    relationships = await fetchNeighborhood(db, entity);
  }

  // Existing open questions — avoid duplicating ones the user already has.
  const synth = (space.synthesis_data ?? {}) as Record<string, unknown>;
  const rawOpen = Array.isArray(synth.open_questions) ? synth.open_questions : [];
  const existingOpen = rawOpen
    .map((q): string | null => {
      if (typeof q === "string") return q;
      if (q && typeof q === "object") {
        const obj = q as { question?: unknown };
        return typeof obj.question === "string" ? obj.question : null;
      }
      return null;
    })
    .filter((q): q is string => !!q && q.length > 0)
    .slice(0, 12);

  let trail: ProbeTrail;
  try {
    trail = await generateProbeTrail({
      source_entity_id: entity.id,
      source_entity_name: entity.name,
      source_entity_description: entity.description,
      source_entity_layer: entity.layer,
      root_question: question,
      observed_relationships: relationships,
      existing_open_questions: existingOpen,
    });
  } catch (err) {
    // generateProbeTrail itself never throws (it returns a fallback),
    // but defensive in case a future change adds throwing behavior.
    console.error("[probe-rabbit-hole] orchestrator threw:", err);
    return NextResponse.json(
      { error: `Probe failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }

  return NextResponse.json(trail);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchNeighborhood(db: any, entity: {
  id: string;
  name: string;
}): Promise<string[]> {
  const { data: edgeRows } = (await db
    .from("edges")
    .select("source_entity_id, target_entity_id, relationship_type, polarity")
    .or(`source_entity_id.eq.${entity.id},target_entity_id.eq.${entity.id}`)
    .limit(40)) as {
    data: Array<{
      source_entity_id: string;
      target_entity_id: string;
      relationship_type: string | null;
      polarity: string | null;
    }> | null;
  };
  const neighborIds = Array.from(
    new Set(
      (edgeRows ?? [])
        .flatMap((e) => [e.source_entity_id, e.target_entity_id])
        .filter((id) => id !== entity.id),
    ),
  ).slice(0, 24);
  if (neighborIds.length === 0) return [];
  const { data: nameRows } = (await db
    .from("entities")
    .select("id, name")
    .in("id", neighborIds)) as {
    data: Array<{ id: string; name: string }> | null;
  };
  const byId = new Map((nameRows ?? []).map((n) => [n.id, n.name]));
  return (edgeRows ?? [])
    .map((e) => {
      const otherId =
        e.source_entity_id === entity.id ? e.target_entity_id : e.source_entity_id;
      const other = byId.get(otherId);
      if (!other) return null;
      const dir = e.source_entity_id === entity.id ? "→" : "←";
      return `${entity.name} ${dir} ${other} (${e.relationship_type ?? "relates_to"}${e.polarity && e.polarity !== "neutral" ? ` · ${e.polarity}` : ""})`;
    })
    .filter((s): s is string => s !== null)
    .slice(0, 24);
}
