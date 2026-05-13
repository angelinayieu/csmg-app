// GET /api/canonical-concepts/[code]
//
// Sprint W6.4 — Tier 1 read endpoint. Returns one canonical concept
// + the cross-space evidence pool aggregated to safe, identity-free
// counts + the requesting user's own-space matches (full pointers,
// because the user owns those spaces).
//
// Privacy contract:
//   • Aggregate counts across the full registry: ALWAYS visible
//   • Identifiable space pointers (space_id, name, entity count):
//     ONLY when spaces.user_id = auth.uid()
//   • No other user's space names, no per-user-attributed evidence
//
// Response shape:
//   {
//     concept: { id, canonical_code, display_name, description,
//                domain_tags, aliases, status,
//                space_count, entity_count, last_seen_at,
//                first_observed_space_id, created_at, updated_at },
//     evidence: {
//       total_entity_count: number,         -- live SELECT COUNT
//       distinct_space_count: number,       -- live SELECT COUNT(DISTINCT)
//     },
//     in_your_spaces: Array<{ space_id, space_name, entity_count }>
//   }
//
// 404 when no row matches `code`. 200 with an empty `in_your_spaces`
// when the concept exists but the user has no entities linking to it.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const decoded = decodeURIComponent(code).trim();
  if (!decoded) {
    return NextResponse.json(
      { error: "canonical_code is required" },
      { status: 400 },
    );
  }

  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── 1. Concept row ─────────────────────────────────────────────────
  const { data: concept, error: conceptErr } = await db
    .from("canonical_concepts")
    .select("*")
    .eq("canonical_code", decoded)
    .maybeSingle();

  if (conceptErr) {
    return NextResponse.json(
      {
        error: "Failed to load canonical concept",
        detail: conceptErr.message ?? "(unknown)",
      },
      { status: 500 },
    );
  }
  if (!concept) {
    return NextResponse.json(
      { error: `No canonical concept with code "${decoded}"` },
      { status: 404 },
    );
  }

  // ── 2. Live aggregate counts (corrects denorm drift) ──────────────
  // The denormalized `space_count` / `entity_count` columns are
  // bumped optimistically by the matcher and may overcount. The
  // authoritative numbers come from live joins against entities.
  let liveEntityCount = (concept as { entity_count: number }).entity_count;
  let liveSpaceCount = (concept as { space_count: number }).space_count;
  try {
    const { count: entityCount } = await db
      .from("entities")
      .select("id", { count: "exact", head: true })
      .eq("canonical_concept_id", (concept as { id: string }).id);
    if (typeof entityCount === "number") liveEntityCount = entityCount;

    // Postgres has no DISTINCT-count over Supabase JS client; pull
    // space_ids + dedupe in app. Capped at 1000 to keep the response
    // bounded; for concepts at scale, switch to a SQL RPC.
    const { data: spaceIdRows } = await db
      .from("entities")
      .select("space_id")
      .eq("canonical_concept_id", (concept as { id: string }).id)
      .limit(1000);
    if (Array.isArray(spaceIdRows)) {
      const distinct = new Set<string>();
      for (const r of spaceIdRows as Array<{ space_id: string }>) {
        if (r.space_id) distinct.add(r.space_id);
      }
      liveSpaceCount = distinct.size;
    }
  } catch (countErr) {
    // Non-fatal: fall back to denorm counts.
    console.warn(
      "[canonical-concepts/[code]] live-count failed (using denorm):",
      countErr instanceof Error ? countErr.message : countErr,
    );
  }

  // ── 3. The requesting user's own-space matches ────────────────────
  // Privacy: only spaces owned by THIS user surface with names + IDs.
  // Aggregated counts above already cover the cross-user case.
  const inYourSpaces: Array<{
    space_id: string;
    space_name: string;
    entity_count: number;
  }> = [];

  try {
    // Pull all entities of this concept that live in user-owned spaces.
    // Two-step query: first owned space IDs, then entities scoped.
    const { data: ownedSpaceRows } = await db
      .from("spaces")
      .select("id, name")
      .eq("user_id", user.id);
    const ownedSpaceIds = new Set(
      ((ownedSpaceRows ?? []) as Array<{ id: string; name: string | null }>)
        .map((s) => s.id),
    );
    const nameById = new Map<string, string>();
    for (const s of (ownedSpaceRows ?? []) as Array<{
      id: string;
      name: string | null;
    }>) {
      nameById.set(s.id, s.name ?? "(unnamed space)");
    }

    if (ownedSpaceIds.size > 0) {
      const { data: scopedEntityRows } = await db
        .from("entities")
        .select("space_id")
        .eq("canonical_concept_id", (concept as { id: string }).id)
        .in("space_id", Array.from(ownedSpaceIds));

      const perSpace = new Map<string, number>();
      for (const r of (scopedEntityRows ?? []) as Array<{ space_id: string }>) {
        if (!r.space_id) continue;
        perSpace.set(r.space_id, (perSpace.get(r.space_id) ?? 0) + 1);
      }
      for (const [spaceId, count] of perSpace.entries()) {
        inYourSpaces.push({
          space_id: spaceId,
          space_name: nameById.get(spaceId) ?? "(unnamed space)",
          entity_count: count,
        });
      }
      inYourSpaces.sort((a, b) => b.entity_count - a.entity_count);
    }
  } catch (ownErr) {
    console.warn(
      "[canonical-concepts/[code]] in_your_spaces query failed:",
      ownErr instanceof Error ? ownErr.message : ownErr,
    );
  }

  return NextResponse.json({
    concept,
    evidence: {
      total_entity_count: liveEntityCount,
      distinct_space_count: liveSpaceCount,
    },
    in_your_spaces: inYourSpaces,
  });
}
