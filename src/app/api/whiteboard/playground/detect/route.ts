// ── Playground detection endpoint ──
//
// POST /api/whiteboard/playground/detect
//   body: { space_id, text }
//
// Returns:
//   {
//     entities: EntityMatchResult[],
//     patterns: PatternMatchResult[],
//     claims: ClaimMatchResult[],
//     open_questions: OpenQuestion[]
//   }
//
// Phase D MVP uses lexical matching (see playground-detector.ts). If the
// text is empty or under 3 chars, returns empty arrays fast to minimize
// backend load from keystroke chatter.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  detectEntities,
  detectPatterns,
  detectClaims,
  generateOpenQuestions,
  type PatternMatchInput,
} from "@/lib/whiteboard/playground-detector";
import type { Entity, Claim } from "@/types";

export const maxDuration = 15;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let spaceId: string;
  let text: string;
  try {
    const body = await request.json();
    spaceId = body.space_id;
    text = body.text;
    if (typeof spaceId !== "string" || typeof text !== "string") {
      return NextResponse.json({ error: "space_id and text required" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Trivial-text short-circuit — no point hitting the DB
  if (text.trim().length < 3) {
    return NextResponse.json({
      entities: [],
      patterns: [],
      claims: [],
      open_questions: [],
      cold: true,
    });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    // Parallel fetch: entities for this space + global pattern library + claims for this space
    const [entitiesRes, patternsRes, claimsRes] = await Promise.all([
      db.from("entities").select("*").eq("space_id", spaceId),
      db.from("pattern_library").select(
        "signature, canonical_tag, canonical_description, canonical_mechanism, typical_polarity, occurrence_count, example_descriptions"
      ).gte("occurrence_count", 2).order("occurrence_count", { ascending: false }).limit(120),
      db.from("claims").select("*").eq("space_id", spaceId).limit(200),
    ]);

    const entities = (entitiesRes.data ?? []) as Entity[];
    const patterns = (patternsRes.data ?? []) as PatternMatchInput[];
    const claims = (claimsRes.data ?? []) as Claim[];

    const entityMatches = detectEntities(text, entities, 8);
    const patternMatches = detectPatterns(text, patterns, 5);
    const claimMatches = detectClaims(text, claims, 5);
    const openQuestions = generateOpenQuestions(text, entityMatches, patternMatches);

    return NextResponse.json({
      entities: entityMatches,
      patterns: patternMatches,
      claims: claimMatches,
      open_questions: openQuestions,
      meta: {
        graph_entity_count: entities.length,
        pattern_library_size: patterns.length,
        claim_count: claims.length,
        query_length: text.length,
      },
    });
  } catch (err) {
    console.error("[playground/detect] Error:", err);
    return NextResponse.json(
      { error: `Detection failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
