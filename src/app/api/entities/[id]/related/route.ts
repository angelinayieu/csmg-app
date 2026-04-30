// POST /api/entities/[id]/related
//
// "Add related concept" — surfaces and materializes peer (sibling)
// concepts adjacent to a target entity. Distinct from /deepen, which
// goes one layer DOWN (composes-children); this stays at the same
// abstraction layer and emits `relates_to` edges.
//
// Two-phase via discriminated body:
//   { action: "suggest" }                   → 5-7 candidates, no DB writes
//   { action: "accept", accepted: [...] }   → materializes selected
//
// The two phases mirror the deepen-chip / drawer pattern: preview
// before commit, but in a single endpoint to keep the surface small.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import {
  sanitizeEntity,
  resilientInsert,
  type SanitizedEntity,
} from "@/lib/sanitize";
import {
  buildEntityInput,
  upsertMemoryItemsBatch,
} from "@/lib/memory/writer";
import { invalidateCoverageForNewEntities } from "@/lib/kg/invalidate-coverage";

export const maxDuration = 30;

interface Ctx {
  params: Promise<{ id: string }>;
}

interface Suggestion {
  entity_id: string;
  name: string;
  description: string;
  relationship_type: string;
  rationale: string;
  importance?: string;
  entity_category?: string;
  confidence?: number;
}

interface SuggestRequest {
  action: "suggest";
}

interface AcceptRequest {
  action: "accept";
  accepted: Suggestion[];
}

type Req = SuggestRequest | AcceptRequest;

const RELATED_SYSTEM_PROMPT = `You are surfacing PEER concepts that sit at the same abstraction layer as a target concept — siblings, not children. Each peer should be a real, named thing the user would recognize, not a vague abstraction.

For each peer, emit:
  - entity_id: short_snake_case, 3-24 chars, unique
  - name: concrete noun phrase
  - description: 1-2 sentences, specific
  - relationship_type: one of "co_occurs_with" | "contrasts_with" | "competes_with" | "complements" | "depends_on" | "enables" | "constrains"
  - rationale: 1 sentence WHY they're related
  - importance: "fundamental" | "critical" | "important" | "moderate"
  - entity_category: "concrete" | "abstract" | "process" | "relational" | "epistemic"
  - confidence: 0.5 to 0.95

Return strict JSON:
{
  "related": [ { ... }, ... ]
}

Rules:
  - 5 to 7 peers — diverse, not redundant.
  - Don't propose children (sub-components) of the target. Stay at the SAME layer.
  - Don't repeat any of the existing_neighbors listed below.
  - Avoid generic concepts ("efficiency", "quality") — be concrete and specific.`;

interface LlmRelatedOutput {
  related: Array<Partial<Suggestion>>;
}

async function loadEntity(db: any, entityId: string) {
  const { data: entity } = (await db
    .from("entities")
    .select(
      "id, entity_id, space_id, name, description, importance, layer, entity_category",
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
      entity_category: string | null;
    } | null;
  };
  return entity;
}

async function ownsSpace(db: any, spaceId: string, userId: string) {
  const { data } = (await db
    .from("spaces")
    .select("id")
    .eq("id", spaceId)
    .eq("user_id", userId)
    .maybeSingle()) as { data: { id: string } | null };
  return !!data;
}

async function fetchNeighborNames(db: any, entityUuid: string, spaceId: string) {
  const { data: edgeRows } = (await db
    .from("edges")
    .select("source_entity_id, target_entity_id")
    .eq("space_id", spaceId)
    .or(`source_entity_id.eq.${entityUuid},target_entity_id.eq.${entityUuid}`)) as {
    data: Array<{ source_entity_id: string; target_entity_id: string }> | null;
  };
  const neighborIds = Array.from(
    new Set(
      (edgeRows ?? [])
        .flatMap((e) => [e.source_entity_id, e.target_entity_id])
        .filter((id) => id !== entityUuid),
    ),
  );
  if (neighborIds.length === 0) return [] as string[];
  const { data: ents } = (await db
    .from("entities")
    .select("name")
    .in("id", neighborIds.slice(0, 30))) as {
    data: Array<{ name: string }> | null;
  };
  return (ents ?? []).map((e) => e.name);
}

