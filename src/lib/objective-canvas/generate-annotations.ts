// ── Objective annotation generator (v2) ──
//
// Calls the LLM, validates the rich annotation shape, resolves
// phrase offsets, drops hallucinated phrases, deduplicates
// overlapping ranges, and sorts left-to-right.

import { llmJSON } from "@/lib/llm";
import {
  GLYPH_KINDS,
  type GlyphKind,
} from "@/components/objective/icons/annotation-glyphs";
import {
  buildSystemPrompt,
  buildUserPrompt,
  RESPONSE_SCHEMA,
  type AnnotationSubObjectiveRef,
} from "./annotations-prompt";

export type AnnotationLayerTag =
  | "features"
  | "outcomes"
  | "pain"
  | "objective"
  | null;

export interface AnnotationAnalogy {
  referent: string;
  why_same: string;
  glyph: GlyphKind;
}

export interface AnnotationTension {
  /** The other phrase from the same objective. */
  phrase: string;
  kind: "tension" | "harmony";
  note: string;
}

export interface ObjectiveAnnotation {
  // Core
  phrase: string;
  start_offset: number;
  end_offset: number;
  reading: string;
  /** 0..1 — drives underline thickness (heatmap). */
  weight: number;

  // Optional richness
  not_reading: string | null;
  crystal: string | null;
  confidence: number | null;
  like: AnnotationAnalogy | null;
  mechanism: string | null;
  frame: string | null;
  stakes: string | null;
  fragility: string | null;
  tensions: AnnotationTension[];

  // Connections
  linked_sub_objective_id: string | null;
  layer_tag: AnnotationLayerTag;
}

interface LlmShape {
  annotations?: Array<Record<string, unknown>>;
}

export interface GenerateAnnotationsOptions {
  objective: string;
  subObjectives: AnnotationSubObjectiveRef[];
}

const ALLOWED_TAGS = new Set(["features", "outcomes", "pain", "objective"]);
const ALLOWED_GLYPHS = new Set<string>(GLYPH_KINDS);

export async function generateObjectiveAnnotations(
  opts: GenerateAnnotationsOptions,
): Promise<ObjectiveAnnotation[]> {
  if (opts.objective.trim().length < 4) return [];

  const raw = await llmJSON<LlmShape>({
    system: buildSystemPrompt(),
    user: buildUserPrompt(opts),
    responseSchema: RESPONSE_SCHEMA,
    temperature: 0.4,
    maxTokens: 3200,
  });

  const rawItems = Array.isArray(raw?.annotations) ? raw.annotations : [];
  const validSubObjectiveIds = new Set(opts.subObjectives.map((s) => s.id));

  // Resolve each phrase to an offset range; drop hallucinated
  // phrases. Track ranges already taken so we don't double-highlight.
  const taken: Array<[number, number]> = [];
  const cleaned: ObjectiveAnnotation[] = [];

  for (const a of rawItems) {
    const phrase = typeof a.phrase === "string" ? a.phrase : "";
    const reading = typeof a.reading === "string" ? a.reading.trim() : "";
    if (phrase.length === 0 || reading.length === 0) continue;

    // Locate the phrase. Try exact, then case-insensitive fallback.
    let start = opts.objective.indexOf(phrase);
    let resolvedPhrase = phrase;
    if (start < 0) {
      const lower = opts.objective.toLowerCase();
      const idx = lower.indexOf(phrase.toLowerCase());
      if (idx >= 0) {
        start = idx;
        resolvedPhrase = opts.objective.slice(idx, idx + phrase.length);
      } else {
        continue;
      }
    }
    const end = start + resolvedPhrase.length;

    if (
      taken.some(
        ([s, e]) =>
          (start >= s && start < e) ||
          (end > s && end <= e) ||
          (start <= s && end >= e),
      )
    ) {
      continue;
    }
    taken.push([start, end]);

    // ── Clean optional fields ──

    const not_reading = stringOrNull(a.not_reading, 200);
    const crystal = stringOrNull(a.crystal, 24);
    const confidence = clampFloat(a.confidence);
    const weight = clampFloat(a.weight) ?? 0.6;

    let like: AnnotationAnalogy | null = null;
    if (a.like && typeof a.like === "object") {
      const lo = a.like as Record<string, unknown>;
      const ref = stringOrNull(lo.referent, 60);
      const why = stringOrNull(lo.why_same, 180);
      const glyph = typeof lo.glyph === "string" ? lo.glyph : "";
      if (ref && why && ALLOWED_GLYPHS.has(glyph)) {
        like = { referent: ref, why_same: why, glyph: glyph as GlyphKind };
      }
    }

    const mechanism = stringOrNull(a.mechanism, 160);
    const frame = stringOrNull(a.frame, 100);
    const stakes = stringOrNull(a.stakes, 200);
    const fragility = stringOrNull(a.fragility, 200);

    const tensions: AnnotationTension[] = Array.isArray(a.tensions)
      ? (a.tensions as unknown[])
          .map((t): AnnotationTension | null => {
            if (!t || typeof t !== "object") return null;
            const to = t as Record<string, unknown>;
            const refPhrase = stringOrNull(to.phrase, 80);
            const kind =
              to.kind === "tension" || to.kind === "harmony" ? to.kind : null;
            const note = stringOrNull(to.note, 160);
            if (!refPhrase || !kind || !note) return null;
            return { phrase: refPhrase, kind, note };
          })
          .filter((x): x is AnnotationTension => x !== null)
          .slice(0, 2)
      : [];

    const linked =
      typeof a.linked_sub_objective_id === "string" &&
      validSubObjectiveIds.has(a.linked_sub_objective_id)
        ? a.linked_sub_objective_id
        : null;

    const layerTag =
      typeof a.layer_tag === "string" && ALLOWED_TAGS.has(a.layer_tag)
        ? (a.layer_tag as Exclude<AnnotationLayerTag, null>)
        : null;

    cleaned.push({
      phrase: resolvedPhrase,
      start_offset: start,
      end_offset: end,
      reading: reading.slice(0, 220),
      weight: clamp01(weight),
      not_reading,
      crystal,
      confidence,
      like,
      mechanism,
      frame,
      stakes,
      fragility,
      tensions,
      linked_sub_objective_id: linked,
      layer_tag: layerTag,
    });
  }

  cleaned.sort((a, b) => a.start_offset - b.start_offset);
  return cleaned.slice(0, 8);
}

// ── Helpers ────────────────────────────────────────────────────────

function stringOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.slice(0, max);
}

function clampFloat(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return clamp01(v);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
