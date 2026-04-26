// ── Canvas ambient AI ──
//
// POST /api/canvas/ambient
//   body: { spaceId, text, context? }
//   → { relatedEntities: [...], questions: string[] }
//
// context: "whiteboard" (default) | "journal"
//   Controls question style: whiteboard → analytical/structural probes;
//   journal → reflective/emotional probes that surface patterns across
//   past entries and values.
//
// Questions are now LLM-generated (gpt-4o-mini, ~300ms p50) using the
// sticky/entry text + top related entities as context. Falls back to
// generic heuristics on timeout or error so the rail always shows
// something useful.

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import {
  detectEntities,
} from "@/lib/whiteboard/playground-detector";
import { retrieveEntities } from "@/lib/memory/retrieve";
import { llmJSON } from "@/lib/llm";
import { MODEL_DEFAULTS } from "@/lib/llm";
import type { Entity } from "@/types";

export const maxDuration = 15;

interface AmbientRequest {
  spaceId: string;
  text: string;
  /** "whiteboard" (default): analytical probes about structure/causation.
   *  "journal": reflective probes about patterns, emotions, values. */
  context?: "whiteboard" | "journal";
}

// ── LLM probe question generation ────────────────────────────────────
//
// Uses gpt-4o-mini for speed (target < 400ms). The prompt is intentionally
// tight: 3 questions, no preamble, JSON array only. Context flavour
// switches the question register between analytical and reflective.

const PROBE_SYSTEM_WHITEBOARD = `You are an analytical thinking partner helping someone reason through complex systems.
Given a short piece of text and optionally some related concepts from their knowledge graph, generate exactly 3 short, sharp probe questions that would deepen their thinking.

Rules:
- Questions must be SPECIFIC to the given text — never generic
- Each question < 15 words
- Vary the angle: one structural ("what causes this?"), one relational ("how does this connect to X?"), one challenge ("what would break this assumption?")
- If related concepts are provided, at least one question should reference them by name
- Output ONLY a JSON array of 3 strings, no other text`;

const PROBE_SYSTEM_JOURNAL = `You are a thoughtful journaling companion helping someone understand themselves better.
Given a journal entry excerpt and optionally some recurring themes from their past writing, generate exactly 3 reflective probe questions.

Rules:
- Questions must be SPECIFIC to what they wrote — never generic
- Each question < 18 words
- Vary the angle: one about underlying feeling ("what's beneath the surface here?"), one pattern-based ("is this connected to [theme]?"), one forward-looking ("what would feel different if this changed?")
- If recurring themes are provided, reference them by name where relevant
- Output ONLY a JSON array of 3 strings, no other text`;

const FALLBACK_QUESTIONS_WHITEBOARD = [
  "What mechanism drives this pattern?",
  "Which assumption here is most fragile?",
  "What would have to be true for this to fail?",
];

const FALLBACK_QUESTIONS_JOURNAL = [
  "What feeling is underneath what you described?",
  "Is this familiar — have you felt this before?",
  "What would change if this tension resolved?",
];

async function generateProbeQuestions(
  text: string,
  relatedNames: string[],
  context: "whiteboard" | "journal",
): Promise<string[]> {
  const systemPrompt =
    context === "journal" ? PROBE_SYSTEM_JOURNAL : PROBE_SYSTEM_WHITEBOARD;
  const fallback =
    context === "journal"
      ? FALLBACK_QUESTIONS_JOURNAL
      : FALLBACK_QUESTIONS_WHITEBOARD;

  const relatedBlock =
    relatedNames.length > 0
      ? `\n\nRelated concepts from their knowledge graph: ${relatedNames.slice(0, 3).join(", ")}`
      : "";

  const userPrompt = `Text: "${text.slice(0, 600)}"${relatedBlock}`;

  try {
    const result = await Promise.race([
      llmJSON<string[]>({
        system: systemPrompt,
        user: userPrompt,
        maxTokens: 256,
        temperature: 0.7,
        model: MODEL_DEFAULTS.openai.fast, // gpt-4o-mini for speed
      }),
      // Hard timeout so we never block the rail more than 5s
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("probe timeout")), 5000),
      ),
    ]);
    if (Array.isArray(result) && result.length > 0) {
      return (result as string[]).slice(0, 4);
    }
    return fallback;
  } catch {
    return fallback;
  }
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

  const { spaceId, text, context = "whiteboard" } = body;
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
      }
    }

    // 2. Lexical fallback when memory store not yet backfilled.
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

    // 3. LLM probe questions — run in parallel with entity retrieval
    //    (entity retrieval is awaited above, questions race independently).
    //    Context switches question style: whiteboard → analytical,
    //    journal → reflective/emotional.
    const relatedNames = related.slice(0, 3).map((r) => r.name);
    const questions = await generateProbeQuestions(text, relatedNames, context);

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
