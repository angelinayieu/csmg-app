// ── Canvas semantic bridges ──
//
// POST /api/canvas/bridges
//   body: { spaceId, entityId }
//   → { bridges: Array<{
//         target_entity_id: string,
//         target_uuid: string,
//         target_name: string,
//         target_space_id: string,
//         target_space_name: string,
//         target_layer: string | null,
//         similarity: number,          // 0..1
//         match_reason: string
//       }> }
//
// Finds cross-space/cross-cluster entities whose shape resembles the
// focal entity *at the same layer* — so indicator-level concepts in
// different probability spaces can bridge each other.
//
// Scoring is pure lexical + category + layer for Phase 9c. An embedding
// variant can slot in behind the same interface later.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage, verifySpaceOwnership } from "@/lib/api-helpers";
import type { Entity } from "@/types";

export const maxDuration = 10;

interface BridgesRequest {
  spaceId: string;
  entityId: string;
}

interface BridgeMatch {
  target_entity_id: string;
  target_uuid: string;
  target_name: string;
  target_space_id: string;
  target_space_name: string;
  target_layer: string | null;
  similarity: number;
  match_reason: string;
}

function tokenize(text: string): Set<string> {
  const stop = new Set([
    "the", "a", "an", "of", "in", "for", "and", "or", "to", "is", "are", "on", "at",
    "by", "from", "with", "be", "it", "that", "as", "this", "these", "those",
  ]);
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !stop.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let i = 0;
  for (const t of a) if (b.has(t)) i++;
  return i / (a.size + b.size - i);
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<BridgesRequest>(request);
  if (parseError) return parseError;

  const { spaceId, entityId } = body;
  if (typeof spaceId !== "string" || typeof entityId !== "string") {
    return NextResponse.json({ error: "spaceId + entityId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  try {
    const { data: focal } = await db
      .from("entities")
      .select("*")
      .eq("id", entityId)
      .eq("space_id", spaceId)
      .single();
    if (!focal) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    // Pull all owned-space entities EXCEPT the focal's own space — we
    // want cross-cluster matches, not within-space neighbours (those
    // are already rendered as regular edges).
    const { data: spacesRaw } = await db
      .from("spaces")
      .select("id, name")
      .eq("user_id", user.id)
      .neq("id", spaceId)
      .limit(40);
    const spaces = (spacesRaw ?? []) as Array<{ id: string; name: string }>;
    const spaceNameById = new Map(spaces.map((s) => [s.id, s.name]));
    const otherSpaceIds = spaces.map((s) => s.id);
    if (otherSpaceIds.length === 0) {
      return NextResponse.json({ bridges: [] });
    }

    const { data: candidatesRaw } = await db
      .from("entities")
      .select("id, entity_id, space_id, name, description, entity_category, layer, depth")
      .in("space_id", otherSpaceIds)
      .limit(2000);
    const candidates = (candidatesRaw ?? []) as Entity[];
    if (candidates.length === 0) {
      return NextResponse.json({ bridges: [] });
    }

    const focalTokens = tokenize(`${focal.name} ${focal.description ?? ""}`);
    const focalLayer = (focal.layer ?? "").toLowerCase().trim();
    const focalDepth = typeof focal.depth === "number" ? focal.depth : -1;
    const focalCategory = (focal.entity_category ?? "").toLowerCase().trim();

    const scored: BridgeMatch[] = [];
    for (const c of candidates) {
      const cTokens = tokenize(`${c.name} ${c.description ?? ""}`);
      let score = jaccard(focalTokens, cTokens);
      if (score < 0.1) continue; // cheap prune

      const reasons: string[] = [];
      const cLayer = (c.layer ?? "").toLowerCase().trim();
      const cDepth = typeof c.depth === "number" ? c.depth : -1;
      const cCategory = ((c.entity_category as string) ?? "").toLowerCase().trim();
      // Phase 10: prefer canonical integer depth. Fall back to layer-string
      // match for pre-migration rows.
      if (focalDepth >= 0 && cDepth >= 0 && focalDepth === cDepth) {
        score += 0.2;
        reasons.push(`same depth (${focalDepth})`);
      } else if (focalLayer && cLayer && focalLayer === cLayer) {
        score += 0.18;
        reasons.push(`same layer (${focalLayer})`);
      }
      if (focalCategory && cCategory && focalCategory === cCategory) {
        score += 0.12;
        reasons.push(`same category (${focalCategory})`);
      }
      // Name-normalized exact match bonus
      const focalNorm = focal.name.toLowerCase().trim();
      const cNorm = c.name.toLowerCase().trim();
      if (focalNorm === cNorm) {
        score += 0.4;
        reasons.push("identical name");
      } else if (focalNorm.includes(cNorm) || cNorm.includes(focalNorm)) {
        score += 0.15;
        reasons.push("name overlap");
      }

      score = Math.min(1, score);
      if (score < 0.18) continue;

      scored.push({
        target_entity_id: c.entity_id,
        target_uuid: c.id,
        target_name: c.name,
        target_space_id: c.space_id,
        target_space_name: spaceNameById.get(c.space_id) ?? "(unknown)",
        target_layer: c.layer ?? null,
        similarity: score,
        match_reason: reasons.length > 0 ? reasons.join(" + ") : "token overlap",
      });
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return NextResponse.json({ bridges: scored.slice(0, 5) });
  } catch (err) {
    console.warn("[canvas/bridges]", err);
    return NextResponse.json(
      { error: `Bridge detection failed: ${sanitizeErrorMessage(err)}`, bridges: [] },
      { status: 500 },
    );
  }
}
