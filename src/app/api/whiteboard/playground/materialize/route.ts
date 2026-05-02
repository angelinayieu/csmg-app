// ── Playground materialize endpoint ──
//
// POST /api/whiteboard/playground/materialize
//   body: { space_id, text, placement?: { x, y } }
//
// Materializes a user's free-form text as a real entity in the graph, with
// LLM-suggested connections to existing entities. Uses the same sanitize +
// resilient-insert pipeline as decompose/decompose-hierarchical so the new
// entity is indistinguishable from LLM-extracted ones downstream.
//
// The new entity AND its predicted edges are returned to the client. Edges
// have source_tag="predicted" so the whiteboard can render them as suggestions
// the user can accept/reject.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, sanitizeErrorMessage } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import { buildKgContext, renderKgContext } from "@/lib/kg-context";
import { sanitizeEntity, sanitizeEdge, resilientInsert } from "@/lib/sanitize";
import { detectEntities } from "@/lib/whiteboard/playground-detector";
import { flagAppsByEntityChange } from "@/lib/apps/staleness-triggers";
import { invalidateCoverageForNewEntities } from "@/lib/kg/invalidate-coverage";
import { logKnowledgeEvent } from "@/lib/changelog/log-knowledge-event";
import {
  PLAYGROUND_MATERIALIZE_SYSTEM_PROMPT,
  buildMaterializeUserPrompt,
  type MaterializeCandidate,
} from "@/lib/prompts/playground-materialize";
import { getTemplateAddendum } from "@/lib/use-cases/lens-resolver";
import type { Entity } from "@/types";

export const maxDuration = 45;

// Number of candidate entities to surface to the LLM. 20 is enough to cover
// semantically similar + a few structural anchors, without bloating the prompt.
const CANDIDATE_LIMIT = 20;

// ── LLM response shape ──

interface MaterializeResponse {
  entity: {
    name: string;
    description: string;
    importance: string;
    entity_category: string;
    layer: string | null;
    entity_type: string;
    confidence: number;
    reasoning: string;
  };
  connections: Array<{
    target_entity_id: string;  // display id
    relationship_type: string;
    dimension: string;
    confidence: number;
    polarity: string;
    reasoning: string;
  }>;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let spaceId: string;
  let text: string;
  let placement: { x: number; y: number } | undefined;
  // Optional lens hint from the intelligence router. If present, prepended
  // to the system prompt so domain-specific framing biases extraction.
  let lensAddendumFromClient: string | undefined;

