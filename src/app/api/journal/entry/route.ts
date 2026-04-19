// ── Journal entry endpoint ──
//
// POST /api/journal/entry
//   body: { space_id, entry_date, text }
//
// Flow:
//   1. Verify space ownership and that the space is a journal template
//   2. Fetch existing entities + recent entry summaries (last 5 entries)
//   3. LLM extracts: per-entity resolve_to_entity_id OR new extractions,
//      new edges, and entry-level metadata (emotions, values, tensions)
//   4. For each extraction:
//        - if resolve_to_entity_id matches: skip entity create, remember UUID
//        - else: sanitize + insert as new entity
//   5. Build edges — resolving both ends against the combined id map
//   6. Insert new edges (source_tag = "stated", since journal text is direct)
//   7. Insert journal_entries row with all referenced UUIDs + metadata
//   8. Return entry + summary of what was created

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership, sanitizeErrorMessage } from "@/lib/api-helpers";
import { llmJSON } from "@/lib/llm";
import { sanitizeEntity, sanitizeEdge, resilientInsert } from "@/lib/sanitize";
import {
  JOURNAL_EXTRACT_SYSTEM_PROMPT,
  buildJournalExtractUserPrompt,
} from "@/lib/prompts/journal-extract";
import type { Entity } from "@/types";

export const maxDuration = 60;

// Cap how many existing entities we surface to the prompt. More = better
// merge decisions; but huge token cost. Journals rarely exceed a few hundred
// entities so this is typically plenty.
const EXISTING_ENTITY_LIMIT = 80;
const RECENT_ENTRY_LIMIT = 5;

// ── LLM response shape ──

interface JournalExtractResponse {
  entry_metadata: {
    emotions_mentioned: string[];
    values_surfaced: string[];
    tensions_detected: string[];
    flow_activities: string[];
    drain_activities: string[];
    next_prompt: string;
  };
  extractions: Array<{
    name: string;
    description: string;
    entity_category: string;
    entity_type: string;
    importance: string;
    resolve_to_entity_id: string | null;  // existing entity_id (display id) or null
    reasoning: string;
  }>;
  new_edges: Array<{
    source: string;                        // name or entity_id
    target: string;
    relationship_type: string;
    dimension: string;
    reasoning: string;
  }>;
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let spaceId: string;
  let entryDate: string;
  let text: string;

