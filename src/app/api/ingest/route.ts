import { NextResponse, after } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import { validateFile, validateUrl, isImageMime, isSpreadsheetMime, inferMimeFromName } from "@/lib/ingest/validate";
import {
  extractText,
  extractUrl,
  extractSpreadsheet,
  type ExtractResult,
} from "@/lib/ingest/extractors";
import { normalizeText } from "@/lib/ingest/normalizer";
import { inferAssetClass, type AssetClass } from "@/types/asset";
import { parseAssetInBackground } from "@/lib/ingest/parse-worker";

// Two-phase ingest: the route persists the row + schedules background
// parse via after() and returns in <1s. The lambda stays alive until
// after() completes (up to maxDuration), but the gateway sees the
// response immediately so 504 is no longer possible from this route.
export const maxDuration = 300;
// Node runtime needed: pdf-parse + jsdom + normalizer don't run on edge.
export const runtime = "nodejs";

/**
 * POST /api/ingest
 *
 * Three accepted shapes:
 *   - multipart/form-data with a `file` field   → upload + persist + schedule background parse
 *   - application/json { type: "url", url }      → fetch + extract article (synchronous, fast)
 *   - application/json { type: "text", text }    → passthrough (synchronous, fast)
 *
 * For multipart/form-data:
 *   • PDF / DOCX files: parse runs in BACKGROUND. Response returns
 *     ingested_file_id immediately with `awaiting_parse: true` and
 *     empty `text`. Client polls /api/ingest/[id]/parse-status until
 *     status='ready' (or 'error').
 *   • text / markdown files: parsed synchronously inline (fast).
 *   • images: synchronous empty-text return (existing two-phase
 *     vision-extract pattern, unchanged).
 *
 * Returns normalized markdown ready for /api/analyze or /api/pipeline/scope
 * (when synchronous), or a pending row reference (when background).
 */
