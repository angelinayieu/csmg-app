// ── Brainstorm cross-space detection ──
//
// POST /api/brainstorm/detect
//   body: { text }
//
// Same lexical matcher as playground, but searches the user's ENTIRE knowledge
// graph (all spaces they own) plus the global pattern library. Returns matches
// GROUPED BY SPACE so the user sees which space each match came from.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  detectEntities,
  detectPatterns,
  detectClaims,
  generateOpenQuestions,
  type PatternMatchInput,
} from "@/lib/whiteboard/playground-detector";
import type { Entity, Claim, Space } from "@/types";

export const maxDuration = 20;

interface EntityMatchWithSpace {
  entity: Entity;
  score: number;
  matchedTokens: string[];
  reason: string;
  // Extra: which space this entity belongs to
  space_id: string;
  space_name: string;
}

interface ClaimMatchWithSpace {
  claim: Claim;
  score: number;
  matchedTokens: string[];
  space_id: string;
  space_name: string;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let text: string;
  try {
    const body = await request.json();
    text = body.text;
    if (typeof text !== "string") {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Trivial-text short circuit
  if (text.trim().length < 3) {
    return NextResponse.json({
      entities: [],
      patterns: [],
      claims: [],
      open_questions: [],
      spaces: [],
      cold: true,
    });
  }

  try {
    // ── Step 1: Fetch user's spaces ──
    const { data: userSpaces } = await db
      .from("spaces")
      .select("id, name, description, entity_count, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(50);

    const spaces = (userSpaces ?? []) as Space[];
    const spaceById = new Map<string, Space>();
    for (const s of spaces) spaceById.set(s.id, s);
    const spaceIds = spaces.map((s) => s.id);

    if (spaceIds.length === 0) {
      return NextResponse.json({
        entities: [],
        patterns: [],
        claims: [],
        open_questions: [],
        spaces: [],
      });
    }

    // ── Step 2: Parallel fetch across all user-owned spaces ──
    const [entitiesRes, patternsRes, claimsRes] = await Promise.all([
      db.from("entities").select("*").in("space_id", spaceIds),
      db.from("pattern_library")
        .select(
          "signature, canonical_tag, canonical_description, canonical_mechanism, typical_polarity, occurrence_count, example_descriptions",
        )
        .gte("occurrence_count", 2)
        .order("occurrence_count", { ascending: false })
        .limit(150),
      db.from("claims").select("*").in("space_id", spaceIds).limit(500),
    ]);

    const allEntities = (entitiesRes.data ?? []) as Entity[];
    const patterns = (patternsRes.data ?? []) as PatternMatchInput[];
    const allClaims = (claimsRes.data ?? []) as Claim[];

    // ── Step 3: Run detection + annotate with space info ──
    const entityMatches = detectEntities(text, allEntities, 15);
    const claimMatches = detectClaims(text, allClaims, 10);
    const patternMatches = detectPatterns(text, patterns, 5);
    const openQuestions = generateOpenQuestions(text, entityMatches, patternMatches);

    const annotatedEntities: EntityMatchWithSpace[] = entityMatches.map((m) => {
      const space = spaceById.get(m.entity.space_id);
      return {
        entity: m.entity,
        score: m.score,
        matchedTokens: m.matchedTokens,
        reason: m.reason,
        space_id: m.entity.space_id,
        space_name: space?.name ?? "(unknown space)",
      };
    });

    const annotatedClaims: ClaimMatchWithSpace[] = claimMatches.map((m) => {
      const space = spaceById.get(m.claim.space_id);
      return {
        claim: m.claim,
        score: m.score,
        matchedTokens: m.matchedTokens,
        space_id: m.claim.space_id,
        space_name: space?.name ?? "(unknown space)",
      };
    });

    // Group entities by space for UI rendering
    const entitiesBySpace = new Map<string, EntityMatchWithSpace[]>();
    for (const m of annotatedEntities) {
      if (!entitiesBySpace.has(m.space_id)) entitiesBySpace.set(m.space_id, []);
      entitiesBySpace.get(m.space_id)!.push(m);
    }

    return NextResponse.json({
      entities: annotatedEntities,
      entities_by_space: Object.fromEntries(entitiesBySpace),
      patterns: patternMatches,
      claims: annotatedClaims,
      open_questions: openQuestions,
      spaces: spaces.map((s) => ({ id: s.id, name: s.name, entity_count: s.entity_count })),
      meta: {
        total_entities_searched: allEntities.length,
        total_spaces_searched: spaceIds.length,
        pattern_library_size: patterns.length,
      },
    });
  } catch (err) {
    console.error("[brainstorm/detect] Error:", err);
    return NextResponse.json(
      { error: `Detection failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
