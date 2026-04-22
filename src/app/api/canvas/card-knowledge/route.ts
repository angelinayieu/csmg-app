// POST /api/canvas/card-knowledge
//
// Arc 5B.4. Card-focused knowledge-graph context lookup. Returns:
//   • relatedEntities — 6-8 semantically closest entities (vector retrieval)
//   • axioms — Tier-7 axioms that overlap the card's content (textual match
//             against synthesis_data.axioms[])
//   • convergences — insight convergences relevant to the card's content
//
// The axiom + convergence match is keyword-based on the card's primary_text
// — cheaper than a second LLM round-trip and reliable enough because the
// synthesis_data keys are already condensed, high-signal strings.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import { retrieveEntities } from "@/lib/memory/retrieve";

export const maxDuration = 15;

interface CardKnowledgeRequest {
  spaceId: string;
  shape_id: string;
  shape_type: string;
  primary_text: string;
  thread_ancestors?: Array<{ author: string | null; text: string; depth: number }>;
}

interface CardKnowledgeEntity {
  id: string;
  entity_id: string;
  name: string;
  description: string;
  entity_category: string | null;
  score: number;
}

interface CardKnowledgeAxiom {
  id: string;
  name: string;
  statement: string;
  tier: string | null;
}

interface CardKnowledgeConvergence {
  id: string;
  insight: string;
  supporting_count: number;
}

interface CardKnowledgeResponse {
  relatedEntities: CardKnowledgeEntity[];
  axioms: CardKnowledgeAxiom[];
  convergences: CardKnowledgeConvergence[];
}

/** Cheap keyword-match scorer: counts shared lowercase words (>3 chars). */
function scoreOverlap(query: string, candidate: string): number {
  const qSet = new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  );
  if (qSet.size === 0) return 0;
  const cWords = candidate.toLowerCase().split(/[^a-z0-9]+/);
  let hits = 0;
  for (const w of cWords) {
    if (qSet.has(w)) hits++;
  }
  return hits;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<CardKnowledgeRequest>(request);
  if (parseError) return parseError;

  const { spaceId, primary_text, thread_ancestors = [] } = body;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // Build the retrieval query — primary text + ancestors collapsed so the
  // vector search sees the full conversational scope.
  const queryText = [
    primary_text,
    ...thread_ancestors.map((a) => a.text),
  ]
    .join(" ")
    .slice(0, 1500);

  if (queryText.trim().length < 3) {
    return NextResponse.json({
      relatedEntities: [],
      axioms: [],
      convergences: [],
    });
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    // ── Entity retrieval via vector store (memory_items) ──────────────
    const hits = await retrieveEntities(db, {
      owner_id: user.id,
      query_text: queryText,
      k: 8,
      min_salience: 0,
    });

    // Hydrate name/description from the entities table (same pattern as
    // /api/canvas/ambient). MemoryHit wraps { item, similarity } — the
    // entity row id lives on item.ref_id (primary entity FK for kind="entity"
    // items). scope_ref_id is space-scoped, not entity-id.
    const entityIds = hits
      .map((h) => h.item.ref_id)
      .filter((id): id is string => !!id);
    let entityRows: Array<{
      id: string;
      entity_id: string | null;
      name: string;
      description: string | null;
      entity_category: string | null;
    }> = [];
    if (entityIds.length > 0) {
      const { data } = await db
        .from("entities")
        .select("id, entity_id, name, description, entity_category")
        .in("id", entityIds);
      entityRows = (data ?? []) as typeof entityRows;
    }
    const byId = new Map(entityRows.map((e) => [e.id, e]));

    const relatedEntities: CardKnowledgeEntity[] = hits
      .map((h) => {
        const row = byId.get(h.item.ref_id);
        if (!row) return null;
        return {
          id: row.id,
          entity_id: row.entity_id ?? row.id,
          name: row.name,
          description: row.description ?? "",
          entity_category: row.entity_category ?? null,
          score: h.similarity,
        };
      })
      .filter((e): e is CardKnowledgeEntity => e !== null);

    // ── Axioms + convergences from synthesis_data JSONB ───────────────
    const { data: spaceRow } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const sd = (spaceRow?.synthesis_data ?? null) as Record<string, unknown> | null;

    const axiomList = Array.isArray(sd?.axioms) ? (sd.axioms as unknown[]) : [];
    const convergenceList = Array.isArray(sd?.insight_convergences)
      ? (sd.insight_convergences as unknown[])
      : [];

    // Score each axiom against the query text; return top 4.
    const scoredAxioms = axiomList
      .map((a) => {
        const ax = a as { id?: string; name?: string; statement?: string; tier?: string };
        const score = scoreOverlap(queryText, `${ax.name ?? ""} ${ax.statement ?? ""}`);
        return { ax, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);

    const axioms: CardKnowledgeAxiom[] = scoredAxioms.map(({ ax }) => ({
      id: ax.id ?? `ax-${Math.random().toString(36).slice(2, 8)}`,
      name: ax.name ?? "Unnamed axiom",
      statement: ax.statement ?? "",
      tier: ax.tier ?? null,
    }));

    // Similar pattern for convergences.
    const scoredConvergences = convergenceList
      .map((c) => {
        const cv = c as {
          id?: string;
          insight?: string;
          pattern?: string;
          supporting_signals?: unknown[];
        };
        const insightText = cv.insight ?? cv.pattern ?? "";
        const score = scoreOverlap(queryText, insightText);
        return { cv, insightText, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const convergences: CardKnowledgeConvergence[] = scoredConvergences.map(
      ({ cv, insightText }) => ({
        id: cv.id ?? `cv-${Math.random().toString(36).slice(2, 8)}`,
        insight: insightText,
        supporting_count: Array.isArray(cv.supporting_signals)
          ? cv.supporting_signals.length
          : 0,
      }),
    );

    const payload: CardKnowledgeResponse = {
      relatedEntities,
      axioms,
      convergences,
    };
    return NextResponse.json(payload);
  } catch (err) {
    console.warn("[canvas/card-knowledge]", err);
    return NextResponse.json(
      {
        error: `Knowledge lookup failed: ${sanitizeErrorMessage(err)}`,
        relatedEntities: [],
        axioms: [],
        convergences: [],
      },
      { status: 500 },
    );
  }
}