export async function POST(request: Request) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const contentType = request.headers.get("content-type") ?? "";

  // ── BACKGROUND PARSE PATH (multipart, PDF/DOCX) ──────────────────
  // Handled separately because the response shape diverges (no text in
  // body — client polls /parse-status). Other multipart MIMEs fall
  // through to the synchronous path below.
  if (contentType.includes("multipart/form-data")) {
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
    const filename = file.name || "uploaded-file";
    const formSpaceId = form.get("space_id");
    const spaceIdForPersist =
      typeof formSpaceId === "string" && formSpaceId ? formSpaceId : null;

    // Decide: background-parse or synchronous?
    //   PDF + DOCX  → background (slow, the original 504 source)
    //   text + md   → synchronous (fast, no LLM, just buffer.toString)
    //   image       → synchronous empty-text (existing vision two-phase)
    //   other       → blocked by validateFile already
    const isBackgroundParse =
      mime === "application/pdf" ||
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    if (isBackgroundParse) {
      // Persist the row in 'pending' state with no normalized_text yet.
      // The client polls /api/ingest/[id]/parse-status until ready.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = supabase as any;
      const { data: inserted, error: insertErr } = await db
        .from("ingested_files")
        .insert({
          user_id: user.id,
          space_id: spaceIdForPersist,
          source_type: "file",
          source_name: filename,
          mime_type: mime,
          source_url: null,
          // Empty until the worker writes the extracted text. Schema
          // allows NULL; ops queries can filter on parse_status to
          // know whether to expect content here.
          normalized_text: null,
          raw_chars: 0,
          normalized_chars: 0,
          extraction_method: "pending",
          // Provisional asset class from filename + mime. Worker
          // re-classifies with full content once parse completes.
          asset_class: inferAssetClass({
            sourceType: "file",
            mimeType: mime,
            sourceName: filename,
            contentSnippet: "",
          }),
          metadata: { original_bytes: buf.byteLength },
          parse_status: "pending",
        })
        .select("id, asset_class")
        .single();

      if (insertErr || !inserted) {
        console.error("[ingest] persist (pending) failed:", insertErr);
        return NextResponse.json(
          { error: "Could not persist upload row" },
          { status: 500 },
        );
      }

      const ingestedFileId = (inserted as { id: string; asset_class: AssetClass }).id;
      const initialAssetClass = (inserted as { id: string; asset_class: AssetClass }).asset_class;

      // Schedule background parse. The lambda stays alive until this
      // completes; the response below has already been sent so the
      // gateway sees <1s.
      after(async () => {
        try {
          await parseAssetInBackground(db, {
            ingestedFileId,
            buffer: buf,
            filename,
            mime,
          });
        } catch (err) {
          // Worker has its own try/catch but defend the lambda from a
          // throw escaping after().
          console.error("[ingest] background parse threw:", err);
        }
      });

      return NextResponse.json({
        text: "",
        source_name: filename,
        metadata: { original_bytes: buf.byteLength },
        ingested_file_id: ingestedFileId,
        asset_class: initialAssetClass,
        // Existing flag for image two-phase. Always false here — this
        // is the parse two-phase, not the vision two-phase.
        awaiting_vision: false,
        // NEW: tells the client this row's text isn't ready yet. Client
        // polls /api/ingest/[id]/parse-status until status='ready'.
        awaiting_parse: true,
        parse_status: "pending",
        notice:
          "Upload received. Parsing in background — we'll surface the extracted text when ready.",
      });
    }

    // ── Synchronous file paths (text, markdown, image) ─────────────
    let extraction:
      | { ok: true; result: ExtractResult }
      | { ok: false; error: { code: string; message: string } };
    let extractionMethod: string;
    // Public URL of the stored image binary (images only; null otherwise).
    let imageUrl: string | null = null;

    if (mime === "text/plain" || mime === "text/markdown") {
      extractionMethod = mime === "text/markdown" ? "markdown" : "text";
      extraction = extractText(
        buf.toString("utf-8"),
        filename,
        mime === "text/markdown" ? "markdown" : "text",
      );
    } else if (isSpreadsheetMime(mime)) {
      // CSV / XLSX / XLS → SheetJS, rendered as per-sheet markdown CSV.
      // Synchronous: no LLM, just an in-memory parse.
      extractionMethod = "spreadsheet";
      extraction = await extractSpreadsheet(buf, filename);
    } else if (isImageMime(mime)) {
      // Two-phase image ingest (2026-05-01): phase 1 returns
      // immediately with an empty result so the file-card lands on
      // canvas without a multi-second wait. The client follows up by
      // POSTing the same binary to /api/ingest/vision-extract which
      // populates image_description + extracted_entities + edges.
      extractionMethod = "image-pending-vision";
      extraction = {
        ok: true,
        result: {
          text: "",
          source_name: filename,
          metadata: {
            source_type: "image",
            original_bytes: buf.byteLength,
            image_mime: mime,
            ocr_confident: false,
          },
        },
      };
      // Store the binary so the analyzed image can re-display as a card on
      // the whiteboard later (the row otherwise keeps only text/metadata).
      imageUrl = await uploadImageToBucket(supabase, user.id, buf, mime);
    } else {
      // validateFile should have blocked this; defensive guard.
      return NextResponse.json({ error: `Unsupported MIME: ${mime}` }, { status: 400 });
    }

    return await persistAndRespond({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: supabase as any,
      userId: user.id,
      spaceIdForPersist,
      sourceType: "file",
      sourceUrl: null,
      mimeType: mime,
      extractionMethod,
      extraction,
      awaitingVision: extractionMethod === "image-pending-vision",
      imageUrl,
    });
  }

  // ── JSON path (URL / text) ─────────────────────────────────────────
  if (contentType.includes("application/json")) {
    let body: { type?: string; url?: string; text?: string; space_id?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const spaceIdForPersist =
      typeof body.space_id === "string" && body.space_id ? body.space_id : null;

    let sourceType: "url" | "text" = "url";
    let sourceUrl: string | null = null;
    let mimeType = "text/html";
    let extractionMethod = "url-fetch";
    let extraction:
      | { ok: true; result: ExtractResult }
      | { ok: false; error: { code: string; message: string } };

    if (body.type === "url") {
      if (!body.url || typeof body.url !== "string") {
        return NextResponse.json({ error: "URL missing." }, { status: 400 });
      }
      const check = validateUrl(body.url);
      if (!check.ok) {
        return NextResponse.json({ error: check.error.message, code: check.error.code }, { status: 400 });
      }
      sourceType = "url";
      sourceUrl = String(check.url);
      extraction = await extractUrl(check.url);
    } else if (body.type === "text") {
      if (typeof body.text !== "string" || !body.text.trim()) {
        return NextResponse.json({ error: "Text missing." }, { status: 400 });
      }
      sourceType = "text";
      sourceUrl = null;
      mimeType = "text/plain";
      extractionMethod = "paste";
      extraction = extractText(body.text, "pasted-text", "text");
    } else {
      return NextResponse.json(
        { error: `Unknown ingest type: ${body.type ?? "(missing)"}. Expected "url" or "text".` },
        { status: 400 },
      );
    }

    return await persistAndRespond({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: supabase as any,
      userId: user.id,
      spaceIdForPersist,
      sourceType,
      sourceUrl,
      mimeType,
      extractionMethod,
      extraction,
      awaitingVision: false,
    });
  }

  return NextResponse.json(
    {
      error:
        "Expected multipart/form-data (file upload) or application/json ({ type, url | text }).",
    },
    { status: 415 },
  );
}

