// ── Glossary lookup (client-safe) ──────────────────────────────────
//
// Pure read-side helpers for the space glossary, split out of
// generate-glossary.ts — which imports the server-only LLM client
// (`@/lib/llm`). CLIENT components (e.g. the annotation popover) need the
// slug→term map but must NOT drag the generator + the LLM bundle into the
// browser; webpack fails to bundle `@/lib/llm` for the client. Keeping this
// file free of any server import lets the client build the map safely.
//
// `GlossaryTerm` is re-exported as a TYPE here (erased at runtime, so the
// type import of generate-glossary does not pull its runtime in).

import { slugifyConcept } from "./normalize-annotations";
import type { GlossaryTerm } from "./generate-glossary";

export type { GlossaryTerm };

/** Index glossary terms by their canonical `concept_slug` (falling back to a
 *  slug derived from the term) for O(1) lookup from annotation popovers. */
export function buildGlossaryBySlug(
  terms: GlossaryTerm[],
): Map<string, GlossaryTerm> {
  const out = new Map<string, GlossaryTerm>();
  for (const t of terms) {
    const slug = t.concept_slug ?? slugifyConcept(t.term);
    if (!slug) continue;
    out.set(slug, t);
  }
  return out;
}