  try {
    const body = await request.json();
    spaceId = body.space_id;
    text = body.text;
    if (body.placement && typeof body.placement.x === "number" && typeof body.placement.y === "number") {
      placement = body.placement;
    }
    if (typeof body.lens_addendum === "string" && body.lens_addendum.trim()) {
      lensAddendumFromClient = body.lens_addendum;
    }
    if (typeof spaceId !== "string" || typeof text !== "string" || text.trim().length < 3) {
      return NextResponse.json({ error: "space_id required and text must be >= 3 chars" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    // ── Step 1: Fetch space + entities ──
    const [spaceRes, entitiesRes] = await Promise.all([
      db.from("spaces").select("name, use_case_template_id").eq("id", spaceId).single(),
      db.from("entities").select("*").eq("space_id", spaceId),
    ]);

    const space = spaceRes.data;
    const entities = (entitiesRes.data ?? []) as Entity[];

    // ── Phase X2: resolve lens addendum — priority order ──
    // 1. Client-provided addendum (router already resolved)
    // 2. Space's own use_case_template_id (template-bound space)
    // 3. None (default generic prompt)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spaceTemplateId = (space as any)?.use_case_template_id as string | null | undefined;
    const activeLensAddendum =
      lensAddendumFromClient ?? getTemplateAddendum(spaceTemplateId) ?? null;

    // ── Step 2: Lexical pre-filter to CANDIDATE_LIMIT ──
    // We pass only the top candidates to the LLM so the prompt stays small.
    // The detector's same-module function gives us ranked matches.
    const candidateMatches = detectEntities(text, entities, CANDIDATE_LIMIT);
    const candidates: MaterializeCandidate[] = candidateMatches.map((m) => ({
      entity_id: m.entity.entity_id,
      name: m.entity.name,
      description: m.entity.description ?? "",
      layer: m.entity.layer ?? null,
      importance: m.entity.importance ?? null,
      category: m.entity.entity_category ?? null,
    }));

    // ── Step 3: Single LLM call — extract entity + suggest connections ──
    const fallback: MaterializeResponse = {
      entity: {
        name: text.slice(0, 60),
        description: text,
        importance: "moderate",
        entity_category: "abstract",
        layer: null,
        entity_type: "concept",
        confidence: 0.3,
        reasoning: "LLM extraction fell back to raw text",
      },
      connections: [],
    };

    // When a lens is active, prepend its domain framing to the base system
    // prompt. Materialization still produces the same structured entity output;
    // the lens just biases what types/names/categories the LLM gravitates
    // toward.
    const systemPromptToUse = activeLensAddendum
      ? `${activeLensAddendum}\n\n---\n\n${PLAYGROUND_MATERIALIZE_SYSTEM_PROMPT}`
      : PLAYGROUND_MATERIALIZE_SYSTEM_PROMPT;

    // ── Phase 1: KG context (broad mode, query=user text) ─────────
    // The candidates list (top-N entities by detector heuristics)
    // already enters the prompt as a flat name list. We complement
    // it with the KG layer the detector can't surface: edges between
    // candidates, the community summary that contains them, axioms
    // anchored to similar entities, and convergent concerns. This
    // helps materialize wire the new entity to a relationship
    // structure instead of guessing connections semantically.
    let kgGrounding = "";
    try {
      const kgCtx = await buildKgContext(supabase, {
        spaceId,
        mode: "broad",
        query: text,
      });
      kgGrounding = renderKgContext(kgCtx, {
        header:
          "## Knowledge graph context (use to wire the new entity into existing structure)",
      });
    } catch (err) {
      console.warn("[playground/materialize] KG context fetch failed:", err);
    }

    const taskPrompt = buildMaterializeUserPrompt({
      userText: text,
      spaceName: space?.name,
      candidates,
    });
    const userPrompt = kgGrounding
      ? `${kgGrounding}\n\n---\n\n${taskPrompt}`
      : taskPrompt;

    const llmResult = await llmJSON<MaterializeResponse>({
      system: systemPromptToUse,
      user: userPrompt,
      maxTokens: 2000,
      temperature: 0.3,
      fallback,
    });

    // ── Step 4: Validate + create the new entity ──
    // Generate a display id that won't collide with existing ones. Using
    // the space's prefix convention (letters) plus a random suffix.
    const randomSuffix = Math.random().toString(36).slice(2, 7);
    const displayId = `PG${randomSuffix}`;

    const sanitized = sanitizeEntity(
      {
        entity_id: displayId,
        name: llmResult.entity.name,
        description: llmResult.entity.description,
        importance: llmResult.entity.importance,
        entity_category: llmResult.entity.entity_category,
        entity_type: llmResult.entity.entity_type,
        layer: llmResult.entity.layer,
        source_tag: "implicit",
        confidence: llmResult.entity.confidence,
        knowledge_layer: "internal",
        provenance: {
          source_type: "playground_materialize",
          original_text: text,
          reasoning: llmResult.entity.reasoning,
          created_at: new Date().toISOString(),
        },
      },
      spaceId,
    );

    const { data: insertedEntities } = await resilientInsert(
      db,
      "entities",
      [sanitized],
      "id, entity_id",
    );

    if (!insertedEntities || insertedEntities.length === 0) {
      return NextResponse.json({ error: "Failed to create entity" }, { status: 500 });
    }

    const createdEntityRow = insertedEntities[0];
    const createdUuid = createdEntityRow.id;

    // ── Step 5: Build + insert predicted edges ──
    // Map candidate display IDs back to UUIDs.
    const entityIdToUuid = new Map<string, string>();
    for (const e of entities) entityIdToUuid.set(e.entity_id, e.id);
    // Include the just-created entity as a valid source.
    entityIdToUuid.set(displayId, createdUuid);

    const edgeInputs = llmResult.connections
      .filter((c) => entityIdToUuid.has(c.target_entity_id))
      .slice(0, 3) // hard cap
      .map((c) => ({
        source_entity_id: displayId,
        target_entity_id: c.target_entity_id,
        relationship_type: c.relationship_type,
        dimension: c.dimension,
        source_tag: "predicted",
        polarity: c.polarity,
        strength: 0.55,
        confidence: Math.max(0, Math.min(1, c.confidence)),
        conditions: c.reasoning,
        // Edges are predicted until user accepts. Flagged so UI can show
        // accept/reject affordance.
        requires_user_approval: true,
      }));

    const sanitizedEdges = edgeInputs
      .map((e) => sanitizeEdge(e, spaceId, entityIdToUuid))
      .filter((e): e is NonNullable<typeof e> => e !== null);

    let edgesInserted: Array<Record<string, string>> = [];
    if (sanitizedEdges.length > 0) {
      const { data: edgeData } = await resilientInsert(
        db,
        "edges",
        sanitizedEdges,
        "id, source_entity_id, target_entity_id, relationship_type, dimension, confidence, source_tag, requires_user_approval",
      );
      edgesInserted = edgeData ?? [];
    }

    // ── Step 6: Persist placement if provided ──
    if (placement) {
      await db
        .from("whiteboard_positions")
        .upsert(
          {
            space_id: spaceId,
            entity_id: createdUuid,
            x: Math.round(placement.x),
            y: Math.round(placement.y),
            moved_by: user.id,
          },
          { onConflict: "space_id,entity_id" },
        );
    }

    // ── Step 7: Log changelog ──
    await db
      .from("space_changelog")
      .insert({
        space_id: spaceId,
        change_type: "playground_materialize",
        summary: `Playground: created "${sanitized.name}" with ${edgesInserted.length} predicted connection${edgesInserted.length === 1 ? "" : "s"}`,
        details: {
          entity_uuid: createdUuid,
          entity_display_id: displayId,
          predicted_edges: edgesInserted.length,
          user_text: text.slice(0, 200),
          llm_confidence: llmResult.entity.confidence,
        },
      })
      .then(
        () => {},
        () => {},
      );

    // ── Step 8: Sprint 3 staleness hook ──
    // A new entity + its predicted edges may invalidate any App whose
    // dominant factors overlap those entities. Union the new entity UUID
    // with the UUIDs its predicted edges touch, then fan out.
    const touchedUuids = new Set<string>([createdUuid]);
    for (const e of edgesInserted) {
      if (e.source_entity_id) touchedUuids.add(e.source_entity_id);
      if (e.target_entity_id) touchedUuids.add(e.target_entity_id);
    }
    await flagAppsByEntityChange(
      db,
      spaceId,
      Array.from(touchedUuids),
      "whiteboard_edit",
      `user:${user.id}`,
      `Playground materialized "${sanitized.name}"`
    );

    // Phase 1 Step 6 — a new entity dropped on the canvas may introduce
    // indirect paths between previously-checked pairs. Flag them for
    // revisit on the next prospector pass. Soft-fail.
    try {
      const invalidation = await invalidateCoverageForNewEntities(db, {
        spaceId,
        newEntityIds: Array.from(touchedUuids),
        reason: "neighbor_added",
      });
      if (invalidation.flagged > 0) {
        console.log(
          `[materialize] invalidated ${invalidation.flagged} pair checks for ${invalidation.neighborCount} neighbors`,
        );
      }
    } catch (invErr) {
      console.warn("[materialize] coverage invalidation failed (non-fatal):", invErr);
    }

    // Phase 52 — log to unified event stream. Previously brainstorm
    // materialization wrote entities + edges but left no trace in the
    // changelog; consumers reading space_changelog missed this entirely.
    await logKnowledgeEvent(supabase, {
      spaceId,
      subtype: "brainstorm_materialized",
      summary: `Brainstorm materialized "${sanitized.name}"`,
      details: {
        entity_id: createdUuid,
        display_id: displayId,
        entity_category: sanitized.entity_category,
        layer: sanitized.layer,
        predicted_edges: edgesInserted.length,
      },
    });

    return NextResponse.json({
      entity: {
        id: createdUuid,
        entity_id: displayId,
        name: sanitized.name,
        description: sanitized.description,
        importance: sanitized.importance,
        entity_category: sanitized.entity_category,
        layer: sanitized.layer,
        depth: sanitized.depth,
        confidence: sanitized.confidence,
      },
      predicted_edges: edgesInserted,
      llm_reasoning: llmResult.entity.reasoning,
    });
  } catch (err) {
    console.error("[playground/materialize] Error:", err);
    return NextResponse.json(
      { error: `Materialize failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
