// ── /api/ingest/vision-extract ─────────────────────────────────────
//
// Phase 2 of the two-phase image ingest (see /api/ingest for phase 1).
//
// Phase 1 returns a row with empty normalized_text + null
// vision_completed_at. The client immediately POSTs the same image
// binary here. We:
//   1. Verify the user owns the row
//   2. Run extractImageWithStructure() — single Claude vision call
//      that returns ocr_text + description + entities + relationships
//   3. UPDATE the row with all four fields plus vision_model and
//      vision_completed_at
//   4. Emit the `image_extracted` SSE event so subscribers (file-card,
//      materialize-from-image, lasso-summarize) can react
//   5. Return the structured payload to the caller
//
// Why the binary travels twice (uploaded to /api/ingest, then again
// here): we don't persist the original image binary anywhere, so
// re-uploading is the cheapest path for v1. Bandwidth ~2x but no
// storage infrastructure changes. Trade can be revisited if image
// volume grows — the option is documented in the spec under "open
// question #1".

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { isImageMime, validateFile } from "@/lib/ingest/validate";
import {
  extractImageWithStructure,
  type StructuredImageExtraction,
} from "@/lib/ingest/extractors";
import { emitStructuralEvent } from "@/lib/events/structural-event-bus";
import { materializeImageContext } from "@/lib/objective-canvas/materialize-image-context";

// Vision call is ~3-6s, generous slack for upload + DB writes.
export const maxDuration = 60;
export const runtime = "nodejs";

interface IngestedFileRow {
  id: string;
  user_id: string;
  space_id: string | null;
  source_name: string;
  mime_type: string | null;
  vision_completed_at: string | null;
}

