// ── Canvas ambient AI ── (Sprint 2 — semantic retrieval)
//
// POST /api/canvas/ambient
//   body: { spaceId, text }
//   → { relatedEntities: Array<{id, entity_id, name, description, entity_category, space_id, space_name, score}>,
//       questions: string[] }
//
// Sprint 2 replaces the lexical detectEntities() matcher with the
// memory_items vector store. Response shape is unchanged so existing
// HUD rail clients keep working.
//
// Retrieval details:
//  - Owner-scoped (RLS + explicit filter) — no global peeking.
//  - Kind-filtered to 'entity' for the relatedEntities payload.
//  - Recency decay (30-day half-life) + salience boost applied server-side
//    in lib/memory/retrieve.ts before the response.
//  - Lexical fallback: if retrieval returns nothing (memory store not yet
//    backfilled for this user), fall back to the old lexical path so first-
//    run UX doesn't break.
//  - Questions: kept deterministic heuristic generator for now; LLM-quality
//    probes are deferred to a separate endpoint (Sprint 3 surface).

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import {
  detectEntities,
  generateOpenQuestions,
  type PatternMatchResult,
} from "@/lib/whiteboard/playground-detector";
import { retrieveEntities } from "@/lib/memory/retrieve";
import type { Entity } from "@/types";

export const maxDuration = 10;

interface AmbientRequest {
  spaceId: string;
  text: string;
}

interface RelatedEntity {
  id: string;
  entity_id: string;
  name: string;
  description: string;
  entity_category: string | null;
  space_id: string;
  space_name: string;
  score: number;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } =
    await safeJsonParse<AmbientRequest>(request);
  if (parseError) return parseError;

  const { spaceId, text } = body;
  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }
  if (typeof text !== "string" || text.trim().length < 3) {
    return NextResponse.json({ relatedEntities: [], questions: [] });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // 1. Semantic retrieval against memory_items (kind='entity')
    const hits = await retrieveEntities(db, {
      owner_id: user.id,
      query_text: text,
      k: 8,
      min_salience: 0,
    });

    let related: RelatedEntity[] = [];
    let entityMatches: Array<{ entity: Entity; score: number; matchedTokens: string[]; reason: "name_substring" | "description_overlap" | "fuzzy" }> = [];

    if (hits.length > 0) {
      // Hydrate entity rows (name, description, category, space name).
      const entityIds = hits.map((h) => h.item.ref_id);
      const { data: entityRows } = (await db
        .from("entities")
        .select("id, entity_id, space_id, name, description, entity_category, importance")
        .in("id", entityIds)) as { data: Entity[] | null };

      const entityById = new Map(
        (entityRows ?? []).map((e) => [e.id, e]),
      );
      const spaceIdsNeeded = Array.from(
        new Set((entityRows ?? []).map((e) => e.space_id)),
      );
      const { data: spaces } = (await db
        .from("spaces")
        .select("id, name")
        .in("id", spaceIdsNeeded)) as {
        data: Array<{ id: string; name: string }> | null;
      };
      const spaceNameById = new Map(
        (spaces ?? []).map((s) => [s.id, s.name]),
      );

      // Preserve the retrieval order (hits is already rank-sorted).
      for (const hit of hits) {
        const e = entityById.get(hit.item.ref_id);
        if (!e) continue;
        related.push({
          id: e.id,
          entity_id: e.entity_id,
          name: e.name,
          description: e.description ?? "",
          entity_category: (e.entity_category as string | null) ?? null,
          space_id: e.space_id,
          space_name: spaceNameById.get(e.space_id) ?? "(unknown)",
          score: Math.max(0, Math.min(1, hit.similarity)),
        });
        entityMatches.push({
          entity: e,
          score: hit.similarity,
          matchedTokens: [],
          reason: "fuzzy",
        });
      }
    }

    // 2. Lexical fallback — if memory store hasn't been backfilled yet,
    //    the retriever returns empty. Fall back to the old path so the
    //    first-run UX still surfaces something useful.
    if (related.length === 0) {
      const { data: spacesRaw } = await db
        .from("spaces")
        .select("id, name")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(30);
      const spaces = (spacesRaw ?? []) as Array<{ id: string; name: string }>;
      const spaceNameById = new Map(spaces.map((s) => [s.id, s.name]));
      const spaceIds = spaces.map((s) => s.id);

      if (spaceIds.length > 0) {
        const { data: entitiesRaw } = await db
          .from("entities")
          .select("id, entity_id, space_id, name, description, entity_category, importance")
          .in("space_id", spaceIds);
        const allEntities = (entitiesRaw ?? []) as Entity[];
        const matches = detectEntities(text, allEntities, 8);
        entityMatches = matches;
        related = matches.map((m) => ({
          id: m.entity.id,
          entity_id: m.entity.entity_id,
          name: m.entity.name,
          description: m.entity.description ?? "",
          entity_category: (m.entity.entity_category as string | null) ?? null,
          space_id: m.entity.space_id,
          space_name: spaceNameById.get(m.entity.space_id) ?? "(unknown)",
          score: m.score,
        }));
      }
    }

    // 3. Questions — deterministic heuristic generator, unchanged from pre-Sprint-2.
    let questions: string[] = [];
    if (entityMatches.length > 0) {
      const patternMatchesEmpty: PatternMatchResult[] = [];
      questions = generateOpenQuestions(text, entityMatches, patternMatchesEmpty).map(
        (q) => q.text,
      );
    } else {
      questions = [
        `What mechanism would explain this?`,
        `What evidence would contradict this view?`,
        `Which existing concept does this most conflict with?`,
      ];
    }

    return NextResponse.json({
      relatedEntities: related,
      questions: questions.slice(0, 4),
    });
  } catch (err) {
    console.error("[canvas/ambient]", err);
    return NextResponse.json(
      { error: `Ambient lookup failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
