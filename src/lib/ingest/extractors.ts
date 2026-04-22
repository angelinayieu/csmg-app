/**
 * Text extractors for the ingest layer.
 *
 * Each extractor wraps a third-party library, enforces a timeout/size
 * guard, and returns a consistent `ExtractResult` shape. Downstream
 * (ingest route → normalizer) doesn't need to care which path produced
 * the text.
 */

import { URL_FETCH_TIMEOUT_MS, MAX_EXTRACTED_CHARS, MAX_PDF_PAGES, type IngestError } from "./validate";

export interface ExtractResult {
  text: string;
  /** Human-readable source label — filename, article title, URL host. */
  source_name: string;
  metadata: {
    source_type: "pdf" | "url" | "text" | "docx" | "image";
    original_bytes?: number;
    num_pages?: number;
    url?: string;
    site_name?: string;
    /** Only present for images: the MIME that was OCR'd. */
    image_mime?: string;
    /** Only present for images: did OpenAI say this looked like a scan/document? */
    ocr_confident?: boolean;
  };
}

// ── PDF ──────────────────────────────────────────────────────────────

/**
 * Extract text from a PDF buffer using pdf-parse.
 *
 * pdf-parse is a sync-ish Node library — we rely on it catching its own
 * errors rather than racing a timeout. For pathological PDFs the Next.js
 * route's maxDuration provides the outer safety net.
 */
export async function extractPdf(
  buffer: Buffer,
  filename: string,
): Promise<{ ok: true; result: ExtractResult } | { ok: false; error: IngestError }> {
  try {
    // Dynamic import — pdf-parse's worker setup can interfere with
    // Next's build step if imported at module scope.
    const { PDFParse } = await import("pdf-parse");

    // pdf-parse v2 expects Uint8Array; it handles Buffer → Uint8Array
    // conversion internally, but we do it explicitly for type clarity.
    const parser = new PDFParse({
      data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    });

    // Pull metadata first so we can reject oversized PDFs without
    // paying the full text-extraction cost.
    const info = await parser.getInfo();
    const numPages = info.total ?? 0;

    if (numPages > MAX_PDF_PAGES) {
      await parser.destroy();
      return {
        ok: false,
        error: {
          code: "too_many_pages",
          message: `PDF has ${numPages} pages (max ${MAX_PDF_PAGES}).`,
        },
      };
    }

    const textResult = await parser.getText();
    await parser.destroy();

    const text = (textResult.text ?? "").trim();
    if (!text) {
      return {
        ok: false,
        error: {
          code: "empty_content",
          message:
            "No text extracted. This PDF may be scanned or image-based — image OCR support is coming soon.",
        },
      };
    }

    if (text.length > MAX_EXTRACTED_CHARS) {
      return {
        ok: false,
        error: {
          code: "content_too_large",
          message: `Extracted text is ${text.length.toLocaleString()} chars (max ${MAX_EXTRACTED_CHARS.toLocaleString()}).`,
        },
      };
    }

    return {
      ok: true,
      result: {
        text,
        source_name: filename,
        metadata: {
          source_type: "pdf",
          original_bytes: buffer.byteLength,
          num_pages: numPages,
        },
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "extraction_failed",
        message: `Could not parse PDF: ${err instanceof Error ? err.message : "unknown error"}`,
      },
    };
  }
}

// ── DOCX ─────────────────────────────────────────────────────────────

/**
 * Extract text from a .docx file using mammoth.
 *
 * mammoth.convertToMarkdown preserves headings, lists, and emphasis —
 * much better for our downstream agents than flat text. Tables become
 * pipe-delimited markdown, which Scope Mapper can reason over.
 */
export async function extractDocx(
  buffer: Buffer,
  filename: string,
): Promise<{ ok: true; result: ExtractResult } | { ok: false; error: IngestError }> {
  try {
    const mammoth = await import("mammoth");
    // convertToMarkdown is richer than extractRawText; falls back cleanly on unsupported styles.
    // It exists at runtime (see node_modules/mammoth/lib/index.js) but is missing from
    // the shipped .d.ts — cast the module to a typed shim locally.
    type MammothWithMarkdown = typeof mammoth & {
      convertToMarkdown: (input: { buffer: Buffer }) => Promise<{ value: string; messages: unknown[] }>;
    };
    const result = await (mammoth as unknown as MammothWithMarkdown).convertToMarkdown({ buffer });

    const text = (result.value ?? "").trim();
    if (!text) {
      return {
        ok: false,
        error: {
          code: "empty_content",
          message: "No text extracted from DOCX. The file may be empty or consist entirely of images.",
        },
      };
    }

    if (text.length > MAX_EXTRACTED_CHARS) {
      return {
        ok: false,
        error: {
          code: "content_too_large",
          message: `Extracted text is ${text.length.toLocaleString()} chars (max ${MAX_EXTRACTED_CHARS.toLocaleString()}).`,
        },
      };
    }

    return {
      ok: true,
      result: {
        text,
        source_name: filename,
        metadata: {
          source_type: "docx",
          original_bytes: buffer.byteLength,
        },
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "extraction_failed",
        message: `Could not parse DOCX: ${err instanceof Error ? err.message : "unknown error"}`,
      },
    };
  }
}

// ── Image OCR (OpenAI Vision) ────────────────────────────────────────