export async function POST(request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: entityId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const entity = await loadEntity(db, entityId);
  if (!entity) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }
  if (!(await ownsSpace(db, entity.space_id, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: Req;
  try {
    body = (await request.json()) as Req;
  } catch {
    body = { action: "suggest" };
  }

  if (body.action === "suggest") {
    try {
      const neighborNames = await fetchNeighborNames(db, entity.id, entity.space_id);
      const context = {
        target: {
          name: entity.name,
          description: entity.description,
          layer: entity.layer,
          importance: entity.importance,
          category: entity.entity_category,
        },
        existing_neighbors: neighborNames,
      };
      const output = await llmJSON<LlmRelatedOutput>({
        system: RELATED_SYSTEM_PROMPT,
        user: `Find 5-7 peer concepts related to this:\n\n${JSON.stringify(context, null, 2)}`,
        maxTokens: 1500,
        temperature: 0.4,
      });
      const raw = Array.isArray(output?.related) ? output.related : [];
      const suggestions: Suggestion[] = raw
        .map((s): Suggestion | null => {
          const name = typeof s.name === "string" ? s.name.trim() : "";
          const description =
            typeof s.description === "string" ? s.description.trim() : "";
          const entity_id =
            typeof s.entity_id === "string" &&
            /^[a-z0-9_]{3,24}$/.test(s.entity_id)
              ? s.entity_id
              : null;
          if (!name || !description || !entity_id) return null;
          return {
            entity_id,
            name,
            description,
            relationship_type:
              typeof s.relationship_type === "string"
                ? s.relationship_type
                : "co_occurs_with",
            rationale:
              typeof s.rationale === "string" ? s.rationale.trim() : "",
            importance:
              typeof s.importance === "string" ? s.importance : "important",
            entity_category:
              typeof s.entity_category === "string" ? s.entity_category : "abstract",
            confidence:
              typeof s.confidence === "number"
                ? Math.max(0, Math.min(1, s.confidence))
                : 0.7,
          };
        })
        .filter((s): s is Suggestion => s !== null);

      return NextResponse.json({ suggestions });
    } catch (err) {
      console.error("[related/suggest] error:", err);
      return NextResponse.json(
        { error: `Suggest failed: ${sanitizeErrorMessage(err)}` },
        { status: 500 },
      );
    }
  }

  if (body.action === "accept") {
    if (!Array.isArray(body.accepted) || body.accepted.length === 0) {
      return NextResponse.json(
        { error: "accepted[] must be a non-empty array of suggestions" },
        { status: 400 },
      );
    }

    try {
      const sanitized: SanitizedEntity[] = body.accepted.map((s) =>
        sanitizeEntity(
          {
            entity_id: /^[a-z0-9_]{3,24}$/.test(s.entity_id)
              ? `${entity.entity_id}__rel_${s.entity_id}`
              : undefined,
            name: s.name,
            description: s.description,
            source_tag: "inferred",
            entity_category: s.entity_category,
            // Same layer as the parent — peers, not children.
            layer: entity.layer ?? "thread",
            importance: s.importance ?? "important",
            confidence: s.confidence ?? 0.7,
            is_decomposable: true,
            provenance: {
              source: "related_concept",
              parent_entity_id: entity.id,
              parent_entity_code: entity.entity_id,
              relationship_type: s.relationship_type,
              rationale: s.rationale,
            },
          },
          entity.space_id,
        ),
      );

      const { data: insertedEnts } = await resilientInsert(
        db,
        "entities",
        sanitized,
        "id, entity_id, name, description, importance",
      );

      type Inserted = {
        id: string;
        entity_id: string;
        name: string;
        description: string | null;
        importance: string;
      };
      const inserted = insertedEnts as unknown as Inserted[];
      if (inserted.length === 0) {
        return NextResponse.json(
          { error: "No entities were inserted" },
          { status: 500 },
        );
      }

      // Map inserted UUIDs back to the relationship_type the user picked.
      const acceptedByCode = new Map<string, Suggestion>();
      for (const s of body.accepted) {
        acceptedByCode.set(`${entity.entity_id}__rel_${s.entity_id}`, s);
      }

      const edgeRecords = inserted
        .map((row) => {
          const suggestion = acceptedByCode.get(row.entity_id);
          if (!suggestion) return null;
          return {
            space_id: entity.space_id,
            source_entity_id: entity.id,
            target_entity_id: row.id,
            relationship_type: suggestion.relationship_type,
            dimension: "relational",
            source_tag: "inferred",
            strength: 0.55,
            polarity: "neutral",
            confidence: suggestion.confidence ?? 0.7,
            is_tradeoff: suggestion.relationship_type === "competes_with",
            is_part_of_cycle: false,
            topology: null,
            provenance: {
              created_by: "user_related_accept",
              rationale: suggestion.rationale,
            },
          };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);

      const { inserted: edgeCount } = await resilientInsert(
        db,
        "edges",
        edgeRecords,
      );

      // Memory-index siblings so ambient retrieval surfaces them.
      try {
        await upsertMemoryItemsBatch(
          db,
          inserted.map((c) =>
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
        console.warn("[related/accept] memory index failed (non-fatal):", memErr);
      }

      // Invalidate prior pair-checks involving the parent's neighborhood.
      try {
        const newEntityUuids = [entity.id, ...inserted.map((c) => c.id)];
        await invalidateCoverageForNewEntities(db, {
          spaceId: entity.space_id,
          newEntityIds: newEntityUuids,
          reason: "neighbor_added",
        });
      } catch (invErr) {
        console.warn(
          "[related/accept] coverage invalidation failed (non-fatal):",
          invErr,
        );
      }

      return NextResponse.json({
        created: inserted.map((c) => ({
          id: c.id,
          entity_id: c.entity_id,
          name: c.name,
          description: c.description,
          importance: c.importance,
        })),
        edges: edgeCount,
      });
    } catch (err) {
      console.error("[related/accept] error:", err);
      return NextResponse.json(
        { error: `Accept failed: ${sanitizeErrorMessage(err)}` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json(
    { error: "Unknown action — expected 'suggest' or 'accept'" },
    { status: 400 },
  );
}