// ── Synchronous-path persistence + response shaping ─────────────────
//
// Shared between the synchronous file paths (text/markdown/image) and
// the JSON paths (URL/text). The background-parse path doesn't go
// through here — it persists with parse_status='pending' before
// scheduling the worker.

async function persistAndRespond(opts: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  userId: string;
  spaceIdForPersist: string | null;
  sourceType: "file" | "url" | "text";
  sourceUrl: string | null;
  mimeType: string;
  extractionMethod: string;
  extraction:
    | { ok: true; result: ExtractResult }
    | { ok: false; error: { code: string; message: string } };
  awaitingVision: boolean;
  imageUrl?: string | null;
}) {
  const {
    db,
    userId,
    spaceIdForPersist,
    sourceType,
    sourceUrl,
    mimeType,
    extractionMethod,
    extraction,
    awaitingVision,
    imageUrl,
  } = opts;

  if (!extraction.ok) {
    return NextResponse.json(
      { error: extraction.error.message, code: extraction.error.code },
      { status: 422 },
    );
  }

  const { text: normalizedText, normalized, chunks } = await normalizeText(
    extraction.result.text,
  );

  const assetClass: AssetClass = inferAssetClass({
    sourceType,
    mimeType,
    sourceName: extraction.result.source_name,
    contentSnippet: normalizedText.slice(0, 500),
  });

  // Persist. Soft-fails — if storage hiccups we still return the text
  // so the caller can use it inline.
  let ingestedFileId: string | null = null;
  try {
    const { data: inserted, error: insertErr } = await db
      .from("ingested_files")
      .insert({
        user_id: userId,
        space_id: spaceIdForPersist,
        source_type: sourceType,
        source_name: extraction.result.source_name,
        mime_type: mimeType,
        source_url: sourceUrl,
        normalized_text: normalizedText,
        raw_chars: extraction.result.text.length,
        normalized_chars: normalizedText.length,
        extraction_method: extractionMethod,
        asset_class: assetClass,
        image_url: imageUrl ?? null,
        metadata: {
          ...extraction.result.metadata,
          normalize_chunks: chunks,
          normalized,
        },
        // Synchronous path: we already have the text. Mark ready
        // immediately so polling clients see consistent state.
        parse_status: "ready",
        parse_completed_at: new Date().toISOString(),
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
    ingested_file_id: ingestedFileId,
    asset_class: assetClass,
    awaiting_vision: awaitingVision,
    // Synchronous path is always ready by the time we respond.
    awaiting_parse: false,
    parse_status: "ready",
    notice:
      "Review the extracted text below. You can edit it before submitting for analysis.",
  });
}

// `inferMimeFromName` is now exported from validate.ts and used by validateFile.
// Kept here as a stable import anchor for future extensions.
void inferMimeFromName;

// ── Image binary → Storage ───────────────────────────────────────────
// Upload the image to the public `ingested-images` bucket under the user's
// folder (RLS = owner by path prefix), returning the public URL. Soft-fails
// to null so a storage hiccup never breaks ingest.
async function uploadImageToBucket(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  buf: Buffer,
  mime: string,
): Promise<string | null> {
  try {
    const ext = (mime.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("ingested-images")
      .upload(path, buf, { contentType: mime, upsert: false });
    if (error) {
      console.warn("[ingest] image storage upload failed (non-fatal):", error.message);
      return null;
    }
    const { data } = supabase.storage.from("ingested-images").getPublicUrl(path);
    return (data?.publicUrl as string | undefined) ?? null;
  } catch (err) {
    console.warn("[ingest] image storage upload threw (non-fatal):", err);
    return null;
  }
}
