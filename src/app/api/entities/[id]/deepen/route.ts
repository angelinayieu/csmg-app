// POST /api/entities/[id]/deepen
//
// Sprint 5 — run scoped hierarchical decomposition on a single entity.
// Called from the accepted-proposal "Deepen" chip.
//
// Semantics:
//   - If the entity has already been deepened (composes-children exist),
//     return the existing children without running the LLM again.
//   - Otherwise, run `deepenEntity`, insert children + edges, memory-index
//     the children, and return them.
//
// Auth: the user must own the entity's space (standard ownership check
// matches the rest of the codebase).

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  deepenEntity,
  findExistingChildren,
  type DeepenResult,
} from "@/lib/pipeline/deepen-entity";
import {
  buildEntityInput,
  upsertMemoryItemsBatch,
} from "@/lib/memory/writer";
import { invalidateCoverageForNewEntities } from "@/lib/kg/invalidate-coverage";

export const maxDuration = 60;

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: entityId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Load entity + verify owner via space join
  const { data: entity } = (await db
    .from("entities")
    .select(
      "id, entity_id, space_id, name, description, importance, layer, is_decomposable",
    )
    .eq("id", entityId)
    .maybeSingle()) as {
    data: {
      id: string;
      entity_id: string;
      space_id: string;
      name: string;
      description: string | null;
      importance: string | null;
      layer: string | null;
      is_decomposable: boolean;
    } | null;
  };
  if (!entity) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }

  const { data: space } = (await db
    .from("spaces")
    .select("id")
    .eq("id", entity.space_id)
    .eq("user_id", user.id)
    .maybeSingle()) as { data: { id: string } | null };
  if (!space) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Short-circuit if already deepened
  const existing = await findExistingChildren(db, entity.id, entity.space_id);
  if (existing.length > 0) {
    const response: DeepenResult & { already_deepened: true } = {
      parent_entity_id: entity.id,
      children: existing,
      edges: 0,
      already_deepened: true,
    };
    return NextResponse.json(response);
  }

  // Run the LLM deepen
  try {
    const result = await deepenEntity(db, entity);

    // Memory-index new children so ambient retrieval surfaces them.
    if (result.children.length > 0) {
      try {
        await upsertMemoryItemsBatch(
          db,
          result.children.map((c) =>
            buildEntityInput(user.id, {
              id: c.id,
              space_id: entity.space_id,
              name: c.name,
              description: c.description,
              importance: c.importance,
            }),
          ),
        );
      } catch (memErr) {
        console.warn("[deepen] memory index failed (non-fatal):", memErr);
      }

      // Wave B — the parent entity's meaning has shifted (it now has
      // new structural children), and the children are brand-new KG
      // nodes. Flag apps that reference the parent OR whose served goal
      // depends on the parent via entity_objectives. Non-fatal.
      try {
        const { notifyEntitiesChanged } = await import("@/lib/apps/notify");
        const changedIds = [entity.id, ...result.children.map((c) => c.id)];
        await notifyEntitiesChanged(
          db,
          entity.space_id,
          changedIds,
          `user:deepen:${user.id}`,
        );
      } catch (notifyErr) {
        console.warn(
          "[deepen] app staleness notify failed (non-fatal):",
          notifyErr,
        );
      }

      // Phase 1 Step 6 — prior pairwise checks involving the parent's
      // 1-hop neighborhood may be stale now that the parent has
      // internal structure. Flag them for revisit on the next
      // prospector pass.
      try {
        const newEntityUuids = [entity.id, ...result.children.map((c) => c.id)];
        const invalidation = await invalidateCoverageForNewEntities(db, {
          spaceId: entity.space_id,
          newEntityIds: newEntityUuids,
          reason: "neighbor_added",
        });
        if (invalidation.flagged > 0) {
          console.log(
            `[deepen] invalidated ${invalidation.flagged} pair checks for ${invalidation.neighborCount} neighbors`,
          );
        }
      } catch (invErr) {
        console.warn("[deepen] coverage invalidation failed (non-fatal):", invErr);
      }
    }

    return NextResponse.json({ ...result, already_deepened: false });
  } catch (err) {
    console.error("[deepen] error:", err);
    return NextResponse.json(
      { error: `Deepen failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
