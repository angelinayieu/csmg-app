// ── Bulk-delete entities (Phase 46 — receipts undo) ──
// POST /api/entities/bulk-delete
//   body: { ids: string[] }
//   → { deleted: string[] }
//
// The write-path for AI Receipts Undo. Deletes every entity in `ids`
// that the caller owns (RLS + explicit ownership filter), plus any
// edges touching them. Cascading FKs handle the rest.
//
// Safety:
//   - Hard cap at 100 ids per call (protects against a runaway loop
//     or crafted payload)
//   - Ownership check: we filter deletes to space_ids the user owns —
//     any id that leaks in without ownership is silently skipped rather
//     than erroring, so the client can submit optimistically
//   - Edge cleanup is explicit even if the schema has ON DELETE CASCADE:
//     cheap insurance against a cascade rule drifting in a future migration

import { NextResponse } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { logKnowledgeEvent } from "@/lib/changelog/log-knowledge-event";

export const maxDuration = 15;
const MAX_IDS = 100;

interface PostBody {
  ids?: string[];
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<PostBody>(request);
  if (parseError) return parseError;

  const rawIds = Array.isArray(body?.ids) ? body!.ids : [];
  const ids = rawIds
    .filter((x): x is string => typeof x === "string")
    .slice(0, MAX_IDS);
  if (ids.length === 0) {
    return NextResponse.json({ deleted: [] });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  try {
    // 1. Load the entities with their space_ids so we can verify ownership.
    //    RLS should already scope to the user's rows, but doing an explicit
    //    ownership check keeps the invariant readable.
    const { data: loaded, error: loadErr } = await db
      .from("entities")
      .select("id, space_id")
      .in("id", ids);
    if (loadErr) {
      console.warn("[entities/bulk-delete load]", loadErr);
      return NextResponse.json({ error: "Load failed" }, { status: 500 });
    }
    const rows = (loaded ?? []) as Array<{ id: string; space_id: string }>;
    if (rows.length === 0) {
      return NextResponse.json({ deleted: [] });
    }

    const spaceIds = Array.from(new Set(rows.map((r) => r.space_id)));
    const { data: ownedSpaces, error: spacesErr } = await db
      .from("spaces")
      .select("id")
      .in("id", spaceIds)
      .eq("user_id", user.id);
    if (spacesErr) {
      console.warn("[entities/bulk-delete spaces]", spacesErr);
      return NextResponse.json({ error: "Ownership check failed" }, { status: 500 });
    }
    const ownedSet = new Set(
      ((ownedSpaces ?? []) as Array<{ id: string }>).map((s) => s.id),
    );

    // 2. Filter to entity ids whose space the caller owns.
    const deletableIds = rows
      .filter((r) => ownedSet.has(r.space_id))
      .map((r) => r.id);
    if (deletableIds.length === 0) {
      return NextResponse.json({ deleted: [] });
    }

    // 3. Explicit edge cleanup. An edge is removed if either endpoint
    //    is being deleted. Two filtered deletes (Postgres doesn't let
    //    us OR across columns in a single supabase-js call cleanly).
    await db.from("edges").delete().in("source_entity_id", deletableIds);
    await db.from("edges").delete().in("target_entity_id", deletableIds);

    // 4. Delete the entities themselves. FK cascades handle the rest.
    const { error: delErr } = await db
      .from("entities")
      .delete()
      .in("id", deletableIds);
    if (delErr) {
      console.warn("[entities/bulk-delete entities]", delErr);
      return NextResponse.json({ error: "Delete failed" }, { status: 500 });
    }

    // Phase 52 — log to unified event stream. Group the deleted ids by
    // their space so the audit trail per space is complete (one cluster
    // delete may span multiple spaces if a receipt mixed them).
    const idsBySpace = new Map<string, string[]>();
    for (const r of rows) {
      if (!ownedSet.has(r.space_id)) continue;
      const arr = idsBySpace.get(r.space_id) ?? [];
      arr.push(r.id);
      idsBySpace.set(r.space_id, arr);
    }
    for (const [sid, ids] of idsBySpace) {
      await logKnowledgeEvent(supabase, {
        spaceId: sid,
        subtype: "entities_undone",
        summary: `Undid ${ids.length} entit${ids.length === 1 ? "y" : "ies"} via AI receipts`,
        details: {
          entity_ids: ids,
          source: "ai_receipts_undo",
        },
      });
    }

    return NextResponse.json({ deleted: deletableIds });
  } catch (err) {
    return NextResponse.json(
      { error: `Bulk delete failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