export async function POST(request: Request) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Expected multipart/form-data with `file` and `ingested_file_id` fields." },
      { status: 415 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Could not parse upload." }, { status: 400 });
  }

  const ingestedFileId = form.get("ingested_file_id");
  if (typeof ingestedFileId !== "string" || !ingestedFileId) {
    return NextResponse.json({ error: "Missing ingested_file_id." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing image file." }, { status: 400 });
  }

  // Re-validate the file. We don't trust the client; phase 1 may have
  // happened on a different device or via a stale cache.
  const check = validateFile({ size: file.size, type: file.type, name: file.name });
  if (!check.ok) {
    return NextResponse.json(
      { error: check.error.message, code: check.error.code },
      { status: 400 },
    );
  }
  if (!isImageMime(check.resolvedType)) {
    return NextResponse.json(
      { error: "Only image MIME types are supported on this endpoint." },
      { status: 400 },
    );
  }

  // Ownership + existence check. Returning 404 (not 403) when the row
  // exists for someone else avoids leaking row presence; the caller
  // sees the same response in both cases.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: row, error: fetchErr } = await db
    .from("ingested_files")
    .select("id, user_id, space_id, source_name, mime_type, vision_completed_at")
    .eq("id", ingestedFileId)
    .single();
  if (fetchErr || !row || (row as IngestedFileRow).user_id !== user.id) {
    return NextResponse.json(
      { error: "Ingested file not found." },
      { status: 404 },
    );
  }
  const fileRow = row as IngestedFileRow;

  const startedAt = Date.now();
  const buf = Buffer.from(await file.arrayBuffer());
  const extraction = await extractImageWithStructure(
    buf,
    fileRow.source_name,
    check.resolvedType,
  );

  // Always UPDATE vision_completed_at (success OR failure) so the
  // file-card stops showing "Analyzing image…". Failure path also
  // sets vision_error so the badge can surface what went wrong.
  const completedAt = new Date().toISOString();
  if (!extraction.ok) {
    const errorMsg = extraction.error.message;
    await db
      .from("ingested_files")
      .update({
        vision_completed_at: completedAt,
        vision_error: errorMsg,
      })
      .eq("id", fileRow.id);

    // Emit a failure event so the file-card flips to error state.
    if (fileRow.space_id) {
      try {
        await emitStructuralEvent(db, null, {
          type: "image_extracted",
          ingestedFileId: fileRow.id,
          spaceId: fileRow.space_id,
          entityCount: 0,
          relationshipCount: 0,
          description: "",
          durationMs: Date.now() - startedAt,
          error: errorMsg,
        });
      } catch (emitErr) {
        console.warn("[vision-extract] emit failure event threw:", emitErr);
      }
    }
    return NextResponse.json(
      { error: errorMsg, code: extraction.error.code },
      { status: 422 },
    );
  }

  const structured: StructuredImageExtraction = extraction.structured;
  // Update the row with the full structured payload. We replace
  // normalized_text on success so downstream consumers (decompose,
  // synthesis) work with the vision-pass OCR rather than the empty
  // string phase 1 wrote.
  const { error: updateErr } = await db
    .from("ingested_files")
    .update({
      normalized_text: extraction.result.text,
      normalized_chars: extraction.result.text.length,
      raw_chars: extraction.result.text.length,
      image_description: structured.description,
      extracted_entities: structured.entities,
      extracted_relationships: structured.relationships,
      vision_model: extraction.model,
      vision_completed_at: completedAt,
      vision_error: null,
      // Preserve the metadata bag from extraction (mime, byte count,
      // ocr_confident flag) but don't clobber phase-1 keys like
      // normalize_chunks / asset_class on the row.
      metadata: extraction.result.metadata,
    })
    .eq("id", fileRow.id);

  if (updateErr) {
    console.warn("[vision-extract] update failed:", updateErr);
    return NextResponse.json(
      { error: `Vision extraction succeeded but persistence failed: ${updateErr.message}` },
      { status: 500 },
    );
  }

  // Materialize the extraction into the context/taste layer:
  //   - one library_objects (context_concept) per entity, slugified into
  //     the same concept_slug namespace as glossary + annotations
  //   - library_object_sources row attaching this image to the per-space
  //     context anchor as a `reference`
  //   - taste-prose Claude pass writing ingested_files.image_narrative
  // Soft-fail: if any of this throws the route still returns 200 with
  // the structured payload. We are decorating the substrate, not gating it.
  let materialized: Awaited<ReturnType<typeof materializeImageContext>> | null =
    null;
  if (fileRow.space_id) {
    try {
      // Pull the root objective text so the taste-prose pass can anchor
      // its narrative in the user's actual goal rather than generic prose.
      let objectiveText: string | null = null;
      try {
        const { data: goal } = await db
          .from("improvement_goals")
          .select("description, title")
          .eq("space_id", fileRow.space_id)
          .is("parent_goal_id", null)
          .maybeSingle();
        objectiveText =
          (goal?.description as string | null) ??
          (goal?.title as string | null) ??
          null;
      } catch {
        /* soft-fail — taste pass tolerates null */
      }

      materialized = await materializeImageContext(db, {
        spaceId: fileRow.space_id,
        userId: user.id,
        ingestedFileId: fileRow.id,
        extraction: structured,
        objectiveText,
        runNarrativePass: true,
      });
    } catch (materErr) {
      console.warn("[vision-extract] materialize failed (soft):", materErr);
    }
  }

  const durationMs = Date.now() - startedAt;

  // Emit the SSE event last — persist-then-emit per the project's
  // event-bus convention. Wrapped in try/catch so a missing run
  // context (this endpoint isn't pipeline-scoped) doesn't fail the
  // whole request: emitStructuralEvent tolerates null runId.
  if (fileRow.space_id) {
    try {
      await emitStructuralEvent(db, null, {
        type: "image_extracted",
        ingestedFileId: fileRow.id,
        spaceId: fileRow.space_id,
        entityCount: structured.entities.length,
        relationshipCount: structured.relationships.length,
        description: structured.description.slice(0, 240),
        durationMs,
        error: null,
      });
    } catch (emitErr) {
      console.warn("[vision-extract] emit success event threw:", emitErr);
    }
  }

  return NextResponse.json({
    ingested_file_id: fileRow.id,
    description: structured.description,
    entity_count: structured.entities.length,
    relationship_count: structured.relationships.length,
    entities: structured.entities,
    relationships: structured.relationships,
    duration_ms: durationMs,
    vision_model: extraction.model,
    // The materialized context/taste seam: callers (objective-image-mount,
    // file-card) can show "+ N concepts → Library" without an extra round
    // trip. null when no space context (paste-from-clipboard without a
    // space, or soft-fail on the materializer side).
    context: materialized
      ? {
          anchor_id: materialized.anchorId,
          concept_ids: materialized.conceptIds,
          concept_slugs: materialized.conceptSlugs,
          narrative_written: materialized.narrativeWritten,
        }
      : null,
  });
}
