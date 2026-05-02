// ── /api/canvas/materialize-from-image ─────────────────────────────
//
// Bulk-creates KG entities + edges from a previously-vision-analyzed
// image (see /api/ingest/vision-extract). The cached extraction lives
// on `ingested_files` (image_description, extracted_entities,
// extracted_relationships); this endpoint reads those columns,
// inserts entities + edges into the KG with `source_tag: "implicit"`
// and `requires_user_approval: true` so the user can accept or reject
// the additions like any other AI-proposed item.
//
// Two trigger paths:
//   - Auto: client receives the `image_extracted` SSE event (or
//     /api/ingest/vision-extract response) and calls this immediately
//   - Manual: file-card "Decompose into entities" button calls this
//     on demand
//
// Idempotency: re-running this endpoint for the same ingested_file_id
// is safe — entities are deduped by name within the same call, but
// we don't dedupe against existing entities in the space because
// (a) the user may legitimately want a second cluster from a re-run,
// (b) name collision across image extractions is rare, and (c) the
// accept/reject UI lets the user clean up duplicates.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  safeJsonParse,
  verifySpaceOwnership,
} from "@/lib/api-helpers";
import { sanitizeEntity, sanitizeEdge, resilientInsert } from "@/lib/sanitize";
import type {
  ExtractedEntity,
  ExtractedRelationship,
} from "@/lib/ingest/extractors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface IncomingBody {
  ingested_file_id?: string;
  space_id?: string;
  /** Optional placement target — usually the file-card's position so
   *  the new entities arc out next to it. The router/painter handles
   *  the actual layout; we just pass this through to provenance. */
  placement?: { x: number; y: number };
  /** When true (default) edges flagged requires_user_approval; when
   *  false we trust the extraction and persist them as confirmed. */
  require_approval?: boolean;
}

interface IngestedFileRow {
  id: string;
  user_id: string;
  space_id: string | null;
  source_name: string;
  image_description: string | null;
  extracted_entities: ExtractedEntity[] | null;
  extracted_relationships: ExtractedRelationship[] | null;
  vision_completed_at: string | null;
}