  try {
    const body = await request.json();
    spaceId = body.space_id;
    entryDate = body.entry_date;
    text = body.text;
    if (typeof spaceId !== "string" || typeof entryDate !== "string" || typeof text !== "string") {
      return NextResponse.json({ error: "space_id, entry_date, text required" }, { status: 400 });
    }
    if (text.trim().length < 20) {
      return NextResponse.json({ error: "entry too short (min 20 chars)" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  try {
    // ── Step 1: Fetch existing entities + recent summaries ──
    const [entitiesRes, recentRes] = await Promise.all([
      db.from("entities")
        .select("id, entity_id, name, description, entity_type, entity_category, importance")
        .eq("space_id", spaceId)
        .limit(EXISTING_ENTITY_LIMIT),
      db.from("journal_entries")
        .select("entry_date, text")
        .eq("space_id", spaceId)
        .order("entry_date", { ascending: false })
        .limit(RECENT_ENTRY_LIMIT),
    ]);

    const existingEntities = (entitiesRes.data ?? []) as Array<Entity & { entity_id: string }>;
    const existingByDisplayId = new Map<string, { uuid: string; name: string }>();
    for (const e of existingEntities) existingByDisplayId.set(e.entity_id, { uuid: e.id, name: e.name });

    const recentEntries = ((recentRes.data ?? []) as Array<{ entry_date: string; text: string }>)
      .map((r) => ({ date: r.entry_date, summary: r.text.slice(0, 250) }));

    // ── Step 2: LLM extract ──
    const fallback: JournalExtractResponse = {
      entry_metadata: {
        emotions_mentioned: [],
        values_surfaced: [],
        tensions_detected: [],
        flow_activities: [],
        drain_activities: [],
        next_prompt: "",
      },
      extractions: [],
      new_edges: [],
    };

    const llmResult = await llmJSON<JournalExtractResponse>({
      system: JOURNAL_EXTRACT_SYSTEM_PROMPT,
      user: buildJournalExtractUserPrompt({
        entryText: text,
        entryDate,
        existingEntities: existingEntities.map((e) => ({
          entity_id: e.entity_id,
          name: e.name,
          description: e.description,
          entity_type: e.entity_type,
          entity_category: e.entity_category as string,
          importance: e.importance ?? "moderate",
        })),
        recentEntrySummaries: recentEntries,
      }),
      maxTokens: 3000,
      temperature: 0.3,
      fallback,
    });

    // ── Step 3: Process extractions ──
    // Build a map from (name OR resolved display id) → UUID
    // so edges can resolve both ends.
    const nameToUuid = new Map<string, string>();
    const referencedEntityIds = new Set<string>();
    const newEntities: ReturnType<typeof sanitizeEntity>[] = [];

    // Seed map with all existing entities so new_edges can reference them by
    // entity_id OR by name
    for (const e of existingEntities) {
      nameToUuid.set(e.entity_id, e.id);
      nameToUuid.set(e.name.toLowerCase(), e.id);
    }

    for (const ext of llmResult.extractions) {
      if (ext.resolve_to_entity_id && existingByDisplayId.has(ext.resolve_to_entity_id)) {
        // Merge path — referenced existing entity
        const existingUuid = existingByDisplayId.get(ext.resolve_to_entity_id)!.uuid;
        referencedEntityIds.add(existingUuid);
        nameToUuid.set(ext.name.toLowerCase(), existingUuid);
        // Also map the resolved display id
        nameToUuid.set(ext.resolve_to_entity_id, existingUuid);
        continue;
      }

      // New entity
      const displayId = `J${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 4)}`;
      const sanitized = sanitizeEntity(
        {
          entity_id: displayId,
          name: ext.name,
          description: ext.description,
          entity_category: ext.entity_category,
          entity_type: ext.entity_type,
          importance: ext.importance,
          source_tag: "explicit",            // came from direct user text
          confidence: 0.85,
          knowledge_layer: "internal",
          provenance: {
            source_type: "journal_entry",
            entry_date: entryDate,
            reasoning: ext.reasoning,
          },
        },
        spaceId,
      );
      newEntities.push(sanitized);
      // Reserve display id in the map for edge resolution (UUID comes after insert)
      nameToUuid.set(ext.name.toLowerCase(), displayId);
      nameToUuid.set(displayId, displayId);
    }

    // Insert new entities in one batch
    const insertedEntityRows = newEntities.length > 0
      ? (await resilientInsert(db, "entities", newEntities, "id, entity_id")).data
      : [];

    // Replace placeholder display-ids in nameToUuid with actual UUIDs
    for (const row of insertedEntityRows) {
      const displayId = row.entity_id;
      const uuid = row.id;
      if (displayId) {
        // Replace any occurrences of the displayId placeholder with the real UUID
        for (const [key, val] of nameToUuid.entries()) {
          if (val === displayId) nameToUuid.set(key, uuid);
        }
        referencedEntityIds.add(uuid);
      }
    }

    // ── Step 4: Build + insert edges ──
    const edgeRows = llmResult.new_edges
      .map((e) => {
        const srcKey = (e.source ?? "").toLowerCase();
        const tgtKey = (e.target ?? "").toLowerCase();
        const srcUuid = nameToUuid.get(e.source) ?? nameToUuid.get(srcKey);
        const tgtUuid = nameToUuid.get(e.target) ?? nameToUuid.get(tgtKey);
        if (!srcUuid || !tgtUuid) return null;
        // At this point the map still has mixed UUID + placeholder values;
        // filter to only actual UUIDs (rough heuristic: has hyphens)
        if (!srcUuid.includes("-") || !tgtUuid.includes("-")) return null;
        // Build an entity-id map keyed by itself (UUID → UUID) for sanitizeEdge
        return {
          source_entity_id: srcUuid,
          target_entity_id: tgtUuid,
          relationship_type: e.relationship_type,
          dimension: e.dimension,
          source_tag: "stated",
          polarity: "positive",
          strength: 0.6,
          confidence: 0.8,
          conditions: e.reasoning,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    // sanitizeEdge expects a display-id → UUID map. For journal-extracted edges
    // we already have UUID values, so we pass a trivial identity map.
    const identityMap = new Map<string, string>();
    for (const uuid of referencedEntityIds) identityMap.set(uuid, uuid);

    const sanitizedEdges = edgeRows
      .map((e) => sanitizeEdge(e, spaceId, identityMap))
      .filter((e): e is NonNullable<typeof e> => e !== null);

    let edgesInserted = 0;
    if (sanitizedEdges.length > 0) {
      const { inserted } = await resilientInsert(db, "edges", sanitizedEdges, "id");
      edgesInserted = inserted;
    }

    // ── Step 5: Insert the journal_entries row ──
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;

    const { data: entryRow, error: entryErr } = await db
      .from("journal_entries")
      .insert({
        space_id: spaceId,
        entry_date: entryDate,
        text,
        word_count: wordCount,
        referenced_entity_ids: Array.from(referencedEntityIds),
        emotions_mentioned: llmResult.entry_metadata.emotions_mentioned ?? [],
        values_surfaced: llmResult.entry_metadata.values_surfaced ?? [],
        tensions_detected: llmResult.entry_metadata.tensions_detected ?? [],
        flow_activities: llmResult.entry_metadata.flow_activities ?? [],
        drain_activities: llmResult.entry_metadata.drain_activities ?? [],
        next_prompt: llmResult.entry_metadata.next_prompt || null,
      })
      .select()
      .single();

    if (entryErr) {
      console.error("[journal/entry] Failed to save entry row:", entryErr);
      // Detect the common case where the journal_entries table doesn't exist
      // (migration 20260426 not applied) and give a clear hint.
      const msg = (entryErr.message ?? "").toLowerCase();
      const tableMissing = msg.includes("journal_entries") &&
        (msg.includes("does not exist") || msg.includes("not found"));
      return NextResponse.json(
        {
          error: `Failed to save entry: ${entryErr.message}`,
          hint: tableMissing
            ? "The journal_entries table doesn't exist yet. Apply migration supabase/migrations/20260426_journal_entries_use_case.sql and retry."
            : undefined,
        },
        { status: 500 },
      );
    }

    // ── Step 6: Changelog ──
    await db
      .from("space_changelog")
      .insert({
        space_id: spaceId,
        change_type: "journal_entry",
        summary: `Entry for ${entryDate}: ${insertedEntityRows.length} new entities, ${referencedEntityIds.size - insertedEntityRows.length} merged, ${edgesInserted} edges`,
        details: {
          entry_id: entryRow?.id,
          entry_date: entryDate,
          word_count: wordCount,
          new_entities: insertedEntityRows.length,
          merged_entities: referencedEntityIds.size - insertedEntityRows.length,
          edges_added: edgesInserted,
        },
      })
      .then(() => {}, () => {});

    return NextResponse.json({
      entry: entryRow,
      stats: {
        new_entities: insertedEntityRows.length,
        merged_into_existing: referencedEntityIds.size - insertedEntityRows.length,
        edges_added: edgesInserted,
      },
      next_prompt: llmResult.entry_metadata.next_prompt ?? null,
    });
  } catch (err) {
    console.error("[journal/entry] Error:", err);
    return NextResponse.json(
      { error: `Journal entry failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}

// ── GET — list entries for a space ──

export async function GET(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const url = new URL(request.url);
  const spaceId = url.searchParams.get("space_id");
  if (!spaceId) {
    return NextResponse.json({ error: "space_id required" }, { status: 400 });
  }

  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = await db
    .from("journal_entries")
    .select("*")
    .eq("space_id", spaceId)
    .order("entry_date", { ascending: false })
    .limit(60);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ entries: data ?? [] });
}
