// ── Annotation shape normalizer ────────────────────────────────────
//
// The Objective Canvas ships annotations on `improvement_goals.annotations`
// (jsonb). The shape has evolved over time:
//
//   v2: { like: { glyph, referent, why_same }, ... }
//   v3: { analogies: AnnotationAnalogy[], dimensions: [], inference_chain: [],
//         scope: 'phrase' | 'word', ... }
//
// The v3 component (AnnotatedObjectiveCard) accesses `analogies.length`,
// `dimensions.length`, `inference_chain.length` directly. Old rows persisted
// in v2 shape crash the render with "cannot read properties of undefined".
//
// This module is the single read-side compat layer: call `normalizeAnnotations`
// on every server load or API response before handing data to the UI.

import { isGlyphKind } from "@/components/objective/icons/annotation-glyphs";
import type {
  AnnotationAnalogy,
  AnnotationChainHop,
  AnnotationDimension,
  AnnotationExtension,
  AnnotationFragility,
  AnnotationLayerTag,
  AnnotationScope,
  AnnotationTension,
  ObjectiveAnnotation,
} from "@/components/objective/annotated-objective-card";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asExtensions(v: unknown): AnnotationExtension[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    return [{ name: asString(raw.name), why: asString(raw.why) }];
  });
}

/** v5: fragility is { when, why, sign }. Back-compat: old payloads
 *  stored fragility as a plain string — promote it to { when } only. */
function asFragility(raw: unknown): AnnotationFragility | null {
  if (isRecord(raw)) {
    const when = asString(raw.when);
    const why = asString(raw.why);
    const sign = asString(raw.sign);
    if (when || why || sign) return { when, why, sign };
    return null;
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    return { when: raw.trim(), why: "", sign: "" };
  }
  return null;
}

function asAnalogy(raw: unknown): AnnotationAnalogy | null {
  if (!isRecord(raw)) return null;
  const glyph = isGlyphKind(raw.glyph) ? raw.glyph : "mirror";
  return {
    referent: asString(raw.referent),
    domain: asString(raw.domain),
    glyph,
    why_same: asString(raw.why_same),
    why_differs:
      typeof raw.why_differs === "string" ? raw.why_differs : null,
    extensions: asExtensions(raw.extensions),
    generativity: asNumber(raw.generativity, 0.5),
  };
}

function asAnalogies(raw: unknown, legacyLike: unknown): AnnotationAnalogy[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((a) => {
      const n = asAnalogy(a);
      return n ? [n] : [];
    });
  }
  const fromLike = asAnalogy(legacyLike);
  return fromLike ? [fromLike] : [];
}

function asDimensions(v: unknown): AnnotationDimension[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    return [{ name: asString(raw.name), why: asString(raw.why) }];
  });
}

function asChain(v: unknown): AnnotationChainHop[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    return [{ step: asString(raw.step), via: asString(raw.via) }];
  });
}

function asTensions(v: unknown): AnnotationTension[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const kind = raw.kind === "harmony" ? "harmony" : "tension";
    return [
      {
        phrase: asString(raw.phrase),
        kind,
        note: asString(raw.note),
      },
    ];
  });
}

function asLayerTag(v: unknown): AnnotationLayerTag {
  if (v === "pain" || v === "features" || v === "outcomes" || v === "objective") {
    return v;
  }
  return null;
}

function asScope(v: unknown): AnnotationScope {
  return v === "word" ? "word" : "phrase";
}

/** Phase 2 — concept_slug derivation. Deterministic, ASCII-safe,
 *  hyphen-separated. Used as the cross-surface join key between
 *  annotations and the space glossary. Stable across regens IFF the
 *  concept (or fallback phrase) is stable — when the LLM rewords the
 *  concept, the slug changes, and the glossary merge handles dedupe.
 *
 *  Hardened against unicode (smart quotes, accents) by NFKD-folding and
 *  stripping combining marks before slugifying. Capped at 60 chars to
 *  match the glossary term cap. */
export function slugifyConcept(s: string | null | undefined): string {
  const src = (s ?? "").toString();
  if (!src.trim()) return "";
  return src
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // non-alphanum → hyphen
    .replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
    .slice(0, 60);
}

export function normalizeAnnotation(raw: unknown): ObjectiveAnnotation | null {
  if (!isRecord(raw)) return null;
  const phrase = asString(raw.phrase);
  if (phrase.length === 0) return null;

  // Phase 2 — concept + concept_slug derivation. v3 rows have neither;
  // fall back to slugify(phrase) so legacy data still resolves into the
  // glossary by a deterministic key. When the LLM emits `concept`, use
  // that as the canonical noun phrase and slug from there. Empty slug
  // is tolerated (extremely degenerate phrases) — the popup just won't
  // resolve into the glossary in that case.
  const concept = typeof raw.concept === "string" && raw.concept.trim()
    ? raw.concept.trim().slice(0, 60)
    : null;
  const concept_slug = slugifyConcept(concept ?? phrase);

  return {
    phrase,
    start_offset: asNumber(raw.start_offset, 0),
    end_offset: asNumber(raw.end_offset, phrase.length),
    scope: asScope(raw.scope),
    // The annotation prompt instructs the LLM to commit each reading as
    // "Read as: …" — a prompt device, not user copy. Strip the scaffold
    // prefix here so every render site (heading, body lens, lens strip)
    // shows the interpretation alone.
    reading: asString(raw.reading).replace(/^\s*read\s+as\s*:\s*/i, ""),
    weight: asNumber(raw.weight, 0.5),
    dimensions: asDimensions(raw.dimensions),
    inference_chain: asChain(raw.inference_chain),
    not_reading:
      typeof raw.not_reading === "string" ? raw.not_reading : null,
    crystal: typeof raw.crystal === "string" ? raw.crystal : null,
    confidence:
      typeof raw.confidence === "number" ? raw.confidence : null,
    analogies: asAnalogies(raw.analogies, raw.like),
    mechanism: typeof raw.mechanism === "string" ? raw.mechanism : null,
    frame: typeof raw.frame === "string" ? raw.frame : null,
    stakes: typeof raw.stakes === "string" ? raw.stakes : null,
    fragility: asFragility(raw.fragility),
    tensions: asTensions(raw.tensions),
    linked_sub_objective_id:
      typeof raw.linked_sub_objective_id === "string"
        ? raw.linked_sub_objective_id
        : null,
    layer_tag: asLayerTag(raw.layer_tag),
    concept,
    concept_slug,
  };
}

export function normalizeAnnotations(raw: unknown): ObjectiveAnnotation[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const n = normalizeAnnotation(r);
    return n ? [n] : [];
  });
}
