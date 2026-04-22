// ── Canvas reactions (Phase 11) ──
//
// GET  /api/canvas/reactions?spaceId=...&entityIds=id1,id2,...
//   → { reaction: Reaction | null }
//   Canonical-key lookup — returns the saved reaction for this exact set
//   of entities, or null. Used by the combination card to short-circuit
//   re-running the LLM on a combination the user already saved.
//
// GET  /api/canvas/reactions?spaceId=...&touchingEntityId=...
//   → { reactions: Reaction[] }
//   Lists every reaction that touches the given entity. Used by the Node
//   Lab (Phase 12) to populate a reaction history per card.
//
// POST /api/canvas/reactions
//   body: { spaceId, name, reaction_type, entity_ids, probability,
//           ci_low?, ci_high?, mechanism?, implication?, probes?,
//           source_tag?, provenance? }
//   → { reaction: Reaction }
//   Upserts by (space_id, canonical_key) so re-saving the same combo
//   updates the existing row rather than duplicating.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage, verifySpaceOwnership } from "@/lib/api-helpers";
import { canonicalKey, type Reaction, type ReactionType, type ReactionSourceTag } from "@/types/reactions";
import { logKnowledgeEvent } from "@/lib/changelog/log-knowledge-event";

export const maxDuration = 15;

const VALID_TYPES: readonly ReactionType[] = [
  "emergent",
  "reinforcing",
  "tension",
  "trivial",
] as const;
const VALID_SOURCE_TAGS: readonly ReactionSourceTag[] = [
  "user",
  "llm",
  "inferred",
] as const;

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("spaceId");
  const entityIdsParam = url.searchParams.get("entityIds");
  const touchingEntityId = url.searchParams.get("touchingEntityId");

  if (!spaceId) {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  try {
    // Variant 1: exact-combination lookup by canonical_key
    if (entityIdsParam) {
      const ids = entityIdsParam
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (ids.length < 2 || ids.length > 6) {
        return NextResponse.json({ reaction: null });
      }
      const key = canonicalKey(ids);
      const { data, error } = await db
        .from("reactions")
        .select("*")
        .eq("space_id", spaceId)
        .eq("canonical_key", key)
        .maybeSingle();
      if (error) {
        console.warn("[canvas/reactions GET exact]", error);
        return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
      }
      return NextResponse.json({ reaction: (data ?? null) as Reaction | null });
    }

    // Variant 2: list all reactions touching a given entity
    if (touchingEntityId) {
      const { data, error } = await db
        .from("reactions")
        .select("*")
        .eq("space_id", spaceId)
        .contains("entity_ids", [touchingEntityId])
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) {
        console.warn("[canvas/reactions GET touching]", error);
        return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
      }
      return NextResponse.json({ reactions: (data ?? []) as Reaction[] });
    }

    // Variant 3: list all reactions in the space (for reaction history)
    const { data, error } = await db
      .from("reactions")
      .select("*")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(80);
    if (error) {
      console.warn("[canvas/reactions GET space]", error);
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }
    return NextResponse.json({ reactions: (data ?? []) as Reaction[] });
  } catch (err) {
    return NextResponse.json(
      { error: `Lookup failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

interface PostBody {
  spaceId: string;
  name: string;
  reaction_type: ReactionType;
  entity_ids: string[];
  probability: number;
  ci_low?: number | null;
  ci_high?: number | null;
  mechanism?: string | null;
  implication?: string | null;
  probes?: string[] | null;
  source_tag?: ReactionSourceTag;
  provenance?: Record<string, unknown> | null;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<PostBody>(request);
  if (parseError) return parseError;

  const {
    spaceId,
    name,
    reaction_type,
    entity_ids,
    probability,
    ci_low,
    ci_high,
    mechanism,
    implication,
    probes,
    source_tag,
    provenance,
  } = body;

  if (!spaceId || typeof spaceId !== "string") {
    return NextResponse.json({ error: "spaceId required" }, { status: 400 });
  }
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (!VALID_TYPES.includes(reaction_type)) {
    return NextResponse.json(
      { error: `reaction_type must be one of ${VALID_TYPES.join(", ")}` },
      { status: 400 },
    );
  }
  if (!Array.isArray(entity_ids) || entity_ids.length < 2 || entity_ids.length > 6) {
    return NextResponse.json({ error: "entity_ids must have 2-6 ids" }, { status: 400 });
  }
  if (typeof probability !== "number" || probability < 0 || probability > 1) {
    return NextResponse.json({ error: "probability must be 0..1" }, { status: 400 });
  }
  const sourceTag: ReactionSourceTag = VALID_SOURCE_TAGS.includes(
    source_tag as ReactionSourceTag,
  )
    ? (source_tag as ReactionSourceTag)
    : "llm";

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  try {
    const key = canonicalKey(entity_ids);
    // Upsert by (space_id, canonical_key). If the row exists, update the
    // interpretation fields but preserve id + created_at.
    const { data: existing } = await db
      .from("reactions")
      .select("id")
      .eq("space_id", spaceId)
      .eq("canonical_key", key)
      .maybeSingle();

    const payload = {
      space_id: spaceId,
      name: name.trim(),
      reaction_type,
      entity_ids,
      canonical_key: key,
      probability,
      ci_low: typeof ci_low === "number" ? ci_low : null,
      ci_high: typeof ci_high === "number" ? ci_high : null,
      mechanism: mechanism ?? null,
      implication: implication ?? null,
      probes: probes ?? null,
      source_tag: sourceTag,
      provenance: provenance ?? null,
      created_by: user.id,
    };

    if (existing?.id) {
      const { data, error } = await db
        .from("reactions")
        .update(payload)
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) {
        console.warn("[canvas/reactions POST update]", error);
        return NextResponse.json({ error: "Save failed" }, { status: 500 });
      }
      // Phase 52 — log to unified event stream (update path).
      await logKnowledgeEvent(supabase, {
        spaceId,
        subtype: "reaction_saved",
        summary: `Updated reaction "${name.trim()}" (${reaction_type}, p=${probability.toFixed(2)})`,
        details: {
          reaction_id: (data as Reaction).id,
          reaction_type,
          probability,
          entity_ids,
          mode: "update",
        },
      });
      return NextResponse.json({ reaction: data as Reaction });
    }

    const { data, error } = await db
      .from("reactions")
      .insert(payload)
      .select("*")
      .single();
    if (error) {
      console.warn("[canvas/reactions POST insert]", error);
      return NextResponse.json({ error: "Save failed" }, { status: 500 });
    }
    // Phase 52 — log to unified event stream (insert path).
    await logKnowledgeEvent(supabase, {
      spaceId,
      subtype: "reaction_saved",
      summary: `Saved reaction "${name.trim()}" (${reaction_type}, p=${probability.toFixed(2)})`,
      details: {
        reaction_id: (data as Reaction).id,
        reaction_type,
        probability,
        entity_ids,
        mode: "insert",
      },
    });
    return NextResponse.json({ reaction: data as Reaction });
  } catch (err) {
    return NextResponse.json(
      { error: `Save failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
