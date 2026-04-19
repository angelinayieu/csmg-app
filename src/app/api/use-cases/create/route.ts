// ── Space-from-template creation endpoint ──
//
// POST /api/use-cases/create
//   body: { template_id, name?, description? }
//
// Creates a new space pre-configured with the template's seed entities + edges
// and records the `use_case_template_id` on the space so downstream surfaces
// can route correctly.

import { NextResponse } from "next/server";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { sanitizeEntity, sanitizeEdge, resilientInsert } from "@/lib/sanitize";
import { getTemplate } from "@/lib/use-cases/library";
import type { UseCaseId } from "@/types/use-case";

export const maxDuration = 30;

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  let templateId: UseCaseId;
  let nameOverride: string | undefined;
  let descriptionOverride: string | undefined;

  try {
    const body = await request.json();
    templateId = body.template_id;
    if (typeof body.name === "string" && body.name.trim()) nameOverride = body.name.trim();
    if (typeof body.description === "string" && body.description.trim()) descriptionOverride = body.description.trim();
    if (typeof templateId !== "string") {
      return NextResponse.json({ error: "template_id required" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const template = getTemplate(templateId);
  if (!template) {
    return NextResponse.json({ error: `Unknown template: ${templateId}` }, { status: 400 });
  }

  try {
    // ── Step 1: Create space ──
    const spaceName = nameOverride
      ?? template.default_space_name.replace(/\{\{date\}\}/g, new Date().toISOString().slice(0, 10));
    const description = descriptionOverride ?? template.default_description;

    const prefix = template.id.slice(0, 2).toUpperCase();

    // Minimum required fields — we only add optional columns below if they
    // don't cause schema errors. Conservative approach so this endpoint keeps
    // working even if the latest migration (20260426 — use_case_template_id)
    // hasn't been applied yet in the target environment.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insertPayload: Record<string, any> = {
      user_id: user.id,
      name: spaceName,
      description,
      space_prefix: prefix,
      input_text: `Template: ${template.name}`, // non-empty avoids any NOT NULL check on this column
      entity_count: 0,
      edge_count: 0,
      orphan_count: 0,
      cycle_count: 0,
      maturity: "actionable_now",
      context_type: template.context_type,
      use_case_template_id: template.id,
    };

    let { data: spaceData, error: spaceError } = await db
      .from("spaces")
      .insert(insertPayload)
      .select("id")
      .single();

    // If the failure is specifically about the new `use_case_template_id` column
    // (migration 20260426 not applied), retry without that column so the user
    // can still create spaces from templates. We just lose the template linkage
    // until they run the migration.
    if (spaceError) {
      const errText = (spaceError.message ?? "").toLowerCase();
      const isMissingColumn =
        errText.includes("use_case_template_id") ||
        errText.includes('column "use_case_template_id"') ||
        errText.includes("could not find the 'use_case_template_id' column");

      if (isMissingColumn) {
        console.warn(
          "[use-cases/create] `use_case_template_id` column missing — migration 20260426 may not be applied. Retrying without it.",
        );
        delete insertPayload.use_case_template_id;
        const retry = await db.from("spaces").insert(insertPayload).select("id").single();
        spaceData = retry.data;
        spaceError = retry.error;
      }
    }

    if (spaceError || !spaceData) {
      console.error("[use-cases/create] Space creation failed:", spaceError);
      return NextResponse.json(
        {
          error: "Space creation failed",
          // Surface the real Postgres error so the user/log can debug instead
          // of guessing. Safe to return — it's their own database.
          db_error: spaceError?.message ?? "unknown",
          hint: (spaceError?.message ?? "").toLowerCase().includes("use_case_template_id")
            ? "Migration 20260426_journal_entries_use_case.sql has not been applied. Run it and try again."
            : undefined,
        },
        { status: 500 },
      );
    }

    const spaceId = spaceData.id;

    // ── Step 2: Insert seed entities ──
    const seedIdToUuid = new Map<string, string>();

    if (template.seed_entities.length > 0) {
      const sanitizedSeeds = template.seed_entities.map((seed) =>
        sanitizeEntity(
          {
            entity_id: seed.seed_id,
            name: seed.name,
            description: seed.description,
            entity_category: seed.entity_category,
            entity_type: seed.entity_type,
            layer: seed.layer ?? undefined,
            importance: seed.importance,
            source_tag: "implicit",
            confidence: 0.9,
            knowledge_layer: "internal",
            provenance: {
              source_type: "template_seed",
              template_id: template.id,
              seed_id: seed.seed_id,
              notes: seed.notes ?? null,
            },
          },
          spaceId,
        ),
      );

      const { data: insertedSeedEntities } = await resilientInsert(
        db,
        "entities",
        sanitizedSeeds,
        "id, entity_id",
      );

      for (const row of insertedSeedEntities) {
        seedIdToUuid.set(row.entity_id, row.id);
      }
    }

    // ── Step 3: Insert seed edges ──
    let seedEdgesInserted = 0;
    if (template.seed_edges.length > 0) {
      const sanitizedSeedEdges = template.seed_edges
        .map((seedEdge) =>
          sanitizeEdge(
            {
              source_entity_id: seedEdge.source_seed_id,
              target_entity_id: seedEdge.target_seed_id,
              relationship_type: seedEdge.relationship_type,
              dimension: seedEdge.dimension,
              source_tag: "stated",
              polarity: "positive",
              strength: 0.7,
              confidence: 0.85,
            },
            spaceId,
            seedIdToUuid,
          ),
        )
        .filter((e): e is NonNullable<typeof e> => e !== null);

      if (sanitizedSeedEdges.length > 0) {
        const { inserted } = await resilientInsert(db, "edges", sanitizedSeedEdges, "id");
        seedEdgesInserted = inserted;
      }
    }

    // ── Step 4: Update space counts ──
    await db.from("spaces").update({
      entity_count: seedIdToUuid.size,
      edge_count: seedEdgesInserted,
    }).eq("id", spaceId);

    // ── Step 5: Changelog ──
    await db.from("space_changelog").insert({
      space_id: spaceId,
      change_type: "template_seed",
      summary: `Created from template: ${template.name} (${seedIdToUuid.size} seed entities, ${seedEdgesInserted} seed edges)`,
      details: {
        template_id: template.id,
        seed_entities: seedIdToUuid.size,
        seed_edges: seedEdgesInserted,
      },
    }).then(() => {}, () => {});

    return NextResponse.json({
      space: {
        id: spaceId,
        name: spaceName,
        use_case_template_id: template.id,
      },
      seed_stats: {
        entities: seedIdToUuid.size,
        edges: seedEdgesInserted,
      },
      default_surface: template.default_surface,
    });
  } catch (err) {
    console.error("[use-cases/create] Error:", err);
    return NextResponse.json(
      { error: `Template creation failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }
}