/**
 * Extract text from an image using OpenAI Vision (gpt-4o).
 *
 * Works well on: screenshots, whiteboard photos, scanned pages, slides.
 * Less well on: low-contrast handwriting, rotated pages, very small text.
 *
 * The prompt asks the model to transcribe verbatim AND preserve structure
 * — headings, lists, tables become markdown. If the image contains little
 * or no readable text, we report that rather than returning hallucinated
 * text.
 */
export async function extractImage(
  buffer: Buffer,
  filename: string,
  mime: string,
): Promise<{ ok: true; result: ExtractResult } | { ok: false; error: IngestError }> {
  try {
    // Dynamic import to avoid loading the OpenAI SDK on paths that don't need it.
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;

    const response = await client.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.1,
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content: `You are a document transcription assistant. Transcribe the text content of the image the user provides, verbatim.

RULES:
- Preserve structure: headings become markdown headings (# ##), bullet lists stay as lists, tables become pipe-delimited markdown.
- Preserve the reading order. For multi-column layouts, read columns top-to-bottom, left-to-right.
- Do NOT summarize, translate, or paraphrase. Transcribe what is there.
- Do NOT add commentary, preamble, or explanation.
- If the image contains no readable text, or only decorative graphics, respond with exactly: NO_TEXT_FOUND
- If the image is a photograph of a real-world scene (not a document/whiteboard/screen), briefly describe what is shown in 1-2 sentences prefixed with "SCENE: ".`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe this image." },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        },
      ],
    });

    const raw = (response.choices[0]?.message?.content ?? "").trim();

    if (!raw || raw === "NO_TEXT_FOUND") {
      return {
        ok: false,
        error: {
          code: "empty_content",
          message: "No readable text found in this image.",
        },
      };
    }

    const isScene = raw.startsWith("SCENE:");
    const text = raw;

    return {
      ok: true,
      result: {
        text,
        source_name: filename,
        metadata: {
          source_type: "image",
          original_bytes: buffer.byteLength,
          image_mime: mime,
          ocr_confident: !isScene,
        },
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "extraction_failed",
        message: `Could not OCR image: ${err instanceof Error ? err.message : "unknown error"}`,
      },
    };
  }
}

// ── Plain text / markdown ────────────────────────────────────────────

export function extractText(
  raw: string,
  filename: string,
  kind: "text" | "markdown",
): { ok: true; result: ExtractResult } | { ok: false; error: IngestError } {
  const text = raw.trim();
  if (!text) {
    return { ok: false, error: { code: "empty_content", message: "File is empty." } };
  }
  if (text.length > MAX_EXTRACTED_CHARS) {
    return {
      ok: false,
      error: {
        code: "content_too_large",
        message: `File is ${text.length.toLocaleString()} chars (max ${MAX_EXTRACTED_CHARS.toLocaleString()}).`,
      },
    };
  }
  return {
    ok: true,
    result: {
      text,
      source_name: filename,
      metadata: {
        source_type: "text",
        original_bytes: Buffer.byteLength(raw),
      },
    },
  };
  void kind; // reserved for future format-specific handling
}

// ── URL ──────────────────────────────────────────────────────────────

/**
 * Fetch a URL and extract the main article content.
 *
 * Uses Mozilla Readability (the Firefox Reader View algorithm) so we
 * get just the article body, not the nav + ads + footer + newsletter
 * signup. Works well on article-shaped content sites; less well on
 * apps, SPAs, or paywalled pages.
 */
export async function extractUrl(
  url: URL,
): Promise<{ ok: true; result: ExtractResult } | { ok: false; error: IngestError }> {
  // Fetch with timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT_MS);

  let html: string;
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // Identify politely. Some sites block bare fetch() or default user-agents.
        "User-Agent":
          "Mozilla/5.0 (compatible; InteraxisIngest/1.0; +https://interaxis.app)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timer);

    if (!res.ok) {
      return {
        ok: false,
        error: {
          code: "fetch_failed",
          message: `URL returned HTTP ${res.status}.`,
        },
      };
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("text")) {
      return {
        ok: false,
        error: {
          code: "unsupported_type",
          message: `URL content-type is ${contentType || "unknown"} — expected HTML.`,
        },
      };
    }

    html = await res.text();
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === "AbortError") {
      return {
        ok: false,
        error: {
          code: "fetch_failed",
          message: `URL fetch timed out after ${URL_FETCH_TIMEOUT_MS / 1000}s.`,
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "fetch_failed",
        message: `Could not fetch URL: ${err instanceof Error ? err.message : "unknown error"}`,
      },
    };
  }

  // Parse + run Readability
  try {
    const { JSDOM } = await import("jsdom");
    const { Readability } = await import("@mozilla/readability");

    const dom = new JSDOM(html, { url: url.toString() });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article?.textContent || article.textContent.trim().length < 100) {
      return {
        ok: false,
        error: {
          code: "empty_content",
          message:
            "Could not extract meaningful article content. The page may be a JavaScript app or paywalled.",
        },
      };
    }

    const text = article.textContent.trim();
    if (text.length > MAX_EXTRACTED_CHARS) {
      return {
        ok: false,
        error: {
          code: "content_too_large",
          message: `Extracted text is ${text.length.toLocaleString()} chars (max ${MAX_EXTRACTED_CHARS.toLocaleString()}).`,
        },
      };
    }

    return {
      ok: true,
      result: {
        text,
        source_name: article.title?.trim() || url.hostname,
        metadata: {
          source_type: "url",
          url: url.toString(),
          site_name: article.siteName ?? url.hostname,
        },
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "extraction_failed",
        message: `Could not extract article content: ${err instanceof Error ? err.message : "unknown error"}`,
      },
    };
  }
}
