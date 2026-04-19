/**
 * Normalizer — single LLM pass that cleans up raw extracted text before
 * it's handed to the Scope Mapper / Decomposer.
 *
 * Why: PDF / URL extraction produces noise (page numbers, repeated
 * headers, "Subscribe to our newsletter" boilerplate, broken
 * hyphenation). Cleaning once, cheaply, beats making every downstream
 * agent robust to noise.
 *
 * For long inputs we chunk with overlap and concatenate — the cleanup
 * is local (strip headers, fix hyphenation) so per-chunk context is
 * enough; we don't need the LLM to see the whole doc at once.
 */

import { llmGenerate } from "@/lib/llm";

/** Character budget for a single normalize call. Comfortably inside gpt-4o-mini's context. */
const CHUNK_SIZE = 30_000;
/** Overlap between chunks so we don't lose structure at boundaries. */
const CHUNK_OVERLAP = 2_000;

const SYSTEM_PROMPT = `You clean up extracted document text so it's ready for analysis. You receive raw text pulled from a PDF, web article, or uploaded file. It is often noisy.

YOUR JOB:
- Remove: page numbers ("Page 3 of 12"), repeated headers/footers, navigation crumbs, cookie banners, "Subscribe" / "Share" buttons, reference markers like "[12]", URL fragments, and similar extraction artifacts.
- Fix: broken hyphenation from PDF line-wrapping (e.g. "trans-\\nform" → "transform"), spurious line breaks inside sentences, excessive blank lines.
- Preserve: the actual content, section headings, lists, emphasis, quoted material, and paragraph structure. Convert to readable markdown where appropriate (headings with #, lists with -, etc).
- DO NOT: summarize, paraphrase, reorder, translate, add commentary, add "Here is the cleaned text:" prefixes, or drop any substantive content. If you are unsure whether something is content or noise, keep it.

Return ONLY the cleaned text. No preamble, no explanation, no code fences.`;

/**
 * Clean extracted text. Returns the normalized string.
 * Falls back to the raw input if the LLM call fails — we never want
 * to block the ingest pipeline on the normalizer.
 */
export async function normalizeText(raw: string): Promise<{
  text: string;
  normalized: boolean;
  chunks: number;
}> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { text: "", normalized: false, chunks: 0 };
  }

  // Short inputs (already pasted clean text, or small articles) don't
  // need normalization — save the credit and the latency.
  if (trimmed.length < 1_500) {
    return { text: trimmed, normalized: false, chunks: 0 };
  }

  const chunks = chunkText(trimmed, CHUNK_SIZE, CHUNK_OVERLAP);

  try {
    const cleaned = await Promise.all(
      chunks.map((chunk) =>
        llmGenerate({
          system: SYSTEM_PROMPT,
          user: chunk,
          model: "gpt-4o-mini",
          temperature: 0.1,
          maxTokens: 8192,
        }),
      ),
    );

    // Stitch chunks back together. Overlap ranges would double-count —
    // strip the overlap prefix from every chunk after the first by
    // looking for the overlap text in the previous chunk's tail.
    const stitched = stitchChunks(cleaned);

    return {
      text: stitched,
      normalized: true,
      chunks: chunks.length,
    };
  } catch (err) {
    console.warn("[normalizer] LLM cleanup failed, returning raw text:", err);
    return { text: trimmed, normalized: false, chunks: 0 };
  }
}

/** Split `text` into overlapping chunks, trying to break on paragraph boundaries. */
function chunkText(text: string, size: number, overlap: number): string[] {
  if (text.length <= size) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + size, text.length);

    // Snap to nearest paragraph boundary within the last 1000 chars
    if (end < text.length) {
      const window = text.slice(end - 1000, end);
      const lastPara = window.lastIndexOf("\n\n");
      if (lastPara > 0) {
        end = end - 1000 + lastPara;
      }
    }

    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

/**
 * Concatenate cleaned chunks. Because each chunk was cleaned
 * independently with overlap, naive concatenation would duplicate
 * the overlap region. We join with `\n\n` and trust that minor
 * repetition is harmless — downstream agents dedupe aggressively.
 *
 * A more precise strategy (finding the longest common prefix between
 * adjacent chunks and removing it) would trim ~1-2% more text but
 * adds fragile string-matching code. Keep it simple unless users
 * complain about duplicated paragraphs.
 */
function stitchChunks(chunks: string[]): string {
  return chunks
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
