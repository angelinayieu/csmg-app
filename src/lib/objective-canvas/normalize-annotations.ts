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

export function normalizeAnnotation(raw: unknown): ObjectiveAnnotation | null {
  if (!isRecord(raw)) return null;
  const phrase = asString(raw.phrase);
  if (phrase.length === 0) return null;

  return {
    phrase,
    start_offset: asNumber(raw.start_offset, 0),
    end_offset: asNumber(raw.end_offset, phrase.length),
    scope: asScope(raw.scope),
    reading: asString(raw.reading),
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
    fragility: typeof raw.fragility === "string" ? raw.fragility : null,
    tensions: asTensions(raw.tensions),
    linked_sub_objective_id:
      typeof raw.linked_sub_objective_id === "string"
        ? raw.linked_sub_objective_id
        : null,
    layer_tag: asLayerTag(raw.layer_tag),
  };
}

export function normalizeAnnotations(raw: unknown): ObjectiveAnnotation[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    const n = normalizeAnnotation(r);
    return n ? [n] : [];
  });
}
