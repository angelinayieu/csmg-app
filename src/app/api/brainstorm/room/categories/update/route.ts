// ── POST /api/brainstorm/room/categories/update ───────────────────
//
// Lets the user rename / replace one or more sub-categories on a
// sub-objective without re-tagging existing entities. The slug
// stays stable (it's the key entities reference via
// causal_chain.sub_category); only the human-facing label and
// color can change.
//
// Body shape:
//   {
//     spaceId, subObjectiveId,
//     categories: {
//       friction:  [{ slug, label, color }, ...],
//       mechanism: [...],
//       result:    [...]
//     }
//   }
//
// Validation:
//   - All slugs must already exist on the sub-objective's stored
//     categories (no adds, no deletes — those would break the
//     enum tagging on existing entities). We REJECT changes to
//     the slug set so the data stays consistent.
//   - Labels are trimmed + capped at 32 chars.
//   - Colors are kept as-is (hex strings).

import { NextRequest, NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  normalizeRoomCategories,
  type RoomCategorySet,
  type RoomCategories,
} from "@/lib/objective-canvas/generate-categories";

export const runtime = "nodejs";

interface Body {
  spaceId?: string;
  subObjectiveId?: string;
  categories?: {
    friction?: Array<{ slug?: unknown; label?: unknown; color?: unknown }>;
    mechanism?: Array<{ slug?: unknown; label?: unknown; color?: unknown }>;
    result?: Array<{ slug?: unknown; label?: unknown; color?: unknown }>;
  };
}

function mergeLaneEdits(
  existing: RoomCategorySet[],
  edits: Array<{ slug?: unknown; label?: unknown; color?: unknown }> | undefined,
): RoomCategorySet[] {
  if (!Array.isArray(edits)) return existing;
  return existing.map((row) => {
    const edit = edits.find(
      (e) => typeof e?.slug === "string" && e.slug === row.slug,
    );
    if (!edit) return row;
    const nextLabel =
      typeof edit.label === "string" && edit.label.trim().length > 0
        ? edit.label.trim().slice(0, 32)
        : row.label;
    const nextColor =
      typeof edit.color === "string" && edit.color.startsWith("#")
        ? edit.color
        : row.color;
    return { ...row, label: nextLabel, color: nextColor };
  });
}

export async function POST(req: NextRequest) {
  const auth = await safeAuth();
  if (auth.error) return auth.error;

  const { data: body, error: parseError } = await safeJsonParse<Body>(req);
  if (parseError) return parseError;

  const spaceId = typeof body?.spaceId === "string" ? body.spaceId : "";
  const subObjectiveId =
    typeof body?.subObjectiveId === "string" ? body.subObjectiveId : "";
  if (!spaceId || !subObjectiveId) {
    return NextResponse.json(
      { error: "spaceId + subObjectiveId required" },
      { status: 400 },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = auth.supabase as any;

  // Ownership + load existing categories.
  const { data: sub, error: fetchError } = await db
    .from("improvement_goals")
    .select("id, user_id, space_id, room_categories")
    .eq("id", subObjectiveId)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json(
      { error: "DB error", detail: fetchError.message },
      { status: 500 },
    );
  }
  if (!sub || sub.user_id !== auth.user.id || sub.space_id !== spaceId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const existing = normalizeRoomCategories(sub.room_categories);
  if (
    existing.friction.length +
      existing.mechanism.length +
      existing.result.length ===
    0
  ) {
    return NextResponse.json(
      {
        error:
          "Sub-objective has no categories yet. Generate the room first.",
      },
      { status: 409 },
    );
  }

  // Merge edits — only existing slugs allowed; slug set is invariant.
  const updated: RoomCategories = {
    friction: mergeLaneEdits(existing.friction, body?.categories?.friction),
    mechanism: mergeLaneEdits(existing.mechanism, body?.categories?.mechanism),
    result: mergeLaneEdits(existing.result, body?.categories?.result),
  };

  const writeRes = await db
    .from("improvement_goals")
    .update({ room_categories: updated })
    .eq("id", subObjectiveId);

  if (writeRes.error) {
    return NextResponse.json(
      { error: "DB error", detail: writeRes.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ categories: updated });
}
