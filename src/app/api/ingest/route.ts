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
  const { user, error: authError } = await safeAuth();
  if (authError) return authError;
  void user; // auth is enforced; user id not currently persisted with ingest

  const contentType = request.headers.get("content-type") ?? "";

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

    if (mime === "application/pdf") {
      extraction = await extractPdf(buf, file.name || "document.pdf");
    } else if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      extraction = await extractDocx(buf, file.name || "document.docx");
    } else if (isImageMime(mime)) {
      extraction = await extractImage(buf, file.name || "image", mime);
    } else if (mime === "text/plain" || mime === "text/markdown") {
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
    let body: { type?: string; url?: string; text?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    if (body.type === "url") {
      if (!body.url || typeof body.url !== "string") {
        return NextResponse.json({ error: "URL missing." }, { status: 400 });
      }
      const check = validateUrl(body.url);
      if (!check.ok) {
        return NextResponse.json({ error: check.error.message, code: check.error.code }, { status: 400 });
      }
      extraction = await extractUrl(check.url);
    } else if (body.type === "text") {
      if (typeof body.text !== "string" || !body.text.trim()) {
        return NextResponse.json({ error: "Text missing." }, { status: 400 });
      }
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
    // Small reminder to the client: text is editable before submit.
    notice:
      "Review the extracted text below. You can edit it before submitting for analysis.",
  });
}

// `inferMimeFromName` is now exported from validate.ts and used by validateFile.
// Kept here as a stable import anchor for future extensions.
void inferMimeFromName;
