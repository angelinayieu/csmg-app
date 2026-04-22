import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { validateFile, validateUrl, isImageMime, inferMimeFromName } from "@/lib/ingest/validate";
import {
  extractPdf,
  extractDocx,
  extractImage,
  extractText,
  extractUrl,
  type ExtractResult,
} from "@/lib/ingest/extractors";
import { normalizeText } from "@/lib/ingest/normalizer";

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
      extractionMethod = "image-ocr";
      extraction = await extractImage(buf, file.name || "image", mime);
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
    // Small reminder to the client: text is editable before submit.
    notice:
      "Review the extracted text below. You can edit it before submitting for analysis.",
  });
}

// `inferMimeFromName` is now exported from validate.ts and used by validateFile.
// Kept here as a stable import anchor for future extensions.
void inferMimeFromName;
