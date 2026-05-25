// ── Objective annotation generator (v3) ──
//
// Adds scope + dimensions[] + inference_chain[] on top of v2.

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

export type AnnotationScope = "word" | "phrase";

export interface AnnotationExtension {
  /** Short candidate-feature name (≤6 words). */
  name: string;
  /** Why this follows from the analogy holding. */
  why: string;
}

export interface AnnotationAnalogy {
  referent: string;
  /** Distant-domain label — see DOMAIN CATALOG in the prompt. */
  domain: string;
  glyph: GlyphKind;
  why_same: string;
  /** The disanalogy — where the mapping BREAKS in this user's
   *  context. Often where the novel feature lives. */
  why_differs: string | null;
  /** 2-4 candidate features that follow if the analogy holds —
   *  generative payoff. */
  extensions: AnnotationExtension[];
  /** 0..1 — how generative this analogy is. Sort desc. */
  generativity: number;
}

export interface AnnotationTension {
  phrase: string;
  kind: "tension" | "harmony";
  note: string;
}

export interface AnnotationDimension {
  /** Short noun (≤4 words). */
  name: string;
  /** 1 sentence on what this factor contributes. */
  why: string;
}

export interface AnnotationChainHop {
  /** Short noun phrase naming the step (≤5 words). */
  step: string;
  /** 1 sentence on why this transitions to the next step. */
  via: string;
}

export interface ObjectiveAnnotation {
  // Core
  phrase: string;
  start_offset: number;
  end_offset: number;
  scope: AnnotationScope;
  reading: string;
  weight: number;

  // Word-scope deep structure
  dimensions: AnnotationDimension[];
  inference_chain: AnnotationChainHop[];

  // Optional richness
  not_reading: string | null;
  crystal: string | null;
  confidence: number | null;
  /** v4 — 3-5 analogies from maximally distant domains. The
   *  Analogy Polyhedron. */
  analogies: AnnotationAnalogy[];
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
const ALLOWED_SCOPES = new Set(["word", "phrase"]);

export async function generateObjectiveAnnotations(
  opts: GenerateAnnotationsOptions,
): Promise<ObjectiveAnnotation[]> {
  if (opts.objective.trim().length < 4) return [];

  const raw = await llmJSON<LlmShape>({
    system: buildSystemPrompt(),
    user: buildUserPrompt(opts),
    responseSchema: RESPONSE_SCHEMA,
    temperature: 0.4,
    maxTokens: 4200,
  });

  const rawItems = Array.isArray(raw?.annotations) ? raw.annotations : [];
  const validSubObjectiveIds = new Set(opts.subObjectives.map((s) => s.id));

  const taken: Array<[number, number]> = [];
  const cleaned: ObjectiveAnnotation[] = [];

  for (const a of rawItems) {
    const phrase = typeof a.phrase === "string" ? a.phrase : "";
    const reading = typeof a.reading === "string" ? a.reading.trim() : "";
    if (phrase.length === 0 || reading.length === 0) continue;

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

    // ── Scope: derive from LLM, falling back to phrase if missing ──
    const scope: AnnotationScope =
      typeof a.scope === "string" && ALLOWED_SCOPES.has(a.scope)
        ? (a.scope as AnnotationScope)
        : resolvedPhrase.trim().split(/\s+/).length <= 2
          ? "word"
          : "phrase";

    const not_reading = stringOrNull(a.not_reading, 200);
    const crystal = stringOrNull(a.crystal, 24);
    const confidence = clampFloat(a.confidence);
    const weight = clampFloat(a.weight) ?? 0.6;

    // ── dimensions[] ──
    const dimensions: AnnotationDimension[] = Array.isArray(a.dimensions)
      ? (a.dimensions as unknown[])
          .map((d): AnnotationDimension | null => {
            if (!d || typeof d !== "object") return null;
            const dr = d as Record<string, unknown>;
            const name = stringOrNull(dr.name, 60);
            const why = stringOrNull(dr.why, 200);
            if (!name || !why) return null;
            return { name, why };
          })
          .filter((x): x is AnnotationDimension => x !== null)
          .slice(0, 5)
      : [];

    // ── inference_chain[] ──
    const inference_chain: AnnotationChainHop[] = Array.isArray(
      a.inference_chain,
    )
      ? (a.inference_chain as unknown[])
          .map((h): AnnotationChainHop | null => {
            if (!h || typeof h !== "object") return null;
            const hr = h as Record<string, unknown>;
            const step = stringOrNull(hr.step, 80);
            const via = stringOrNull(hr.via, 200);
            if (!step || !via) return null;
            return { step, via };
          })
          .filter((x): x is AnnotationChainHop => x !== null)
          .slice(0, 5)
      : [];

    // ── Analogies (v4) ──
    // Validate each entry; dedupe by domain (distance rule); cap to 5;
    // sort by generativity descending. Back-compat: if the LLM still
    // emits a legacy single `like` object, fold it in as the first
    // analogy entry.
    let analogies: AnnotationAnalogy[] = [];
    const rawAnalogies: unknown[] = Array.isArray(a.analogies)
      ? (a.analogies as unknown[])
      : [];
    if (rawAnalogies.length === 0 && a.like && typeof a.like === "object") {
      rawAnalogies.push(a.like);
    }
    const seenDomains = new Set<string>();
    for (const raw of rawAnalogies) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const ref = stringOrNull(r.referent, 60);
      const why_same = stringOrNull(r.why_same, 200);
      const glyph = typeof r.glyph === "string" ? r.glyph : "";
      if (!ref || !why_same || !ALLOWED_GLYPHS.has(glyph)) continue;
      const domain = stringOrNull(r.domain, 40) ?? "General";
      const domainKey = domain.toLowerCase();
      if (seenDomains.has(domainKey)) continue;
      seenDomains.add(domainKey);
      const why_differs = stringOrNull(r.why_differs, 220);
      const extensions: AnnotationExtension[] = Array.isArray(r.extensions)
        ? (r.extensions as unknown[])
            .map((e): AnnotationExtension | null => {
              if (!e || typeof e !== "object") return null;
              const er = e as Record<string, unknown>;
              const name = stringOrNull(er.name, 60);
              const why = stringOrNull(er.why, 200);
              if (!name || !why) return null;
              return { name, why };
            })
            .filter((x): x is AnnotationExtension => x !== null)
            .slice(0, 4)
        : [];
      const generativity = clampFloat(r.generativity) ?? 0.5;
      analogies.push({
        referent: ref,
        domain,
        glyph: glyph as GlyphKind,
        why_same,
        why_differs,
        extensions,
        generativity,
      });
    }
    analogies.sort((x, y) => y.generativity - x.generativity);
    analogies = analogies.slice(0, 5);

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
      scope,
      reading: reading.slice(0, 220),
      weight: clamp01(weight),
      dimensions,
      inference_chain,
      not_reading,
      crystal,
      confidence,
      analogies,
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
