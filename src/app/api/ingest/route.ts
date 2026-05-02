import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { validateFile, validateUrl, isImageMime, inferMimeFromName } from "@/lib/ingest/validate";
import {
  extractPdf,
  extractDocx,
  extractText,
  extractUrl,
  type ExtractResult,
} from "@/lib/ingest/extractors";
import { normalizeText } from "@/lib/ingest/normalizer";
import { inferAssetClass, type AssetClass } from "@/types/asset";

export const maxDuration = 90;
// Node runtime needed: pdf-parse + jsdom don't run on edge.
export const runtime = "nodejs";

/**
 * POST /api/ingest
 *
 * Three accepted shapes:
 *   - multipart/form-data with a `file` field   → extract file
 *   - application/json { type: "url", url }      → fetch + extract article
 *   - application/json { type: "text", text }    → passthrough (so the same
 *                                                  endpoint can power future
 *                                                  "paste + normalize" flows)
 *
 * Returns normalized markdown ready for /api/analyze or /api/pipeline/scope.
 * Does NOT itself create a space — the caller submits the returned text
 * through the existing analysis flow.
 */
export async function POST(request: Request) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const contentType = request.headers.get("content-type") ?? "";

  // Phase 2D — persistence. Track source metadata we'll write to
  // ingested_files after the extraction succeeds. Captured per-branch
  // below so the multipart / url / text paths each set them uniquely.
  let sourceType: "file" | "url" | "text" = "file";
  let sourceUrl: string | null = null;
  let mimeType: string | null = null;
  let extractionMethod: string | null = null;
  let spaceIdForPersist: string | null = null;

  let extraction: { ok: true; result: ExtractResult } | { ok: false; error: { code: string; message: string } };

  if (contentType.includes("multipart/form-data")) {
    // ── File upload path ───────────────────────────────────────────
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "Could not parse upload." }, { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }

    const check = validateFile({ size: file.size, type: file.type, name: file.name });
    if (!check.ok) {
      return NextResponse.json({ error: check.error.message, code: check.error.code }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const mime = check.resolvedType;

    // Capture persistence metadata before extraction diverges by mime.
    sourceType = "file";
    mimeType = mime;
    const formSpaceId = form.get("space_id");
    if (typeof formSpaceId === "string" && formSpaceId) {
      spaceIdForPersist = formSpaceId;
    }

    if (mime === "application/pdf") {
      extractionMethod = "pdf-parse";
      extraction = await extractPdf(buf, file.name || "document.pdf");
    } else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      extractionMethod = "docx";
      extraction = await extractDocx(buf, file.name || "document.docx");
    } else if (isImageMime(mime)) {
      // Two-phase image ingest (2026-05-01): phase 1 returns
      // immediately with an empty result so the file-card lands on
      // canvas without a multi-second wait. The client follows up by
      // POSTing the same binary to /api/ingest/vision-extract which
      // populates image_description + extracted_entities + edges.
      // Until the vision pass completes the row's normalized_text is
      // empty — that's intentional; useMaterialize is a no-op until
      // phase 2 fires (the file-card status badge handles the UX).
      extractionMethod = "image-pending-vision";
      extraction = {
        ok: true,
        result: {
          text: "",
          source_name: file.name || "image",
          metadata: {
            source_type: "image",
            original_bytes: buf.byteLength,
            image_mime: mime,
            // Phase 2 will overwrite this once the structured vision
            // pass lands. Until then we conservatively report
            // ocr_confident=false so any UI gating on it doesn't
            // treat the empty row as authoritative.
            ocr_confident: false,
          },
        },
      };
    } else if (mime === "text/plain" || mime === "text/markdown") {
      extractionMethod = mime === "text/markdown" ? "markdown" : "text";
      extraction = extractText(
        buf.toString("utf-8"),
        file.name || (mime === "text/markdown" ? "document.md" : "document.txt"),
        mime === "text/markdown" ? "markdown" : "text",
      );
    } else {
      // Shouldn't reach here — validateFile already blocked it.
      return NextResponse.json({ error: `Unsupported MIME: ${mime}` }, { status: 400 });
    }
  } else if (contentType.includes("application/json")) {
    // ── URL or text path ───────────────────────────────────────────
    let body: { type?: string; url?: string; text?: string; space_id?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    if (typeof body.space_id === "string" && body.space_id) {
      spaceIdForPersist = body.space_id;
    }

    if (body.type === "url") {
      if (!body.url || typeof body.url !== "string") {
        return NextResponse.json({ error: "URL missing." }, { status: 400 });
      }
      const check = validateUrl(body.url);
      if (!check.ok) {
        return NextResponse.json({ error: check.error.message, code: check.error.code }, { status: 400 });
      }
      sourceType = "url";
      // `check.url` is a parsed URL object; stringify for persistence.
      sourceUrl = String(check.url);
      mimeType = "text/html";
      extractionMethod = "url-fetch";
      extraction = await extractUrl(check.url);
    } else if (body.type === "text") {
      if (typeof body.text !== "string" || !body.text.trim()) {
        return NextResponse.json({ error: "Text missing." }, { status: 400 });
      }
      sourceType = "text";
      mimeType = "text/plain";
      extractionMethod = "paste";
      extraction = extractText(body.text, "pasted-text", "text");
    } else {
      return NextResponse.json(
        { error: `Unknown ingest type: ${body.type ?? "(missing)"}. Expected "url" or "text".` },
        { status: 400 },
      );
    }
  } else {
    return NextResponse.json(
      {
        error:
          "Expected multipart/form-data (file upload) or application/json ({ type, url | text }).",
      },
      { status: 415 },
    );
  }

  if (!extraction.ok) {
    return NextResponse.json(
      { error: extraction.error.message, code: extraction.error.code },
      { status: 422 },
    );
  }

  // ── Normalize ────────────────────────────────────────────────────
  const { text: normalizedText, normalized, chunks } = await normalizeText(extraction.result.text);

  // ── Asset class classification ───────────────────────────────────
  // Filename + mime + first-500-char heuristic. Reliable enough for
  // the obvious cases (PDFs named "research.pdf", spreadsheets, image
  // diagrams). For ambiguous documents the LLM-driven situation
  // analyzer downstream can re-classify — this is the cheap pre-pass.
  const assetClass: AssetClass = inferAssetClass({
    sourceType,
    mimeType,
    sourceName: extraction.result.source_name,
    contentSnippet: normalizedText.slice(0, 500),
  });

  // Phase 2D — persist to ingested_files so the upload survives the
  // parse/submit gap and surfaces in the Library's Files folder.
  // Non-blocking: if the insert fails we still return the extracted
  // text so the user isn't blocked on a storage hiccup.
  let ingestedFileId: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const { data: inserted, error: insertErr } = await db
      .from("ingested_files")
      .insert({
        user_id: user.id,
        space_id: spaceIdForPersist,
        source_type: sourceType,
        source_name: extraction.result.source_name,
        mime_type: mimeType,
        source_url: sourceUrl,
        normalized_text: normalizedText,
        raw_chars: extraction.result.text.length,
        normalized_chars: normalizedText.length,
        extraction_method: extractionMethod,
        // Asset class is set by inferAssetClass above. The situation
        // analyzer reads this field downstream to decide whether to
        // treat the file as evidence (research_pdf, prior_analysis),
        // structure (spec_sheet, internal_doc), or observation
        // (dataset). See src/types/asset.ts.
        asset_class: assetClass,
        metadata: {
          ...extraction.result.metadata,
          normalize_chunks: chunks,
          normalized,
        },
      })
      .select("id")
      .single();
    if (insertErr) {
      console.warn("[ingest] persist failed (non-fatal):", insertErr);
    } else {
      ingestedFileId = (inserted as { id: string } | null)?.id ?? null;
    }
  } catch (err) {
    console.warn("[ingest] persist threw (non-fatal):", err);
  }

  // Two-phase image ingest signal — when the request was an image
  // and we deferred the vision pass, tell the client to follow up
  // with /api/ingest/vision-extract using the same binary.
  const awaitingVision = extractionMethod === "image-pending-vision";

  return NextResponse.json({
    text: normalizedText,
    source_name: extraction.result.source_name,
    metadata: {
      ...extraction.result.metadata,
      raw_chars: extraction.result.text.length,
      normalized_chars: normalizedText.length,
      normalized,
      normalize_chunks: chunks,
    },
    // New: row id so the client can reference this ingest in future
    // calls (e.g. /api/analyze could link entities back to source).
    ingested_file_id: ingestedFileId,
    // The classified asset class — UI can render the upload chip with
    // the right color/label without a second roundtrip.
    asset_class: assetClass,
    // Two-phase ingest: client should re-POST the same image binary
    // to /api/ingest/vision-extract to populate description/entities/
    // relationships. Non-image ingests get false here.
    awaiting_vision: awaitingVision,
    // Small reminder to the client: text is editable before submit.
    notice:
      "Review the extracted text below. You can edit it before submitting for analysis.",
  });
}

// `inferMimeFromName` is now exported from validate.ts and used by validateFile.
// Kept here as a stable import anchor for future extensions.
void inferMimeFromName;
