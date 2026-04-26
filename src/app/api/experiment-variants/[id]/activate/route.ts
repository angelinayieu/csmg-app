// POST /api/experiment-variants/:id/activate
//
// Sprint B.5 — flips `is_active = true` on the given variant and
// clears it on any other variants sharing the same
// (space_id, situation_key). Used by canvas-side widget dispatches
// (VariantCarousel double-click) that want to mutate without the
// user leaving the whiteboard to open the app detail page.
//
// Mirrors the champion-pick logic in `src/lib/agents/iv-scorer.ts:411`
// so the partial-unique index on (space_id, situation_key,
// is_active=true) stays valid: we set losers to false FIRST, then
// flip the winner to true. A previously-active champion for the
// same situation is cleanly demoted.
//
// Ownership is enforced by joining to `spaces.user_id`. No cross-
// user activations possible — protects against a leaked variantId
// being weaponized to toggle another user's champion.
//
// Soft-fail: the DB write can race with a concurrent iv-scorer
// champion pick; we swallow partial failures and return a 500 so the
// widget shows an error state rather than false-claiming success.
//
// Response: { ok: true, variantId, situationKey } OR
//           { ok: false, error: string }

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

interface VariantOwnershipRow {
  id: string;
  space_id: string;
  situation_key: string | null;
  is_active: boolean;
  spaces: { user_id: string } | null;
}

interface SiblingRow {
  id: string;
  is_active: boolean;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Resolve ownership + situation_key in one join. If the variant
  // doesn't exist, or if the space's owner doesn't match the caller,
  // 404 (indistinguishable from not-found — don't leak existence).
  const { data: variantRow } = (await db
    .from("experiment_variants")
    .select("id, space_id, situation_key, is_active, spaces!inner(user_id)")
    .eq("id", id)
    .maybeSingle()) as { data: VariantOwnershipRow | null };

  if (!variantRow) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }
  if (variantRow.spaces?.user_id !== user.id) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }

  const { space_id: spaceId, situation_key: situationKey } = variantRow;

  try {
    // Demote every sibling in the same situation FIRST. Without this,
    // the partial unique index on (space_id, situation_key, is_active)
    // would reject the activation below (two active champions per
    // situation isn't allowed).
    //
    // situation_key may be null for space-level variants; in that case
    // we scope demotion to other space-level variants in the same
    // space (null == null in PostgREST's is-NULL semantics).
    let siblingsQuery = db
      .from("experiment_variants")
      .select("id, is_active")
      .eq("space_id", spaceId)
      .neq("id", id);
    siblingsQuery =
      situationKey == null
        ? siblingsQuery.is("situation_key", null)
        : siblingsQuery.eq("situation_key", situationKey);
    const { data: siblingRows } = (await siblingsQuery) as {
      data: SiblingRow[] | null;
    };

    const activeSiblings = (siblingRows ?? []).filter((s) => s.is_active);
    for (const s of activeSiblings) {
      await db
        .from("experiment_variants")
        .update({ is_active: false })
        .eq("id", s.id);
    }

    // Now safe to flip the target variant active. Skip the write when
    // it's already active (no-op minimizes updated_at churn).
    if (!variantRow.is_active) {
      const { error: updateError } = await db
        .from("experiment_variants")
        .update({ is_active: true })
        .eq("id", id);
      if (updateError) {
        return NextResponse.json(
          { ok: false, error: updateError.message ?? "Activation failed" },
          { status: 500 },
        );
      }
    }

    // Changelog row so the audit drawer reflects the user-initiated
    // activation. Soft-fail — failure here shouldn't reject the call.
    try {
      await db.from("space_changelog").insert({
        space_id: spaceId,
        change_type: "variant_activated",
        summary: `Variant activated from canvas.`,
        details: {
          variant_id: id,
          situation_key: situationKey,
          triggered_by: "canvas:variant-carousel",
        },
      });
    } catch {
      /* ignore */
    }

    return NextResponse.json({
      ok: true,
      variantId: id,
      situationKey,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Unexpected failure",
      },
      { status: 500 },
    );
  }
}
