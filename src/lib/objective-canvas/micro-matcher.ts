// ── Micro-question deterministic matcher (Tier-0) ─────────────────────
//
// Decides which board cards / pinned glossary terms "address" each open
// micro_question on the prompt-sharpening artifact. Pure, cheap, no LLM —
// fires on rail open + refresh + debounced board edits + sharpening updates.
//
// Address vs resolve: this layer writes `addressed_by[]` entries (the gradient
// — "work touches this sub-question") AND auto-flips a micro to resolved when a
// candidate STRONGLY covers the micro's own question (own-token recall ≥
// RESOLVE_THRESHOLD — the high-confidence threshold). Two scorings on purpose:
// lenient slug-boosted recall drives ADDRESSING (the rail breathes); strict
// own-token recall drives RESOLUTION, so a card merely naming the concept can't
// silently resolve all its micros.
//
// Scoring: token-recall (how much of the micro's distinctive vocabulary the
// candidate covers) + a concept-slug boost when the macro's slug parts show
// up in the candidate. Stopwords and short tokens are dropped on both sides
// so common words don't create spurious matches.

import type {
  SalienceAnnotation,
  AddressingRef,
} from "./prompt-sharpening-prompt";
import { liveUncertainty } from "./prompt-sharpening-prompt";

const STOPWORDS = new Set([
  "a","an","the","and","or","but","is","are","was","were","be","been","being",
  "to","of","in","on","at","by","for","with","from","into","onto","up","down","out",
  "as","that","this","these","those","it","its","i","we","you","they","he","she","them","us",
  "what","when","where","why","how","who","whom","which","whose",
  "do","does","did","done","doing","have","has","had","having",
  "will","would","should","could","can","may","might","must","shall",
  "so","than","then","there","here","just","very","more","most","much","many",
  "any","all","each","every","no","not","only","own","same","such","some","one","two",
  "if","because","while","about","against","between","through","during","before","after",
  "yes","also","still","both","either","neither","make","makes","made","get","got",
  "thing","things","stuff","way","ways","kind","kinds","sort","sorts",
]);

const ADDRESS_THRESHOLD = 0.4;
// Strict, own-token-only bar for AUTO-RESOLVING a micro (not just addressing it).
// High by design: a candidate must cover most of the micro's OWN question
// vocabulary — not merely name the concept — before we flip it resolved.
const RESOLVE_THRESHOLD = 0.75;
const MAX_REFS_PER_MICRO = 5;

function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length > 2 && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

function slugTokens(slug: string): string[] {
  return slug.split("-").filter((p) => p.length > 2 && !STOPWORDS.has(p));
}

/** Token-recall: fraction of the micro's distinctive tokens the candidate
 *  covers. Asymmetric on purpose — a long card mentioning "music remix" once
 *  shouldn't get credit for the entire card; conversely a 4-word card that
 *  exactly nails the micro should score high. */
function recall(microToks: Set<string>, candToks: Set<string>): number {
  if (microToks.size === 0 || candToks.size === 0) return 0;
  let hits = 0;
  for (const t of microToks) if (candToks.has(t)) hits++;
  return hits / microToks.size;
}

export interface AddressCandidate {
  kind: "card" | "glossary";
  ref: string;
  text: string;
}

export interface MicroAddressing {
  microId: string;
  newRefs: AddressingRef[];
  /** Strong OWN-token coverage (≥ RESOLVE_THRESHOLD) → auto-flip this micro to
   *  resolved. The `resolvedRef` is the candidate that earned it (also supplies
   *  the resolved_at timestamp, keeping applyMicroAddressing pure). */
  resolve?: boolean;
  resolvedRef?: AddressingRef;
}

/** Match a set of candidates against every open micro on the artifact and
 *  return the deltas to merge into each micro's addressed_by[]. Dedupes
 *  against existing refs; caps each micro at MAX_REFS_PER_MICRO. Resolved
 *  micros are skipped (no need to keep accruing addressing). */
