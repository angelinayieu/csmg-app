// ── POST /api/spaces/[id]/promote-seed ─────────────────────────────
//
// Phase C — materializes a typed clarifier seed-card into a real
// Entity row. Called from the seed-card-shape's "Promote to entity"
// CTA when the user wants to pin a user-asserted slot value to the
// knowledge graph.
//
// Why a dedicated endpoint vs. reusing /api/entities/create:
//   - We bake `manifold.provenance = "user_asserted"` and
//     `manifold.expand_hint = value` so downstream expand calls
//     (Phase D) automatically read this as steering context.
//   - We persist a back-pointer at
//     `synthesis_data.meta.promoted_seeds[shapeId] = entityId` so
//     the canvas can re-render seed cards with their promoted state
//     after reload (no localStorage drift).
//   - Idempotent: the entity_id is deterministic from shapeId so
//     accidental double-clicks return the same entity.
//
// Auth: standard space-ownership check.

import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import { sanitizeEntity } from "@/lib/sanitize";
import { isAnswerSlot, type AnswerSlot } from "@/types/clarifier-answer";

export const maxDuration = 15;
export const runtime = "nodejs";

interface PromoteSeedRequest {
  shapeId: string;
  slot: string;
  kind: string;
  question: string;
  value: string;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Slot → human-readable entity_type label. Surfaces what kind of
// commitment this entity carries in any list view that groups by
// type. Falls back to "concept" if the slot doesn't map.
const SLOT_TO_ENTITY_TYPE: Record<AnswerSlot, string> = {
  exploration_angle: "exploration_angle",
  variation_axis: "variation_axis",
  target_metric: "target_metric",
  system_boundary: "system_boundary",
  state_variable: "state_variable",
  observation_point: "observation_point",
  timeframe: "constraint",
  constraint: "constraint",
};

export async function POST(request: Request, ctx: RouteParams) {
  try {
    const { supabase, user, error: authError } = await safeAuth();
    if (authError) return authError;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    const { id: spaceId } = await ctx.params;
    if (!spaceId) {
      return NextResponse.json({ error: "space id required" }, { status: 400 });
    }

    const { data: body, error: parseError } = await safeJsonParse(request);
    if (parseError) return parseError;

    const { shapeId, slot, question, value } = (body ?? {}) as Partial<PromoteSeedRequest>;
    if (
      typeof shapeId !== "string" ||
      !shapeId.trim() ||
      typeof slot !== "string" ||
      typeof value !== "string" ||
      !value.trim()
    ) {
      return NextResponse.json(
        { error: "shapeId, slot, and value are required" },
        { status: 400 },
      );
    }
    const trimmedValue = value.trim();
    const trimmedQuestion = typeof question === "string" ? question.trim() : "";

    // ── Ownership check ─────────────────────────────────────────────
    const { data: spaceRow } = (await db
      .from("spaces")
      .select("id, user_id, synthesis_data")
      .eq("id", spaceId)
      .maybeSingle()) as {
      data: {
        id: string;
        user_id: string;
        synthesis_data: unknown;
      } | null;
    };
    if (!spaceRow) {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }
    if (spaceRow.user_id !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // ── Idempotent entity_id derived from shapeId ───────────────────
    // The seed-card shape ids are deterministic (`seed-<spaceId>-<idx>`),
    // so a double-promotion request maps to the same entity_id. We
    // upsert on (space_id, entity_id) — the existing unique index on
    // that pair makes the second insert a no-op and we return the
    // existing row.
    const rawShapeId = shapeId.startsWith("shape:") ? shapeId.slice(6) : shapeId;
    const entityId = `seed_${rawShapeId}`.slice(0, 128);

    // Existing row?
    const { data: existing } = (await db
      .from("entities")
      .select("id, entity_id, name")
      .eq("space_id", spaceId)
      .eq("entity_id", entityId)
      .maybeSingle()) as {
      data: { id: string; entity_id: string; name: string } | null;
    };
    if (existing) {
      return NextResponse.json({
        entityId: existing.entity_id,
        rowId: existing.id,
        alreadyPromoted: true,
      });
    }

    const slotVal: AnswerSlot | null = isAnswerSlot(slot) ? slot : null;
    const entityType =
      slotVal !== null ? SLOT_TO_ENTITY_TYPE[slotVal] : "concept";

    // ── Build + sanitize the new entity row ─────────────────────────
    const description = trimmedQuestion
      ? `User-asserted (via clarifier): ${trimmedQuestion}`
      : "User-asserted via clarifier";

    const sanitized = sanitizeEntity(
      {
        entity_id: entityId,
        name: trimmedValue,
        description,
        // ENTITY_SOURCE_TAGS only accepts explicit | implicit | assumed —
        // user-asserted maps cleanly to "explicit". The richer
        // provenance flag lives on the manifold JSONB extension.
        source_tag: "explicit",
        entity_type: entityType,
        importance: "high",
        confidence: 0.9,
        manifold: {
          provenance: "user_asserted",
          source: "clarifier",
          slot: slotVal ?? "constraint",
          expand_hint: trimmedValue,
        },
      },
      spaceId,
    );

    const { data: inserted, error: insertErr } = await db
      .from("entities")
      .insert(sanitized)
      .select("id, entity_id")
      .single();
    if (insertErr) {
      return NextResponse.json(
        {
          error: "Failed to materialize seed",
          detail: sanitizeErrorMessage(insertErr.message),
        },
        { status: 500 },
      );
    }

    // ── Update synthesis_data.meta.promoted_seeds back-pointer ──────
    // Soft-fail: the entity is already inserted, so a meta-update
    // failure shouldn't block the user — the canvas-side flag will
    // still flip via the synthetic event.
    try {
      const existingSynth =
        spaceRow.synthesis_data && typeof spaceRow.synthesis_data === "object"
          ? (spaceRow.synthesis_data as Record<string, unknown>)
          : {};
      const meta =
        existingSynth.meta && typeof existingSynth.meta === "object"
          ? (existingSynth.meta as Record<string, unknown>)
          : {};
      const promoted =
        meta.promoted_seeds && typeof meta.promoted_seeds === "object"
          ? (meta.promoted_seeds as Record<string, string>)
          : {};
      promoted[shapeId] = inserted.entity_id;
      await db
        .from("spaces")
        .update({
          synthesis_data: {
            ...existingSynth,
            meta: { ...meta, promoted_seeds: promoted },
          },
        })
        .eq("id", spaceId);
    } catch {
      /* non-fatal */
    }

    return NextResponse.json({
      entityId: inserted.entity_id,
      rowId: inserted.id,
      alreadyPromoted: false,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "promote-seed failed",
        detail: sanitizeErrorMessage(
          err instanceof Error ? err.message : String(err),
        ),
      },
      { status: 500 },
    );
  }
}
