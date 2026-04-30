// POST /api/entities/[id]/deepen
//
// Sprint 5 — run scoped hierarchical decomposition on a single entity.
// Called from the accepted-proposal "Deepen" chip and the per-card (+)
// menu's "Decompose" action.
//
// Semantics:
//   - depth=light (default): single LLM pass, 3-5 children. If the
//     entity has already been deepened, returns existing children
//     without running the LLM.
//   - depth=medium|deep|first_principles: recursive multi-level deepen
//     up to 2/3/4 levels respectively, capped by an LLM-call budget so
//     the request fits inside the 60s timeout. Existing children are
//     reused at each level rather than re-LLM'd.
//
// Auth: the user must own the entity's space (standard ownership check
// matches the rest of the codebase).

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  deepenEntity,
  deepenEntityRecursive,
  findExistingChildren,
  flattenRecursiveChildren,
  type DeepenResult,
  type DeepenDepth,
} from "@/lib/pipeline/deepen-entity";
import {
  buildEntityInput,
  upsertMemoryItemsBatch,
} from "@/lib/memory/writer";
import { invalidateCoverageForNewEntities } from "@/lib/kg/invalidate-coverage";

export const maxDuration = 60;

const VALID_DEPTHS: ReadonlySet<DeepenDepth> = new Set([
  "light",
  "medium",
  "deep",
  "first_principles",
]);

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: entityId } = await ctx.params;

  const url = new URL(request.url);
  const depthParam = url.searchParams.get("depth");
  const depth: DeepenDepth | null =
    depthParam && VALID_DEPTHS.has(depthParam as DeepenDepth)
      ? (depthParam as DeepenDepth)
      : null;

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

  // ── Multi-level (recursive) deepen branch ──────────────────────
  // When the caller asks for medium/deep/first_principles depth, we
  // run the recursive helper. Light is allowed too as an explicit
  // form of the default behavior. When `depth` is null (no param),
  // fall through to the legacy single-level path so existing callers
  // (DeepenChip) keep their behavior.
  if (depth) {
    try {
      const recursive = await deepenEntityRecursive(db, entity, depth);

      const flatNew = flattenRecursiveChildren(recursive.children);
      if (flatNew.length > 0) {
        try {
          await upsertMemoryItemsBatch(
            db,
            flatNew.map((c) =>
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
          console.warn("[deepen-recursive] memory index failed (non-fatal):", memErr);
        }

        try {
          const { notifyEntitiesChanged } = await import("@/lib/apps/notify");
          const changedIds = [entity.id, ...flatNew.map((c) => c.id)];
          await notifyEntitiesChanged(
            db,
            entity.space_id,
            changedIds,
            `user:deepen:${depth}:${user.id}`,
          );
        } catch (notifyErr) {
          console.warn(
            "[deepen-recursive] app staleness notify failed (non-fatal):",
            notifyErr,
          );
        }

        try {
          const newEntityUuids = [entity.id, ...flatNew.map((c) => c.id)];
          const invalidation = await invalidateCoverageForNewEntities(db, {
            spaceId: entity.space_id,
            newEntityIds: newEntityUuids,
            reason: "neighbor_added",
          });
          if (invalidation.flagged > 0) {
            console.log(
              `[deepen-recursive] invalidated ${invalidation.flagged} pair checks for ${invalidation.neighborCount} neighbors`,
            );
          }
        } catch (invErr) {
          console.warn(
            "[deepen-recursive] coverage invalidation failed (non-fatal):",
            invErr,
          );
        }
      }

      return NextResponse.json(recursive);
    } catch (err) {
      console.error("[deepen-recursive] error:", err);
      return NextResponse.json(
        { error: `Deepen failed: ${sanitizeErrorMessage(err)}` },
        { status: 500 },
      );
    }
  }

  // ── Legacy single-level path (default when no `depth` param) ───
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