export async function POST(request: NextRequest) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const parsed = await safeJsonParse<IncomingBody>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const ingestedFileId = body.ingested_file_id;
  const spaceId = body.space_id;
  if (!ingestedFileId || !spaceId) {
    return NextResponse.json(
      { error: "Both ingested_file_id and space_id are required." },
      { status: 400 },
    );
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Load the cached extraction. We don't re-fetch the image binary or
  // re-run vision — the whole point of this endpoint is that the work
  // already happened during phase 2 of ingest.
  const { data: row, error: fetchErr } = await db
    .from("ingested_files")
    .select(
      "id, user_id, space_id, source_name, image_description, extracted_entities, extracted_relationships, vision_completed_at",
    )
    .eq("id", ingestedFileId)
    .single();
  if (fetchErr || !row || (row as IngestedFileRow).user_id !== user.id) {
    return NextResponse.json(
      { error: "Ingested file not found." },
      { status: 404 },
    );
  }
  const fileRow = row as IngestedFileRow;
  if (!fileRow.vision_completed_at) {
    return NextResponse.json(
      {
        error:
          "Vision extraction not complete yet. Wait for image_extracted before materializing.",
        code: "vision_pending",
      },
      { status: 409 },
    );
  }

  const extractedEntities = Array.isArray(fileRow.extracted_entities)
    ? fileRow.extracted_entities
    : [];
  const extractedRelationships = Array.isArray(fileRow.extracted_relationships)
    ? fileRow.extracted_relationships
    : [];

  if (extractedEntities.length === 0) {
    return NextResponse.json({
      parent_entity_id: null,
      entities: [],
      edges: [],
      message: "No entities in cached extraction — nothing to materialize.",
    });
  }

  const requireApproval = body.require_approval !== false;
  const provenance = {
    source_type: "image_extracted",
    ingested_file_id: fileRow.id,
    source_name: fileRow.source_name,
    image_description: fileRow.image_description,
    created_at: new Date().toISOString(),
  };

  // ── Step 1: anchor entity ──────────────────────────────────────
  // Every image extraction gets a single "image" anchor entity that
  // owns all the depicted entities as descendants. This gives the
  // user a clean handle ("zoom to image cluster", "pin all"); the
  // painter draws the children arrayed around it.
  const anchorDisplayId = `IMG${fileRow.id.slice(0, 6)}`;
  const anchorSanitized = sanitizeEntity(
    {
      entity_id: anchorDisplayId,
      name: fileRow.source_name || "Image",
      description: fileRow.image_description || null,
      importance: "moderate",
      entity_type: "concept",
      entity_category: "concept",
      layer: "internal",
      source_tag: "implicit",
      confidence: 0.8,
      knowledge_layer: "internal",
      provenance: { ...provenance, role: "anchor" },
    },
    spaceId,
  );

  const { data: anchorInsert } = await resilientInsert(
    db,
    "entities",
    [anchorSanitized],
    "id, entity_id",
  );
  const anchorRow = (anchorInsert ?? [])[0] as
    | { id: string; entity_id: string }
    | undefined;
  if (!anchorRow) {
    return NextResponse.json(
      { error: "Failed to insert image anchor entity." },
      { status: 500 },
    );
  }
  const anchorUuid = anchorRow.id;

  // ── Step 2: bulk insert depicted entities ──────────────────────
  // Dedup by name within this call. The first occurrence wins (LLM
  // sometimes echoes a duplicate when describing complex diagrams).
  const seen = new Set<string>();
  const childEntitiesSanitized = extractedEntities
    .filter((e) => {
      if (!e.name || seen.has(e.name)) return false;
      seen.add(e.name);
      return true;
    })
    .map((e, i) => {
      const displayId = `${anchorDisplayId}_${i + 1}`;
      return sanitizeEntity(
        {
          entity_id: displayId,
          name: e.name,
          description: e.description || null,
          importance: "moderate",
          entity_type: e.type || "concept",
          entity_category: e.type || "concept",
          layer: "internal",
          source_tag: "implicit",
          confidence: 0.7,
          knowledge_layer: "internal",
          provenance: {
            ...provenance,
            role: "depicted",
            anchor_entity_id: anchorUuid,
            extracted_type: e.type,
            extracted_role_position: e.rolePosition,
          },
        },
        spaceId,
      );
    });

  let insertedChildren: Array<{ id: string; entity_id: string; name: string }> = [];
  if (childEntitiesSanitized.length > 0) {
    const { data: childData } = await resilientInsert(
      db,
      "entities",
      childEntitiesSanitized,
      "id, entity_id, name",
    );
    insertedChildren = (childData ?? []) as Array<{
      id: string;
      entity_id: string;
      name: string;
    }>;
  }

  // Build a name → UUID map so we can resolve relationships by their
  // human-readable names. We also include the anchor under its own
  // name in case any extracted relationship happens to reference it.
  const nameToUuid = new Map<string, string>();
  for (const child of insertedChildren) nameToUuid.set(child.name, child.id);
  if (fileRow.source_name) nameToUuid.set(fileRow.source_name, anchorUuid);

  // We also need an entity_id (display) → UUID map for sanitizeEdge
  // (which expects display ids on inputs). Fill it from inserted
  // entities so the sanitize step can resolve them correctly.
  const entityIdToUuid = new Map<string, string>();
  entityIdToUuid.set(anchorDisplayId, anchorUuid);
  for (let i = 0; i < insertedChildren.length; i++) {
    entityIdToUuid.set(`${anchorDisplayId}_${i + 1}`, insertedChildren[i].id);
  }

  // ── Step 3: build "anchor → child" containment edges ──────────
  // These let downstream features ("zoom to image cluster",
  // "show all entities from this image") work as a graph query
  // without needing a separate anchor table.
  const containmentEdges = insertedChildren.map((child, i) => ({
    source_entity_id: anchorDisplayId,
    target_entity_id: `${anchorDisplayId}_${i + 1}`,
    relationship_type: "contains",
    dimension: "structural",
    polarity: "positive",
    strength: 0.8,
    confidence: 0.85,
    source_tag: "predicted",
    requires_user_approval: requireApproval,
    conditions: "Image anchor → depicted entity",
  }));

  // ── Step 4: build extracted relationships ──────────────────────
  // Resolve fromName/toName → display ids (then sanitizeEdge maps to
  // UUIDs). Skip any relationship whose endpoints aren't in our
  // inserted set.
  const childNameToDisplayId = new Map<string, string>();
  for (let i = 0; i < insertedChildren.length; i++) {
    childNameToDisplayId.set(
      insertedChildren[i].name,
      `${anchorDisplayId}_${i + 1}`,
    );
  }
  const relEdges = extractedRelationships
    .map((r) => {
      const src = childNameToDisplayId.get(r.fromName);
      const dst = childNameToDisplayId.get(r.toName);
      if (!src || !dst || src === dst) return null;
      return {
        source_entity_id: src,
        target_entity_id: dst,
        relationship_type: r.label || "related to",
        dimension: "causal",
        polarity:
          r.polarity === "positive"
            ? "positive"
            : r.polarity === "negative"
              ? "negative"
              : "neutral",
        strength: 0.55,
        confidence: 0.65,
        source_tag: "predicted",
        requires_user_approval: requireApproval,
        conditions: r.label,
      };
    })
    .filter(<T,>(v: T | null): v is T => v !== null);

  const allEdgeInputs = [...containmentEdges, ...relEdges];
  const sanitizedEdges = allEdgeInputs
    .map((e) => sanitizeEdge(e, spaceId, entityIdToUuid))
    .filter((e): e is NonNullable<typeof e> => e !== null);

  let edgesInserted: Array<Record<string, string>> = [];
  if (sanitizedEdges.length > 0) {
    const { data: edgeData } = await resilientInsert(
      db,
      "edges",
      sanitizedEdges,
      "id, source_entity_id, target_entity_id, relationship_type, source_tag, requires_user_approval",
    );
    edgesInserted = (edgeData ?? []) as Array<Record<string, string>>;
  }

  return NextResponse.json({
    parent_entity_id: anchorUuid,
    entities: [
      { id: anchorUuid, name: fileRow.source_name || "Image", role: "anchor" },
      ...insertedChildren.map((c) => ({
        id: c.id,
        name: c.name,
        role: "depicted",
      })),
    ],
    edges: edgesInserted,
    placement: body.placement ?? null,
    counts: {
      entities: insertedChildren.length + 1,
      containment_edges: containmentEdges.length,
      relationship_edges: relEdges.length,
    },
  });
}