export function matchMicros(
  anns: SalienceAnnotation[],
  candidates: AddressCandidate[],
  nowIso: string,
): MicroAddressing[] {
  const out: MicroAddressing[] = [];
  const tokenizedCandidates = candidates.map((c) => ({
    ...c,
    toks: tokenize(c.text),
  }));

  for (const ann of anns) {
    const micros = ann.micro_questions;
    if (!micros || micros.length === 0) continue;
    const slugParts = slugTokens(ann.concept_slug);
    for (const m of micros) {
      if (m.resolved_at) continue;
      const ownToks = tokenize(m.q); // the micro's OWN question vocabulary
      // Slug-boosted set for ADDRESSING: a card that just names the concept
      // still counts as touching its sub-questions.
      const microToks = new Set(ownToks);
      for (const p of slugParts) microToks.add(p);
      if (microToks.size === 0) continue;

      const existingRefs = new Set(
        (m.addressed_by ?? []).map((r) => `${r.kind}:${r.ref}`),
      );
      const room = MAX_REFS_PER_MICRO - (m.addressed_by?.length ?? 0);

      const matches: { ref: AddressingRef; score: number }[] = [];
      let resolve = false;
      let resolvedRef: AddressingRef | undefined;
      for (const c of tokenizedCandidates) {
        // ADDRESSING (lenient, slug-boosted) — only NEW refs, only within room.
        if (room > 0 && !existingRefs.has(`${c.kind}:${c.ref}`)) {
          const score = recall(microToks, c.toks);
          if (score >= ADDRESS_THRESHOLD) {
            matches.push({ ref: { kind: c.kind, ref: c.ref, at: nowIso }, score });
          }
        }
        // RESOLUTION (strict, own-tokens only) — independent of room. One
        // candidate that strongly covers the micro's own question resolves it.
        if (
          !resolve &&
          ownToks.size > 0 &&
          recall(ownToks, c.toks) >= RESOLVE_THRESHOLD
        ) {
          resolve = true;
          resolvedRef = { kind: c.kind, ref: c.ref, at: nowIso };
        }
      }
      if (matches.length === 0 && !resolve) continue;
      matches.sort((a, b) => b.score - a.score);
      out.push({
        microId: m.id,
        newRefs: matches.slice(0, Math.max(0, room)).map((m2) => m2.ref),
        resolve,
        resolvedRef,
      });
    }
  }
  return out;
}

/** Apply a list of MicroAddressing deltas onto a cloned annotations array.
 *  Pure — returns a new array, doesn't mutate the input. Used by the API
 *  route to produce the JSONB blob to write back. */
export function applyMicroAddressing(
  anns: SalienceAnnotation[],
  deltas: MicroAddressing[],
): SalienceAnnotation[] {
  if (deltas.length === 0) return anns;
  const byMicroId = new Map<string, MicroAddressing>();
  for (const d of deltas) byMicroId.set(d.microId, d);
  return anns.map((a) => {
    const micros = a.micro_questions;
    if (!micros || micros.length === 0) return a;
    let touched = false;
    const next = micros.map((m) => {
      const d = byMicroId.get(m.id);
      if (!d) return m;
      const add = d.newRefs ?? [];
      const willResolve = !!d.resolve && !!d.resolvedRef && !m.resolved_at;
      if (add.length === 0 && !willResolve) return m;
      touched = true;
      const merged = {
        ...m,
        addressed_by: [...(m.addressed_by ?? []), ...add].slice(
          0,
          MAX_REFS_PER_MICRO,
        ),
      };
      if (willResolve) merged.resolved_at = d.resolvedRef!.at;
      return merged;
    });
    if (!touched) return a;
    // Recompute the macro uncertainty from the now-current micro state so the
    // rail bars + ranking drop as micros get addressed / resolved.
    const updated = { ...a, micro_questions: next };
    return { ...updated, uncertainty: liveUncertainty(updated) };
  });
}
