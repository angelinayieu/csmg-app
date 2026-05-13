// ── PATCH + DELETE /api/synergy/components/[id] ──
//
// Owner-only edits on a brainstorm_components row. Phase 4d+ adds
// visibility control so users can retroactively make a component
// private (removes it from the matching pool) or expand it to
// public (Phase 5+ enables global feed).
//
// Whitelisted fields:
//   - visibility: 'private' | 'matchable_only' | 'public'
//   - label_public: 1-200 chars
//   - description_public: 1-800 chars
//   - description_private: 1-2000 chars (owner-only context)
//
// When visibility flips to 'private', we delete any pending match
// suggestions involving this component so they disappear from BOTH
// users' discover feeds. Accepted matches (already-formed rooms)
// survive — they predate the privacy change.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";

interface Body {
  visibility?: unknown;
  label_public?: unknown;
  description_public?: unknown;
  description_private?: unknown;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

const VALID_VISIBILITY = ["private", "matchable_only", "public"] as const;

export async function PATCH(request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { data: body, error: parseError } = await safeJsonParse<Body>(request);
  if (parseError) return parseError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check + read current visibility (need before-state for the
  // cascade cleanup decision below).
  const { data: existing, error: loadErr } = await db
    .from("brainstorm_components")
    .select("id, owner_id, visibility")
    .eq("id", id)
    .single();
  if (loadErr || !existing) {
    return NextResponse.json({ error: "Component not found" }, { status: 404 });
  }
  if (existing.owner_id !== user.id) {
    return NextResponse.json({ error: "Not your component" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: Record<string, any> = {};
  if (typeof body.visibility === "string") {
    if (!(VALID_VISIBILITY as readonly string[]).includes(body.visibility)) {
      return NextResponse.json(
        {
          error: `visibility must be one of: ${VALID_VISIBILITY.join(", ")}`,
        },
        { status: 400 },
      );
    }
    update.visibility = body.visibility;
  }
  if (typeof body.label_public === "string") {
    update.label_public = body.label_public.trim().slice(0, 200);
    if (update.label_public.length === 0) {
      return NextResponse.json(
        { error: "label_public cannot be empty" },
        { status: 400 },
      );
    }
  }
  if (typeof body.description_public === "string") {
    update.description_public = body.description_public.trim().slice(0, 800);
    if (update.description_public.length === 0) {
      return NextResponse.json(
        { error: "description_public cannot be empty" },
        { status: 400 },
      );
    }
  }
  if (typeof body.description_private === "string") {
    update.description_private = body.description_private.trim().slice(0, 2000);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data: updated, error: updateErr } = await db
    .from("brainstorm_components")
    .update(update)
    .eq("id", id)
    .select(
      "id, kind, subkind, label_public, description_public, description_private, visibility, created_at",
    )
    .single();
  if (updateErr || !updated) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(updateErr) },
      { status: 500 },
    );
  }

  // ── Cascade: when going to 'private', remove suggested matches ──
  //
  // Accepted match requests + their synergy_rooms survive — those
  // relationships were already formed before the privacy change.
  // Cosine-similarity match suggestions in component_matches DO get
  // wiped so the component stops appearing in discover feeds.
  if (
    update.visibility === "private" &&
    existing.visibility !== "private"
  ) {
    const { error: cascadeErr } = await db
      .from("component_matches")
      .delete()
      .or(`component_a.eq.${id},component_b.eq.${id}`);
    if (cascadeErr) {
      // Soft-fail: visibility change still succeeded; log for follow-up
      console.warn(
        "[/api/synergy/components/[id] PATCH] cascade delete failed:",
        cascadeErr,
      );
    }
  }

  return NextResponse.json({ component: updated });
}

// ── DELETE /api/synergy/components/[id] ──
//
// Owner-only hard delete. Cascades via FK to component_matches +
// match_requests + synergy_rooms (the latter two via ON DELETE
// CASCADE on their component_a/component_b columns in their
// migrations).

export async function DELETE(_request: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Ownership check first
  const { data: existing } = await db
    .from("brainstorm_components")
    .select("id, owner_id")
    .eq("id", id)
    .single();
  if (!existing) {
    return NextResponse.json({ error: "Component not found" }, { status: 404 });
  }
  if (existing.owner_id !== user.id) {
    return NextResponse.json({ error: "Not your component" }, { status: 403 });
  }

  const { error } = await db
    .from("brainstorm_components")
    .delete()
    .eq("id", id);
  if (error) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(error) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
