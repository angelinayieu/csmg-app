// Background parse worker for two-phase ingest (Phase 1, 2026-07-04).
//
// Invoked from /api/ingest via Next 16 `after()` after the upload row
// has been persisted with parse_status='pending'. Runs the appropriate
// extractor for the file's MIME, normalizes the text, re-classifies
// asset_class with the full content, and updates the row to
// parse_status='ready' | 'error'.
//
// The route's response has already been sent by the time this fires —
// the lambda stays alive long enough for after() callbacks to complete,
// so the client can poll /api/ingest/[assetId]/parse-status without
// the user-facing request blocking on pdf-parse.
//
// Soft-fails throughout: any unexpected exception is caught and written
// to parse_error so the client polling sees a clean error message
// instead of an indefinite 'parsing' state.

import {
  extractPdf,
  extractDocx,
  extractText,
  type ExtractResult,
} from "./extractors";
import { normalizeText } from "./normalizer";
import { isImageMime } from "./validate";
import { inferAssetClass, type AssetClass } from "@/types/asset";

export interface ParseWorkerInput {
  ingestedFileId: string;
  buffer: Buffer;
  filename: string;
  mime: string;
}

/**
 * Run the parse for one ingested_files row, mutating it through the
 * parse_status lifecycle (pending → parsing → ready | error).
 *
 * `db` is a thin Supabase client — we accept the loose `any` shape
 * here because this is called from the route handler with a
 * `safeAuth()` client and from background contexts where we don't want
 * to re-import the supabase types.
 */
export async function parseAssetInBackground(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: ParseWorkerInput,
): Promise<void> {
  const { ingestedFileId, buffer, filename, mime } = input;

  // ── Mark as parsing ────────────────────────────────────────────────
  // Idempotent — if a retry fires concurrently the second one writes
  // the same value. The CHECK constraint blocks invalid statuses.
  try {
    await db
      .from("ingested_files")
      .update({
        parse_status: "parsing",
        parse_started_at: new Date().toISOString(),
      })
      .eq("id", ingestedFileId);
  } catch (err) {
    // If we can't even mark the row as parsing, downstream writes will
    // also fail. Log and bail — the row stays 'pending' forever, which
    // surfaces in ops queries.
    console.warn("[parse-worker] mark-parsing failed:", err);
    return;
  }

  // ── Run the extractor that matches the MIME ────────────────────────
  let extraction: { ok: true; result: ExtractResult } | { ok: false; error: { code: string; message: string } };
  let extractionMethod: string;

  try {
    if (mime === "application/pdf") {
      extractionMethod = "unpdf";
      extraction = await extractPdf(buffer, filename);
    } else if (
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      extractionMethod = "docx";
      extraction = await extractDocx(buffer, filename);
    } else if (mime === "text/plain" || mime === "text/markdown") {
      // Text/markdown extraction is fast; we run it here too so all
      // file-typed paths converge on the same lifecycle. The route can
      // optionally short-circuit text/markdown synchronously and skip
      // the worker — that's a micro-optimization, not a correctness
      // issue.
      extractionMethod = mime === "text/markdown" ? "markdown" : "text";
      extraction = extractText(
        buffer.toString("utf-8"),
        filename,
        mime === "text/markdown" ? "markdown" : "text",
      );
    } else if (isImageMime(mime)) {
      // Images use a separate two-phase pattern (vision-extract). We
      // shouldn't reach here for images — the route returns synchronously
      // with empty text for them. If we do, treat it as a no-op so the
      // row resolves to 'ready' with empty text.
      extractionMethod = "image-pending-vision";
      extraction = {
        ok: true,
        result: {
          text: "",
          source_name: filename,
          metadata: {
            source_type: "image",
            image_mime: mime,
            ocr_confident: false,
          },
        },
      };
    } else {
      // Validation should have blocked this upstream; defensive guard.
      await markError(
        db,
        ingestedFileId,
        `Unsupported MIME for background parse: ${mime}`,
      );
      return;
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Extractor threw unexpectedly";
    await markError(db, ingestedFileId, message);
    return;
  }

  // Extractor returned {ok:false} — surface the validated error.
  if (!extraction.ok) {
    await markError(db, ingestedFileId, extraction.error.message, extraction.error.code);
    return;
  }

  // ── Normalize the extracted text ───────────────────────────────────
  let normalizedText: string;
  let normalized: unknown;
  let chunks: unknown;
  try {
    const out = await normalizeText(extraction.result.text);
    normalizedText = out.text;
    normalized = out.normalized;
    chunks = out.chunks;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Normalize failed";
    await markError(db, ingestedFileId, message);
    return;
  }

  // ── Re-classify asset_class with the full text ────────────────────
  // The route's pre-classification only had the filename + first 500
  // chars of unbounded text. Now that we have the full normalized
  // text, run the classifier again — it might upgrade "internal_doc"
  // to "research_pdf" once it sees actual paper structure.
  const assetClass: AssetClass = inferAssetClass({
    sourceType: "file",
    mimeType: mime,
    sourceName: extraction.result.source_name,
    contentSnippet: normalizedText.slice(0, 500),
  });

  // ── Persist final state ───────────────────────────────────────────
  try {
    await db
      .from("ingested_files")
      .update({
        normalized_text: normalizedText,
        raw_chars: extraction.result.text.length,
        normalized_chars: normalizedText.length,
        extraction_method: extractionMethod,
        asset_class: assetClass,
        metadata: {
          ...extraction.result.metadata,
          normalize_chunks: chunks,
          normalized,
        },
        parse_status: "ready",
        parse_completed_at: new Date().toISOString(),
        parse_error: null,
      })
      .eq("id", ingestedFileId);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Final persist failed";
    await markError(db, ingestedFileId, message);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function markError(db: any, ingestedFileId: string, message: string, code?: string) {
  try {
    await db
      .from("ingested_files")
      .update({
        parse_status: "error",
        parse_error: code ? `${code}: ${message}`.slice(0, 800) : message.slice(0, 800),
        parse_completed_at: new Date().toISOString(),
      })
      .eq("id", ingestedFileId);
  } catch (err) {
    // If even the error write fails, log and exit — the row stays in
    // 'parsing' which an ops query for stuck rows will find.
    console.error("[parse-worker] mark-error failed:", err);
  }
}
