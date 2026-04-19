/**
 * Text segmentation for ambient proposal detection.
 *
 * Given a sticky-note's plain text, emit an array of candidate spans
 * — each the target of one retrieval + proposal cycle. The goal is
 * to surface a DIFFERENT span per concept so the ProposalRail can
 * anchor each proposal to exactly the phrase it's about, supporting
 * multi-concept notes like:
 *
 *   "Retention is the real problem, not acquisition.
 *    Onboarding friction might be causing the drop-off."
 *
 *   → segments: ["Retention is the real problem, not acquisition.",
 *                "Onboarding friction might be causing the drop-off."]
 *
 * Long sentences are sub-split at conjunctions/commas so a single
 * run-on line with two distinct concepts still yields two spans.
 *
 * Strategy — no LLM, no tokenizer, character-offset arithmetic:
 *   1. Walk through text, detecting sentence boundaries ([.!?]+ followed
 *      by whitespace, with rough abbreviation handling).
 *   2. For segments over LONG_SEGMENT_CHARS, sub-split at coordinating
 *      conjunctions (" and ", " or ", " but ", " so ", " because ")
 *      and at semicolons / colons.
 *   3. Discard segments whose trimmed content is below MIN_SEGMENT_CHARS.
 *   4. Cap at MAX_SEGMENTS — the ambient endpoint is on the keystroke
 *      path and can't afford to run retrieval N times for very long notes.
 */

const MIN_SEGMENT_CHARS = 12;
const LONG_SEGMENT_CHARS = 120;
const MAX_SEGMENTS = 12;

// Common abbreviations that end with a period but don't start a new sentence.
// This is intentionally tiny — we optimize for recall (more segments) over
// surgical abbreviation handling, because an over-split segment costs one
// extra retrieval call and nothing else.
const ABBREVIATIONS = new Set([
  "e.g",
  "i.e",
  "etc",
  "vs",
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "st",
  "inc",
  "ltd",
  "co",
  "jr",
  "sr",
  "no",
]);

export interface TextSegment {
  start: number; // inclusive, char offset in original text
  end: number;   // exclusive
  text: string;  // original slice, trimmed leading/trailing whitespace
}

export function segmentText(input: string): TextSegment[] {
  if (!input) return [];
  const text = input;
  const len = text.length;

  // ── Pass 1: sentence split ──
  const sentences: TextSegment[] = [];
  let sentStart = 0;

  let i = 0;
  while (i < len) {
    const ch = text[i];
    if (ch === "." || ch === "!" || ch === "?") {
      // Consume a run of terminators (!!, ?!, ...)
      let j = i;
      while (j < len && (text[j] === "." || text[j] === "!" || text[j] === "?")) {
        j++;
      }

      // Is the token before the terminator an abbreviation?
      // Look backward for the previous word.
      let k = i - 1;
      while (k >= sentStart && /[A-Za-z]/.test(text[k])) k--;
      const token = text.slice(k + 1, i).toLowerCase();
      const isAbbrev = ABBREVIATIONS.has(token);

      const nextIsWhitespaceOrEnd = j >= len || /\s/.test(text[j]);

      if (!isAbbrev && nextIsWhitespaceOrEnd) {
        const segEnd = j;
        const raw = text.slice(sentStart, segEnd);
        const leadingWs = raw.length - raw.trimStart().length;
        const trailing = raw.length - raw.trimEnd().length;
        const absStart = sentStart + leadingWs;
        const absEnd = segEnd - trailing;
        if (absEnd > absStart) {
          sentences.push({
            start: absStart,
            end: absEnd,
            text: text.slice(absStart, absEnd),
          });
        }
        // Advance past any whitespace
        while (j < len && /\s/.test(text[j])) j++;
        sentStart = j;
        i = j;
        continue;
      }
      i = j;
      continue;
    }
    i++;
  }
  // Trailing fragment
  if (sentStart < len) {
    const raw = text.slice(sentStart);
    const leadingWs = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    const absStart = sentStart + leadingWs;
    const absEnd = len - trailing;
    if (absEnd > absStart) {
      sentences.push({
        start: absStart,
        end: absEnd,
        text: text.slice(absStart, absEnd),
      });
    }
  }

  // ── Pass 2: sub-split long sentences ──
  const refined: TextSegment[] = [];
  const subSplitRegex = /(\s+(?:and|or|but|so|because|however|whereas)\s+|[;:]\s+)/gi;

  for (const seg of sentences) {
    if (seg.text.length <= LONG_SEGMENT_CHARS) {
      refined.push(seg);
      continue;
    }
    // Split seg.text while keeping offsets absolute
    let cursor = seg.start;
    subSplitRegex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = subSplitRegex.exec(seg.text)) !== null) {
      const localEnd = seg.start + m.index;
      const absEnd = localEnd;
      if (absEnd > cursor) {
        const slice = text.slice(cursor, absEnd);
        const leadingWs = slice.length - slice.trimStart().length;
        const trailing = slice.length - slice.trimEnd().length;
        const s = cursor + leadingWs;
        const e = absEnd - trailing;
        if (e > s) {
          refined.push({ start: s, end: e, text: text.slice(s, e) });
        }
      }
      cursor = seg.start + subSplitRegex.lastIndex;
    }
    if (cursor < seg.end) {
      const slice = text.slice(cursor, seg.end);
      const leadingWs = slice.length - slice.trimStart().length;
      const trailing = slice.length - slice.trimEnd().length;
      const s = cursor + leadingWs;
      const e = seg.end - trailing;
      if (e > s) {
        refined.push({ start: s, end: e, text: text.slice(s, e) });
      }
    }
  }

  // ── Pass 3: filter + cap ──
  const filtered = refined.filter(
    (s) => s.text.trim().length >= MIN_SEGMENT_CHARS,
  );

  // Prefer earlier segments when over-cap (they're typically the thesis
  // of the note; trailing thoughts can be picked up on the next keystroke).
  return filtered.slice(0, MAX_SEGMENTS);
}
