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
    source_type: "pdf" | "url" | "text" | "docx" | "image" | "spreadsheet";
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
 * Extract text from a PDF buffer using unpdf.
 *
 * unpdf ships a serverless-optimized build of pdfjs that runs without
 * the browser globals (DOMMatrix / Path2D / ImageData) that the stock
 * pdfjs-dist build pulls in via native @napi-rs/canvas. That native
 * dependency only resolves for the host platform's prebuilt binary, so
 * on Vercel's Linux runtime stock pdfjs failed at parse time with
 * "DOMMatrix is not defined". unpdf has no such dependency, so the same
 * code path works locally (macOS) and on Vercel (Linux) alike.
 */
export async function extractPdf(
  buffer: Buffer,
  filename: string,
): Promise<{ ok: true; result: ExtractResult } | { ok: false; error: IngestError }> {
  try {
    // Dynamic import keeps unpdf out of the module-scope graph so it
    // never participates in the Next build's type/bundle step.
    const { getDocumentProxy, extractText } = await import("unpdf");

    // unpdf wants a fresh Uint8Array view over the buffer's bytes.
    const pdf = await getDocumentProxy(
      new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    );

    // Reject oversized PDFs before paying the full text-extraction cost.
    const numPages = pdf.numPages;
    if (numPages > MAX_PDF_PAGES) {
      return {
        ok: false,
        error: {
          code: "too_many_pages",
          message: `PDF has ${numPages} pages (max ${MAX_PDF_PAGES}).`,
        },
      };
    }

    const { text: rawText } = await extractText(pdf, { mergePages: true });

    const text = (rawText ?? "").trim();
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

// ── Spreadsheet (XLSX / XLS / CSV) ───────────────────────────────────

/**
 * Extract text from a spreadsheet using SheetJS (xlsx).
 *
 * Each sheet becomes a markdown section — a "## <sheet name>" heading
 * followed by its rows as CSV — so multi-sheet workbooks keep their
 * boundaries for downstream agents. Plain CSV files parse through the
 * same path (single unnamed sheet). Google Sheets imported via the Drive
 * picker arrive here as .xlsx, so this is the single spreadsheet path.
 */
export async function extractSpreadsheet(
  buffer: Buffer,
  filename: string,
): Promise<{ ok: true; result: ExtractResult } | { ok: false; error: IngestError }> {
  try {
    // Dynamic import keeps SheetJS off cold-start paths that never see spreadsheets.
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });

    const sheetNames = workbook.SheetNames ?? [];
    if (sheetNames.length === 0) {
      return { ok: false, error: { code: "empty_content", message: "Spreadsheet has no sheets." } };
    }

    const sections: string[] = [];
    for (const name of sheetNames) {
      const sheet = workbook.Sheets[name];
      if (!sheet) continue;
      // sheet_to_csv preserves row/column structure; blankrows:false trims empty rows.
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
      if (!csv) continue;
      sections.push(`## ${name}\n\n${csv}`);
    }

    const text = sections.join("\n\n").trim();
    if (!text) {
      return { ok: false, error: { code: "empty_content", message: "Spreadsheet has no readable cells." } };
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
          source_type: "spreadsheet",
          original_bytes: buffer.byteLength,
        },
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "extraction_failed",
        message: `Could not parse spreadsheet: ${err instanceof Error ? err.message : "unknown error"}`,
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

// ── Image: structured vision pass (two-phase ingest, 2026-05-01) ────
//
// Replacement for `extractImage()` on the phase-2 path. One Claude
// vision call returns FOUR pieces in one round-trip:
//   - ocr_text:        verbatim text in the image (markdown-preserving)
//   - description:     2-4 sentence description of what the image
//                      depicts ("Architecture diagram with three
//                      microservices and a shared Postgres")
//   - entities:        discrete things visible — used to bulk-create
//                      KG nodes via /api/canvas/materialize-from-image
//   - relationships:   visible arrows / spatial groupings — used to
//                      bulk-create KG edges between the entities
//
// Why one call instead of two: better visual reasoning when the model
// holds the whole image in context for both OCR and structured
// extraction; halves token + latency cost vs OCR-then-extract.
//
// Why Claude (not GPT-4o which the legacy `extractImage()` uses):
// significantly better at structured visual reasoning + relationship
// extraction in our internal benchmarks. Cost differential is dwarfed
// by the value of correct entity wiring downstream.

export interface ExtractedEntity {
  /** Display name — used as the join key for relationships AND as the
   *  KG entity name when materialized. */
  name: string;
  /** Free-form type ("service", "person", "metric"…) — the materialize
   *  step maps these to canonical LayerIds via best-effort heuristics. */
  type: string;
  /** One-sentence description used for KG entity body + tooltips. */
  description: string;
  /** Optional spatial hint ("center", "top-left", "step 3"). Carried
   *  for human readability; not used by the materializer. */
  rolePosition?: string;
}

export interface ExtractedRelationship {
  /** Must match an entity.name in the same extraction. Resolution is
   *  case-sensitive — the model is instructed to reuse exact names. */
  fromName: string;
  toName: string;
  /** Verb phrase ("calls", "feeds into", "blocks", "depends on"). */
  label: string;
  /** Optional: positive (reinforcing), negative (inhibiting), neutral.
   *  When omitted, materializer treats as neutral. */
  polarity?: "positive" | "negative" | "neutral";
}

/** Visual grammar pulled from a reference image — the moodboard lens.
 *  Distinct axis from entities (which says WHAT the image depicts): this
 *  says what it LOOKS LIKE. Aggregated across all an objective's image
 *  references to derive taste_profile.style_synthesis, which the
 *  prototype generator reads via taste-design-block. All fields optional
 *  + defensively defaulted at parse — a thin image just returns sparse
 *  arrays / unknowns rather than nulling the whole record. */
export interface StyleAnalysis {
  palette: {
    /** 2-4 dominant hex codes ordered most-prominent first. */
    dominant: string[];
    /** Accent / call-out hex codes, ≤2. */
    accent: string[];
    temperature: "warm" | "neutral" | "cool" | "unknown";
    contrast: "low" | "medium" | "high" | "unknown";
  };
  typography: {
    weight_range: "light" | "regular" | "bold" | "heavy" | "mixed" | "unknown";
    scale_contrast: "subtle" | "expressive" | "unknown";
    voice:
      | "humanist"
      | "geometric"
      | "monospaced"
      | "serif"
      | "mixed"
      | "unknown";
  };
  composition: {
    density: "sparse" | "balanced" | "dense" | "unknown";
    grid: "rigid" | "loose" | "asymmetric" | "unknown";
    hierarchy: "flat" | "two-tier" | "deep" | "unknown";
  };
  /** Named UI patterns the image embodies — "sidebar+main", "hero+cta",
   *  "card-grid", "conversational", "full-bleed-canvas", "dashboard-feed",
   *  etc. Free-form so the model can name patterns the enum misses. ≤6. */
  patterns: string[];
  /** Implied motion words — "fade-in", "scale-pop", "parallax", "spring".
   *  Empty when the image is static / has no motion cues. ≤4. */
  motion_cues: string[];
}

export interface StructuredImageExtraction {
  ocr_text: string;
  description: string;
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  /** Visual grammar — palette / typography / composition / patterns /
   *  motion. Optional on the wire so legacy responses still parse; the
   *  parser fills sparse defaults when missing. */
  style_analysis?: StyleAnalysis;
}

const EMPTY_STYLE_ANALYSIS: StyleAnalysis = {
  palette: {
    dominant: [],
    accent: [],
    temperature: "unknown",
    contrast: "unknown",
  },
  typography: {
    weight_range: "unknown",
    scale_contrast: "unknown",
    voice: "unknown",
  },
  composition: {
    density: "unknown",
    grid: "unknown",
    hierarchy: "unknown",
  },
  patterns: [],
  motion_cues: [],
};

const STRUCTURED_IMAGE_SYSTEM = `You are reading an image dropped onto a knowledge canvas. You wear two hats at once:
  1. KG analyst — pulling discrete entities + relationships out of the image's content
  2. UX designer cataloguing a moodboard — recording the image's VISUAL GRAMMAR (palette, typography, composition, patterns, motion) so future generated UI can imitate this taste

Return STRICT JSON in this shape (no prose before or after, no code fences):

{
  "ocr_text": string,
  "description": string,
  "entities": [{ "name": string, "type": string, "description": string, "rolePosition"?: string }],
  "relationships": [{ "fromName": string, "toName": string, "label": string, "polarity"?: "positive" | "negative" | "neutral" }],
  "style_analysis": {
    "palette": {
      "dominant": [string],
      "accent": [string],
      "temperature": "warm" | "neutral" | "cool" | "unknown",
      "contrast": "low" | "medium" | "high" | "unknown"
    },
    "typography": {
      "weight_range": "light" | "regular" | "bold" | "heavy" | "mixed" | "unknown",
      "scale_contrast": "subtle" | "expressive" | "unknown",
      "voice": "humanist" | "geometric" | "monospaced" | "serif" | "mixed" | "unknown"
    },
    "composition": {
      "density": "sparse" | "balanced" | "dense" | "unknown",
      "grid": "rigid" | "loose" | "asymmetric" | "unknown",
      "hierarchy": "flat" | "two-tier" | "deep" | "unknown"
    },
    "patterns": [string],
    "motion_cues": [string]
  }
}

RULES — KG SIDE:
- ocr_text: any visible text, transcribed verbatim with markdown structure preserved (headings, lists, tables). Empty string if no readable text.
- description: 2-4 sentences naming what the image depicts. Be specific about the kind of artifact (diagram, screenshot, photo, sketch) and what's in it. Avoid generic phrases like "an image showing".
- entities: one entry per discrete thing visible — services, people, metrics, components, steps, concepts, locations, datasets. Skip purely decorative elements. Use the image's own terminology for names; if a thing is unlabeled, give it a short specific name based on what it depicts. Cap at 12 entities — pick the most meaningful.
- relationships: one entry per visible arrow, line, or spatial grouping that implies a connection. fromName/toName MUST exactly match names in the entities array (case-sensitive). polarity is optional; only include when the visual makes the sign obvious (e.g., a red X, a blocking icon, a "+" symbol).

RULES — STYLE LENS SIDE:
- palette.dominant: 2-4 hex codes for the colors that read FIRST. Order by prominence. Lowercase "#rrggbb". If the image is a black-and-white sketch, return ["#000000","#ffffff"] and accent: [].
- palette.accent: ≤2 hex codes for the colors that mark CTAs, badges, or focus points (not the background). Empty array if no clear accent.
- palette.temperature: lean WARM if oranges/reds/yellows dominate, COOL if blues/greens/violets, NEUTRAL if grays/beiges. Use "unknown" only when the image has no color information.
- palette.contrast: HIGH if foreground/background have strong tonal separation (think Linear, Stripe); LOW if subtle pastels or grayscale gradients; MEDIUM for typical balanced UI.
- typography.weight_range: dominant text weight. "mixed" only when both light AND bold are clearly used for hierarchy. "unknown" when no text is visible.
- typography.scale_contrast: SUBTLE = headings are slightly larger than body. EXPRESSIVE = huge displays next to tiny body. "unknown" for no text.
- typography.voice: HUMANIST = warm, calligraphic (Inter, Söhne, body-feeling sans). GEOMETRIC = mechanical, even (Futura, Manrope). MONOSPACED = code-like. SERIF = traditional. MIXED only if two voices are used together. "unknown" for no text.
- composition.density: SPARSE = lots of negative space and few elements per screen. DENSE = packed grid, every cell used. BALANCED = the middle.
- composition.grid: RIGID = strict alignment to a column grid. LOOSE = roughly aligned but breathing. ASYMMETRIC = intentional offsets, broken alignment.
- composition.hierarchy: FLAT = no visual primacy among elements. TWO-TIER = one clear hero + supporting equals. DEEP = multiple nested hierarchies.
- patterns: ≤6 named UI patterns the image embodies — choose from: "sidebar+main", "hero+cta", "card-grid", "feed", "split-pane", "dashboard", "conversational", "full-bleed-canvas", "modal-form", "wizard", "settings-tabs", "kanban", "timeline", "data-table", "command-palette", or coin a 1-3 word name if none fit. Empty array for non-UI imagery (photos, abstract art).
- motion_cues: ≤4 implied motion words — "fade-in", "scale-pop", "parallax", "spring", "slide", "stagger". Empty for static stills with no animation hints.
- If the image is purely decorative or has no inferable style (e.g. a blank canvas, a single icon), all style_analysis enums may be "unknown" and arrays empty — but still emit the field.

ALWAYS emit "style_analysis" — never omit. If unsure on an axis, use "unknown" / [].

If the image carries no semantic content (pure decoration, abstract art with no labels), return entities: [] and relationships: [] but still produce a description AND a style_analysis.

Return ONLY the JSON object.`;

export async function extractImageWithStructure(
  buffer: Buffer,
  filename: string,
  mime: string,
): Promise<
  | { ok: true; result: ExtractResult; structured: StructuredImageExtraction; model: string }
  | { ok: false; error: IngestError }
> {
  // Anthropic supports png/jpeg/gif/webp — gate other types here so
  // we don't waste a round trip on a 415-shaped failure later.
  const allowedMime = (
    ["image/png", "image/jpeg", "image/gif", "image/webp"] as const
  ).find((m) => m === mime);
  if (!allowedMime) {
    return {
      ok: false,
      error: {
        code: "extraction_failed",
        message: `Image MIME ${mime} is not supported by the structured vision pass (use png/jpeg/gif/webp).`,
      },
    };
  }

  try {
    // Lazy import keeps the cold-start cost off paths that never see images.
    const { llmGenerate, MODEL_DEFAULTS } = await import("../llm");
    const model = MODEL_DEFAULTS.anthropic.fast; // Sonnet — Opus is overkill for vision OCR
    const raw = await llmGenerate({
      system: STRUCTURED_IMAGE_SYSTEM,
      user: "Analyze this image and return the JSON described in the system prompt.",
      provider: "anthropic",
      model,
      // A dense diagram (up to 12 entities + relationships + full OCR text) can
      // approach ~4k tokens; at 4096 a busy image truncated trailing entities.
      // This path uses llmGenerate + lenient parse, so truncation drops items
      // rather than nulling — but give headroom so dense images extract fully.
      maxTokens: 6144,
      temperature: 0.2,
      images: [
        { base64: buffer.toString("base64"), mediaType: allowedMime },
      ],
    });

    const parsed = parseStructuredImageJson(raw);
    if (!parsed) {
      return {
        ok: false,
        error: {
          code: "extraction_failed",
          message: "Vision response was not valid JSON. Image may be too complex; try Re-analyze.",
        },
      };
    }

    // Carry the OCR text through the existing ExtractResult shape so
    // downstream code (normalizer, asset_class inferrer) keeps working.
    // Empty OCR is fine — the row will still have description + entities.
    const text = parsed.ocr_text || parsed.description || "";
    return {
      ok: true,
      result: {
        text,
        source_name: filename,
        metadata: {
          source_type: "image",
          original_bytes: buffer.byteLength,
          image_mime: mime,
          // The structured pass is "confident" by definition — it's
          // not pattern-matching on a SCENE: prefix like the legacy
          // GPT-4o OCR path. Default to true; downstream consumers
          // can lower priority via empty extracted_entities[] if the
          // image is purely decorative.
          ocr_confident: true,
        },
      },
      structured: parsed,
      model,
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "extraction_failed",
        message: `Vision extraction failed: ${err instanceof Error ? err.message : "unknown error"}`,
      },
    };
  }
}

function parseStructuredImageJson(raw: string): StructuredImageExtraction | null {
  // Models occasionally wrap JSON in ```json fences or pad with prose.
  // Strip both before parsing. Same logic the lasso-summarize endpoint
  // uses — extracted to a shared helper if a third call site appears.
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  const open = cleaned.indexOf("{");
  const close = cleaned.lastIndexOf("}");
  if (open >= 0 && close > open) cleaned = cleaned.slice(open, close + 1);
  try {
    const obj = JSON.parse(cleaned) as Partial<StructuredImageExtraction>;
    if (typeof obj !== "object" || obj == null) return null;
    const ocr_text = typeof obj.ocr_text === "string" ? obj.ocr_text : "";
    const description = typeof obj.description === "string" ? obj.description : "";
    const entities = Array.isArray(obj.entities)
      ? obj.entities
          .filter((e): e is ExtractedEntity =>
            !!e &&
            typeof e === "object" &&
            typeof (e as ExtractedEntity).name === "string" &&
            (e as ExtractedEntity).name.length > 0,
          )
          .slice(0, 24) // hard cap — defends against runaway model output
          .map((e) => ({
            name: e.name.slice(0, 120),
            type: typeof e.type === "string" ? e.type.slice(0, 60) : "concept",
            description:
              typeof e.description === "string" ? e.description.slice(0, 400) : "",
            rolePosition:
              typeof e.rolePosition === "string"
                ? e.rolePosition.slice(0, 60)
                : undefined,
          }))
      : [];
    const entityNames = new Set(entities.map((e) => e.name));
    const relationships = Array.isArray(obj.relationships)
      ? obj.relationships
          .filter((r): r is ExtractedRelationship =>
            !!r &&
            typeof r === "object" &&
            typeof (r as ExtractedRelationship).fromName === "string" &&
            typeof (r as ExtractedRelationship).toName === "string" &&
            entityNames.has((r as ExtractedRelationship).fromName) &&
            entityNames.has((r as ExtractedRelationship).toName),
          )
          .slice(0, 48)
          .map((r) => ({
            fromName: r.fromName,
            toName: r.toName,
            label:
              typeof r.label === "string" && r.label.length > 0
                ? r.label.slice(0, 80)
                : "related to",
            polarity:
              r.polarity === "positive" || r.polarity === "negative" || r.polarity === "neutral"
                ? r.polarity
                : undefined,
          }))
      : [];
    if (!description && entities.length === 0 && !ocr_text) return null;
    const style_analysis = parseStyleAnalysis(obj.style_analysis);
    return { ocr_text, description, entities, relationships, style_analysis };
  } catch {
    return null;
  }
}

// ── Style-lens parsing helpers ──────────────────────────────────────
//
// Defensive — any field omitted, mistyped, or out-of-enum collapses to
// "unknown" / [] so the row still lands. Hex codes are normalized to
// lowercase + #rrggbb (so the K-means aggregator in taste_profile can
// compare them); anything that doesn't look like a hex is dropped.

const HEX_RE = /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;
function normalizeHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!HEX_RE.test(s)) return null;
  const cleaned = s.startsWith("#") ? s.slice(1) : s;
  // Expand short form #abc → #aabbcc so downstream comparisons are stable.
  if (cleaned.length === 3) {
    return `#${cleaned
      .split("")
      .map((c) => c + c)
      .join("")
      .toLowerCase()}`;
  }
  return `#${cleaned.toLowerCase()}`;
}

function pickEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

function pickStringArray(raw: unknown, cap: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim().slice(0, 60))
    .slice(0, cap);
}

function parseStyleAnalysis(raw: unknown): StyleAnalysis {
  if (!raw || typeof raw !== "object") return EMPTY_STYLE_ANALYSIS;
  const o = raw as Record<string, unknown>;

  const palette = ((): StyleAnalysis["palette"] => {
    const p = (o.palette ?? {}) as Record<string, unknown>;
    const dominant = (Array.isArray(p.dominant) ? p.dominant : [])
      .map(normalizeHex)
      .filter((h): h is string => h !== null)
      .slice(0, 4);
    const accent = (Array.isArray(p.accent) ? p.accent : [])
      .map(normalizeHex)
      .filter((h): h is string => h !== null)
      .slice(0, 2);
    return {
      dominant,
      accent,
      temperature: pickEnum(
        p.temperature,
        ["warm", "neutral", "cool", "unknown"] as const,
        "unknown",
      ),
      contrast: pickEnum(
        p.contrast,
        ["low", "medium", "high", "unknown"] as const,
        "unknown",
      ),
    };
  })();

  const typography = ((): StyleAnalysis["typography"] => {
    const t = (o.typography ?? {}) as Record<string, unknown>;
    return {
      weight_range: pickEnum(
        t.weight_range,
        ["light", "regular", "bold", "heavy", "mixed", "unknown"] as const,
        "unknown",
      ),
      scale_contrast: pickEnum(
        t.scale_contrast,
        ["subtle", "expressive", "unknown"] as const,
        "unknown",
      ),
      voice: pickEnum(
        t.voice,
        [
          "humanist",
          "geometric",
          "monospaced",
          "serif",
          "mixed",
          "unknown",
        ] as const,
        "unknown",
      ),
    };
  })();

  const composition = ((): StyleAnalysis["composition"] => {
    const c = (o.composition ?? {}) as Record<string, unknown>;
    return {
      density: pickEnum(
        c.density,
        ["sparse", "balanced", "dense", "unknown"] as const,
        "unknown",
      ),
      grid: pickEnum(
        c.grid,
        ["rigid", "loose", "asymmetric", "unknown"] as const,
        "unknown",
      ),
      hierarchy: pickEnum(
        c.hierarchy,
        ["flat", "two-tier", "deep", "unknown"] as const,
        "unknown",
      ),
    };
  })();

  return {
    palette,
    typography,
    composition,
    patterns: pickStringArray(o.patterns, 6),
    motion_cues: pickStringArray(o.motion_cues, 4),
  };
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
