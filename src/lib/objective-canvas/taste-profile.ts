// ── taste-profile ───────────────────────────────────────────────────
//
// The user's synthesized "this is who I am for this objective" page.
// One row per space (library_objects, object_type='taste_profile'),
// content_snapshot carrying the structured profile.
//
// Architecture:
//   - VOCABULARY + SOURCES = deterministic readout of substrate
//     (glossary terms by provenance, analyzed images). NO LLM cost.
//   - VOICE + TENSIONS + NO_GOS = LLM synthesis from glossary +
//     image_narratives + objective + intention/taste notes. One Sonnet
//     call, structured JSON, ~600 tokens.
//   - Each section can be PINNED — a pinned section is excluded from
//     LLM regeneration so the user's edits are durable. Mirrors
//     glossary `pinned`/`source='user'` discipline.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  upsertLibraryObject,
  getLibraryObject,
  type LibraryObjectRow,
} from "./library-objects";
import { asGlossaryKind, type GlossaryKind } from "./generate-glossary";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

const SOURCE_REF = "taste-profile";
const PROFILE_TITLE = "Your taste";

export type TasteSection =
  | "voice"
  | "vocabulary"
  | "tensions"
  | "sources"
  | "no_gos"
  | "style_synthesis";

export interface TasteVoice {
  /** 2-4 word tone tag — "Direct, technical, MVP-first". */
  tone: string;
  /** 1-2 sentence elaboration of how the user writes/decides. */
  style: string;
}

/** One term in a provenance bucket, with its grammatical kind preserved so
 *  the rail can sub-group ("Entities you've coined", "Patterns you've
 *  grounded", etc.). null kind = un-classified (legacy or LLM-uncertain). */
export interface TasteVocabEntry {
  term: string;
  kind: GlossaryKind | null;
}

export interface TasteVocab {
  /** Pinned/user-authored terms — the user's earned vocabulary. */
  coined: TasteVocabEntry[];
  /** Terms grounded by references the user added (images, refs). */
  grounded: TasteVocabEntry[];
  /** AI-suggested terms still un-touched by the user. */
  ai: TasteVocabEntry[];
}

export interface TasteSource {
  ingestedFileId: string;
  objectId: string | null;
  name: string;
  thumbUrl: string | null;
  sourceUrl: string | null;
  sourceType: string | null;
  /** Concept slugs this source contributed. */
  conceptSlugs: string[];
  /** Per-source visual cues, shown on the moodboard tile. */
  palette: string[];
  patterns: string[];
}

/** Visual style aggregated across the space's analyzed image references.
 *  Pure rollup of per-image image_source.content_snapshot.style_analysis —
 *  no LLM cost. Drives the "Visual style (from your references)" block
 *  in DESIGN.md and the palette override in tailwind.config.ts that the
 *  prototype generator reads. signal_strength gates whether the override
 *  fires: too few references → keep brand defaults. */
export interface StyleSynthesis {
  /** 3-4 hex codes ordered by aggregate prominence. */
  dominant_palette: string[];
  /** ≤2 hex codes pulled from per-image accent lists. */
  accent_palette: string[];
  palette_temperature: "warm" | "neutral" | "cool" | "mixed" | "unknown";
  typography_voice:
    | "humanist"
    | "geometric"
    | "monospaced"
    | "serif"
    | "mixed"
    | "unknown";
  composition_density: "sparse" | "balanced" | "dense" | "unknown";
  composition_grid: "rigid" | "loose" | "asymmetric" | "unknown";
  /** Patterns present in ≥2 of the source images, ordered by frequency. */
  recurring_patterns: string[];
  /** Motion cues that appear across ≥2 sources. */
  motion_cues: string[];
  /** 0-1 confidence — combines ref count + per-axis agreement. The
   *  prototype generator only overrides the brand palette when this
   *  clears 0.6 (≥3 broadly-agreeing references). */
  signal_strength: number;
  /** How many image_source rows actually contributed (had a non-empty
   *  style_analysis). Drives the "from N references" label in the UI. */
  source_count: number;
}

/** The full content_snapshot stashed on the taste_profile row. */
export interface TasteProfileSnapshot {
  voice: TasteVoice;
  vocabulary: TasteVocab;
  tensions: string[];
  sources: TasteSource[];
  no_gos: string[];
  /** Aggregated visual style from analyzed references. Pure rollup, no
   *  LLM cost. Empty when no image_source rows have style_analysis yet. */
  style_synthesis: StyleSynthesis;
  /** Section-level pins. A pinned section is preserved verbatim on
   *  regenerate; only un-pinned sections are re-synthesized. */
  pinned: Partial<Record<TasteSection, boolean>>;
  generated_at: string;
  /** Soft warning surfaced in the UI when the substrate is too thin
   *  for confident synthesis (e.g. no glossary, no sources). */
  thin_signal: boolean;
}

const EMPTY_VOICE: TasteVoice = {
  tone: "",
  style: "",
};

export const EMPTY_STYLE_SYNTHESIS: StyleSynthesis = {
  dominant_palette: [],
  accent_palette: [],
  palette_temperature: "unknown",
  typography_voice: "unknown",
  composition_density: "unknown",
  composition_grid: "unknown",
  recurring_patterns: [],
  motion_cues: [],
  signal_strength: 0,
  source_count: 0,
};

const EMPTY_SNAPSHOT: TasteProfileSnapshot = {
  voice: EMPTY_VOICE,
  vocabulary: { coined: [], grounded: [], ai: [] },
  tensions: [],
  sources: [],
  no_gos: [],
  style_synthesis: EMPTY_STYLE_SYNTHESIS,
  pinned: {},
  generated_at: new Date(0).toISOString(),
  thin_signal: true,
};

// ── read ────────────────────────────────────────────────────────────

/** Find-or-null the persisted taste_profile row + parsed snapshot. */
export async function getTasteProfile(
  db: AnyDb,
  spaceId: string,
): Promise<{ row: LibraryObjectRow; snapshot: TasteProfileSnapshot } | null> {
  try {
    const { data } = await db
      .from("library_objects")
      .select("*")
      .eq("space_id", spaceId)
      .eq("object_type", "taste_profile")
      .eq("source_ref", SOURCE_REF)
      .maybeSingle();
    if (!data) return null;
    const row = data as LibraryObjectRow;
    const snapshot = normalizeSnapshot(row.content_snapshot);
    return { row, snapshot };
  } catch (err) {
    console.warn("[taste-profile] getTasteProfile failed (soft):", err);
    return null;
  }
}

// ── deterministic vocabulary + sources readouts ─────────────────────

interface GlossaryRow {
  term: string;
  source?: string;
  pinned?: boolean;
  concept_slug?: string;
  kind?: unknown;
}

/** Group glossary terms by provenance into coined/grounded/ai buckets,
 *  preserving the grammatical kind per term so the rail can sub-group
 *  within each bucket. Pure — used both by the generator and the read
 *  path. */
export function bucketVocabulary(
  glossary: GlossaryRow[],
  groundedSlugs: Set<string>,
): TasteVocab {
  const coined: TasteVocabEntry[] = [];
  const grounded: TasteVocabEntry[] = [];
  const ai: TasteVocabEntry[] = [];
  for (const t of glossary) {
    const term = (t.term ?? "").trim();
    if (!term) continue;
    const entry: TasteVocabEntry = { term, kind: asGlossaryKind(t.kind) };
    if (t.pinned || t.source === "user") {
      coined.push(entry);
      continue;
    }
    const slug = t.concept_slug ?? "";
    if (
      groundedSlugs.has(slug) ||
      t.source === "annotation" ||
      t.source === "entity"
    ) {
      grounded.push(entry);
      continue;
    }
    ai.push(entry);
  }
  // Caps prevent the profile from becoming a wall of text. The full
  // glossary remains addressable via its own surface.
  return {
    coined: coined.slice(0, 24),
    grounded: grounded.slice(0, 24),
    ai: ai.slice(0, 18),
  };
}

interface ImageSourceRow {
  id: string;
  source_name: string | null;
  image_url: string | null;
  source_url?: string | null;
  source_type?: string | null;
  image_object_id?: string | null;
  image_concepts: unknown;
  style_analysis?: unknown;
}

function readSourcePalette(styleAnalysis: unknown): string[] {
  if (!styleAnalysis || typeof styleAnalysis !== "object") return [];
  const palette = (styleAnalysis as RawStyleAnalysis).palette;
  const dominant = Array.isArray(palette?.dominant) ? palette.dominant : [];
  const accent = Array.isArray(palette?.accent) ? palette.accent : [];
  return [...dominant, ...accent].filter(isHex).slice(0, 4);
}

function readSourcePatterns(styleAnalysis: unknown): string[] {
  if (!styleAnalysis || typeof styleAnalysis !== "object") return [];
  const patterns = (styleAnalysis as RawStyleAnalysis).patterns;
  return readStringArray(patterns, 4);
}

/** Map analyzed images → TasteSource[]. */
export function readSources(images: ImageSourceRow[]): TasteSource[] {
  return images.slice(0, 12).map((img) => ({
    ingestedFileId: img.id,
    objectId: img.image_object_id ?? null,
    name: img.source_name?.trim() || "Untitled image",
    thumbUrl: img.image_url,
    sourceUrl: img.source_url ?? null,
    sourceType: img.source_type ?? null,
    conceptSlugs: Array.isArray(img.image_concepts)
      ? (img.image_concepts as unknown[]).filter(
          (s): s is string => typeof s === "string",
        )
      : [],
    palette: readSourcePalette(img.style_analysis),
    patterns: readSourcePatterns(img.style_analysis),
  }));
}

// ── synthesis (LLM) ─────────────────────────────────────────────────

interface SynthesizeArgs {
  objectiveText: string;
  glossary: GlossaryRow[];
  imageNarratives: string[];
  intentionNotes: string[];
  tasteNotes: string[];
}

interface SynthesizedFields {
  voice: TasteVoice;
  tensions: string[];
  no_gos: string[];
}

const SYNTHESIS_SYSTEM = `You are reading a user's working substrate (objective, vocabulary, sources, notes) and writing a brief profile of their TASTE for this objective. The profile is shown back to the user as a one-page "this is who I am for this work."

Return STRICT JSON in this shape (no prose, no fences):

{
  "voice": { "tone": string, "style": string },
  "tensions": string[],
  "no_gos": string[]
}

RULES:
- voice.tone: 2-5 words describing how they write/decide. Examples: "Direct, technical, MVP-first" · "Warm, story-led, evidence-anchored" · "Skeptical, constraint-first". Don't invent — read it off their actual material.
- voice.style: 1-2 sentences elaborating tone. Concrete, not generic.
- tensions: 2-4 short phrases naming real tradeoffs surfaced by the material (e.g. "Cost vs latency", "Coherence vs read-replica freshness"). Each ≤ 6 words. Only include tensions the substrate actually shows.
- no_gos: 2-4 short phrases naming approaches the user has rejected or de-emphasized. Each ≤ 8 words. If the substrate doesn't surface any, return [].
- If the substrate is too thin to support a section (e.g. one image and no glossary), return an empty array / empty string instead of inventing.
- NEVER repeat glossary terms verbatim in tensions or no_gos — those are about meta-decisions, not vocabulary.

Return ONLY the JSON object.`;

export async function synthesizeTasteSections(
  args: SynthesizeArgs,
): Promise<SynthesizedFields> {
  const empty: SynthesizedFields = {
    voice: { tone: "", style: "" },
    tensions: [],
    no_gos: [],
  };
  try {
    const { llmJSON, MODEL_DEFAULTS } = await import("../llm");

    const glossaryBlock = args.glossary
      .slice(0, 40)
      .map((t) => {
        const tag = t.pinned || t.source === "user" ? " [yours]" : "";
        return `- ${t.term}${tag}`;
      })
      .join("\n") || "(no glossary yet)";

    const sourcesBlock =
      args.imageNarratives.length > 0
        ? args.imageNarratives
            .slice(0, 6)
            .map((n) => `- ${n}`)
            .join("\n")
        : "(no analyzed sources yet)";

    const intentionsBlock =
      args.intentionNotes.length > 0
        ? args.intentionNotes
            .slice(0, 12)
            .map((n) => `- ${n}`)
            .join("\n")
        : "(none)";

    const tastesBlock =
      args.tasteNotes.length > 0
        ? args.tasteNotes
            .slice(0, 12)
            .map((n) => `- ${n}`)
            .join("\n")
        : "(none)";

    const user = `OBJECTIVE:
${args.objectiveText.trim() || "(none yet)"}

GLOSSARY TERMS:
${glossaryBlock}

SOURCES (image narratives):
${sourcesBlock}

INTENTIONS (user notes):
${intentionsBlock}

TASTE NOTES (user notes, kind=taste):
${tastesBlock}

Write the taste profile.`;

    const result = await llmJSON<SynthesizedFields>({
      system: SYNTHESIS_SYSTEM,
      user,
      provider: "anthropic",
      model: MODEL_DEFAULTS.anthropic.fast,
      maxTokens: 700,
      temperature: 0.4,
      fallback: empty,
      validator: (raw) => {
        if (!raw || typeof raw !== "object") return empty;
        const o = raw as Record<string, unknown>;
        const voice = o.voice as Record<string, unknown> | undefined;
        const tensions = Array.isArray(o.tensions) ? o.tensions : [];
        const noGos = Array.isArray(o.no_gos) ? o.no_gos : [];
        return {
          voice: {
            tone:
              typeof voice?.tone === "string" ? voice.tone.slice(0, 80) : "",
            style:
              typeof voice?.style === "string"
                ? voice.style.slice(0, 280)
                : "",
          },
          tensions: tensions
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.slice(0, 80))
            .slice(0, 6),
          no_gos: noGos
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.slice(0, 120))
            .slice(0, 6),
        };
      },
    });
    return result;
  } catch (err) {
    console.warn("[taste-profile] synthesizeTasteSections failed (soft):", err);
    return empty;
  }
}

// ── upsert ───────────────────────────────────────────────────────────

/** Save a snapshot. Reuses the upsert path so the row is created on
 *  first save and updated in place after. */
export async function saveTasteProfile(
  db: AnyDb,
  args: {
    spaceId: string;
    userId: string;
    snapshot: TasteProfileSnapshot;
  },
): Promise<string | null> {
  return upsertLibraryObject(db, {
    spaceId: args.spaceId,
    userId: args.userId,
    objectType: "taste_profile",
    title: PROFILE_TITLE,
    summary: args.snapshot.voice.tone || "Synthesized taste profile",
    sourceRef: SOURCE_REF,
    contentSnapshot: args.snapshot,
  });
}

// ── normalize ───────────────────────────────────────────────────────

/** Defensive parse — accept whatever's on the row, fill missing fields
 *  with defaults so the UI never crashes on a partial blob. */
export function normalizeSnapshot(raw: unknown): TasteProfileSnapshot {
  if (!raw || typeof raw !== "object") return EMPTY_SNAPSHOT;
  const o = raw as Record<string, unknown>;
  const voice = o.voice as Record<string, unknown> | undefined;
  const vocab = o.vocabulary as Record<string, unknown> | undefined;
  return {
    voice: {
      tone: typeof voice?.tone === "string" ? voice.tone : "",
      style: typeof voice?.style === "string" ? voice.style : "",
    },
    vocabulary: {
      // Defensive parse handles legacy snapshots (string[]) AND the
      // current shape ({term, kind}[]). Either is converted to entries
      // with a nullable kind. New writes always use the entry shape.
      coined: normalizeVocabBucket(vocab?.coined),
      grounded: normalizeVocabBucket(vocab?.grounded),
      ai: normalizeVocabBucket(vocab?.ai),
    },
    tensions: Array.isArray(o.tensions)
      ? (o.tensions as unknown[]).filter(
          (s): s is string => typeof s === "string",
        )
      : [],
    sources: Array.isArray(o.sources)
      ? (o.sources as unknown[])
          .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
          .map((s) => ({
            ingestedFileId:
              typeof s.ingestedFileId === "string" ? s.ingestedFileId : "",
            objectId: typeof s.objectId === "string" ? s.objectId : null,
            name: typeof s.name === "string" ? s.name : "Untitled",
            thumbUrl: typeof s.thumbUrl === "string" ? s.thumbUrl : null,
            sourceUrl: typeof s.sourceUrl === "string" ? s.sourceUrl : null,
            sourceType: typeof s.sourceType === "string" ? s.sourceType : null,
            conceptSlugs: Array.isArray(s.conceptSlugs)
              ? (s.conceptSlugs as unknown[]).filter(
                  (x): x is string => typeof x === "string",
                )
              : [],
            palette: Array.isArray(s.palette)
              ? (s.palette as unknown[]).filter(isHex).slice(0, 4)
              : [],
            patterns: Array.isArray(s.patterns)
              ? (s.patterns as unknown[])
                  .filter((x): x is string => typeof x === "string")
                  .slice(0, 4)
              : [],
          }))
          .filter((s) => s.ingestedFileId)
      : [],
    no_gos: Array.isArray(o.no_gos)
      ? (o.no_gos as unknown[]).filter(
          (s): s is string => typeof s === "string",
        )
      : [],
    style_synthesis: normalizeStyleSynthesis(o.style_synthesis),
    pinned:
      o.pinned && typeof o.pinned === "object"
        ? (o.pinned as Partial<Record<TasteSection, boolean>>)
        : {},
    generated_at:
      typeof o.generated_at === "string"
        ? o.generated_at
        : new Date(0).toISOString(),
    thin_signal: o.thin_signal === true,
  };
}

/** Accept either legacy (string[]) or current ({term, kind}[]) — first
 *  paint after the kind axis lands sees mixed-shape snapshots. */
function normalizeVocabBucket(raw: unknown): TasteVocabEntry[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .map((v): TasteVocabEntry | null => {
      if (typeof v === "string") {
        return v.trim() ? { term: v.trim(), kind: null } : null;
      }
      if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        const term = typeof o.term === "string" ? o.term.trim() : "";
        if (!term) return null;
        return { term, kind: asGlossaryKind(o.kind) };
      }
      return null;
    })
    .filter((e): e is TasteVocabEntry => e !== null);
}

export { SOURCE_REF as TASTE_PROFILE_SOURCE_REF, PROFILE_TITLE as TASTE_PROFILE_TITLE };

// ── style_synthesis aggregator ──────────────────────────────────────
//
// Pure rollup of per-image style_analysis into a per-space visual style
// profile. No LLM cost. Idempotent. Two-pass:
//   pass 1: walk image_source.content_snapshot.style_analysis blobs
//           and collect: palette pool (with prominence weights),
//           per-enum vote counts, per-pattern occurrence counts
//   pass 2: derive: palette (frequency-bucketed top-k after dedup by
//           perceptual distance), enums (majority vote or "mixed"
//           on no clear winner), patterns (any with count ≥ 2),
//           signal_strength (count × agreement)
//
// Defensive throughout — a malformed per-image blob is just skipped, no
// throw.

interface RawStyleAnalysis {
  palette?: {
    dominant?: unknown;
    accent?: unknown;
    temperature?: unknown;
    contrast?: unknown;
  };
  typography?: {
    weight_range?: unknown;
    scale_contrast?: unknown;
    voice?: unknown;
  };
  composition?: {
    density?: unknown;
    grid?: unknown;
    hierarchy?: unknown;
  };
  patterns?: unknown;
  motion_cues?: unknown;
}

/** Read style_analysis off each row's content_snapshot. Soft-skips any
 *  row whose snapshot is malformed or whose analysis is empty. */
export function extractStyleAnalyses(
  rows: Array<{ content_snapshot?: unknown }>,
): RawStyleAnalysis[] {
  const out: RawStyleAnalysis[] = [];
  for (const r of rows) {
    const snap = r?.content_snapshot;
    if (!snap || typeof snap !== "object") continue;
    const sa = (snap as Record<string, unknown>).style_analysis;
    if (!sa || typeof sa !== "object") continue;
    out.push(sa as RawStyleAnalysis);
  }
  return out;
}

const HEX_RE = /^#[0-9a-f]{6}$/;

function isHex(v: unknown): v is string {
  return typeof v === "string" && HEX_RE.test(v);
}

function readStringArray(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, cap);
}

/** Cheap perceptual-distance check on two #rrggbb hex codes. Squared RGB
 *  Euclidean — good enough to bucket "near-duplicate" colors without
 *  pulling in a Lab converter. Threshold tuned so e.g. #fafafa and
 *  #ffffff collapse but accent reds stay distinct from primary blues. */
function hexDistanceSq(a: string, b: string): number {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  return (ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2;
}
const NEAR_DUP_THRESHOLD_SQ = 900; // ~ΔE 30 in plain RGB space

/** Pick the top-K hex codes by aggregate weight, collapsing near-duplicates.
 *  Each input is { hex, weight }; near-duplicates merge into the heavier
 *  one. Returns up to `k` codes ordered by collapsed weight desc. */
function pickTopColors(
  input: Array<{ hex: string; weight: number }>,
  k: number,
): string[] {
  const merged: Array<{ hex: string; weight: number }> = [];
  for (const c of input) {
    const dup = merged.find(
      (m) => hexDistanceSq(m.hex, c.hex) < NEAR_DUP_THRESHOLD_SQ,
    );
    if (dup) {
      if (c.weight > dup.weight) dup.hex = c.hex;
      dup.weight += c.weight;
    } else {
      merged.push({ hex: c.hex, weight: c.weight });
    }
  }
  merged.sort((a, b) => b.weight - a.weight);
  return merged.slice(0, k).map((c) => c.hex);
}

/** Vote-count → winner or "mixed". `mixedWhen` is the relative gap (top
 *  vs runner-up) below which the result is "mixed" instead of the leader.
 *  Default 0.4 — leader needs ≥40% margin to claim the axis. */
function majorityVote<T extends string>(
  votes: Map<T, number>,
  fallback: T,
  mixedValue: T,
  mixedWhen = 0.4,
): { winner: T; agreement: number } {
  const entries = Array.from(votes.entries())
    .filter(([k]) => k !== ("unknown" as T))
    .sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return { winner: fallback, agreement: 0 };
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return { winner: fallback, agreement: 0 };
  const [topKey, topCount] = entries[0];
  const runnerUp = entries[1]?.[1] ?? 0;
  const lead = (topCount - runnerUp) / total;
  if (entries.length > 1 && lead < mixedWhen) {
    return { winner: mixedValue, agreement: lead };
  }
  return { winner: topKey, agreement: topCount / total };
}

/** Map a hex code's R+G+B contribution into a rough temperature vote. Used
 *  as a tiebreaker when no per-image temperature axis was emitted. */
function inferTempFromHex(hex: string): "warm" | "neutral" | "cool" {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 18) return "neutral";
  if (r >= b + 24) return "warm";
  if (b >= r + 24) return "cool";
  return "neutral";
}

/** The aggregator. Pure given input rows. Returns EMPTY_STYLE_SYNTHESIS
 *  when no row contributed an analysis. */
export function aggregateStyleSynthesis(
  rows: Array<{ content_snapshot?: unknown }>,
): StyleSynthesis {
  const analyses = extractStyleAnalyses(rows);
  if (analyses.length === 0) return EMPTY_STYLE_SYNTHESIS;

  // Palette: weighted vote. Dominant entries weight 2× over accent entries.
  // Order-in-list weight ramps: a 1st-position color counts more than 4th.
  const dominantPool: Array<{ hex: string; weight: number }> = [];
  const accentPool: Array<{ hex: string; weight: number }> = [];
  for (const a of analyses) {
    const dominant = Array.isArray(a.palette?.dominant) ? a.palette.dominant : [];
    dominant.forEach((h, i) => {
      if (isHex(h)) dominantPool.push({ hex: h, weight: 2 * (4 - Math.min(i, 3)) });
    });
    const accent = Array.isArray(a.palette?.accent) ? a.palette.accent : [];
    accent.forEach((h, i) => {
      if (isHex(h)) accentPool.push({ hex: h, weight: 4 - Math.min(i, 3) });
    });
  }
  const dominant_palette = pickTopColors(dominantPool, 4);
  const accent_palette = pickTopColors(accentPool, 2);

  // Per-axis votes.
  const tempVotes = new Map<
    "warm" | "neutral" | "cool" | "mixed" | "unknown",
    number
  >();
  const voiceVotes = new Map<
    | "humanist"
    | "geometric"
    | "monospaced"
    | "serif"
    | "mixed"
    | "unknown",
    number
  >();
  const densityVotes = new Map<
    "sparse" | "balanced" | "dense" | "unknown",
    number
  >();
  const gridVotes = new Map<
    "rigid" | "loose" | "asymmetric" | "unknown",
    number
  >();
  const patternCounts = new Map<string, number>();
  const motionCounts = new Map<string, number>();

  for (const a of analyses) {
    const t = a.palette?.temperature;
    if (typeof t === "string") tempVotes.set(t as never, (tempVotes.get(t as never) ?? 0) + 1);
    const v = a.typography?.voice;
    if (typeof v === "string") voiceVotes.set(v as never, (voiceVotes.get(v as never) ?? 0) + 1);
    const d = a.composition?.density;
    if (typeof d === "string") densityVotes.set(d as never, (densityVotes.get(d as never) ?? 0) + 1);
    const g = a.composition?.grid;
    if (typeof g === "string") gridVotes.set(g as never, (gridVotes.get(g as never) ?? 0) + 1);
    for (const p of readStringArray(a.patterns, 6)) {
      patternCounts.set(p, (patternCounts.get(p) ?? 0) + 1);
    }
    for (const m of readStringArray(a.motion_cues, 4)) {
      motionCounts.set(m, (motionCounts.get(m) ?? 0) + 1);
    }
  }

  // Tiebreaker on temperature: if the model said "unknown" everywhere but
  // we picked a clear dominant palette, infer from hex.
  let { winner: palette_temperature, agreement: tempAgree } = majorityVote(
    tempVotes,
    "unknown",
    "mixed",
  );
  if (palette_temperature === "unknown" && dominant_palette.length > 0) {
    const inferred = new Map<"warm" | "neutral" | "cool", number>();
    for (const hex of dominant_palette) {
      const t = inferTempFromHex(hex);
      inferred.set(t, (inferred.get(t) ?? 0) + 1);
    }
    const sorted = Array.from(inferred.entries()).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) palette_temperature = sorted[0][0];
  }

  const { winner: typography_voice, agreement: voiceAgree } = majorityVote(
    voiceVotes,
    "unknown",
    "mixed",
  );
  const { winner: composition_density, agreement: densityAgree } = majorityVote(
    densityVotes,
    "unknown",
    "balanced",
    0.3,
  );
  const { winner: composition_grid, agreement: gridAgree } = majorityVote(
    gridVotes,
    "unknown",
    "loose",
    0.3,
  );

  // Recurring patterns: anything appearing in ≥2 sources, ordered by count.
  const recurring_patterns = Array.from(patternCounts.entries())
    .filter(([, c]) => c >= 2 || (analyses.length === 1 && c >= 1))
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p)
    .slice(0, 6);

  // Motion: same recurrence rule.
  const motion_cues = Array.from(motionCounts.entries())
    .filter(([, c]) => c >= 2 || (analyses.length === 1 && c >= 1))
    .sort((a, b) => b[1] - a[1])
    .map(([m]) => m)
    .slice(0, 4);

  // signal_strength: count × agreement.
  //   n=1 → 0.30  ·  n=2 → 0.55  ·  n=3 → 0.75  ·  n≥4 → 0.90
  //   × mean(temp,voice,density,grid agreement) clamped to [0.5,1]
  const n = analyses.length;
  const countScore =
    n === 0 ? 0 : n === 1 ? 0.3 : n === 2 ? 0.55 : n === 3 ? 0.75 : 0.9;
  const agreements = [tempAgree, voiceAgree, densityAgree, gridAgree].filter(
    (x) => x > 0,
  );
  const agreementScore =
    agreements.length === 0
      ? 0.7
      : Math.max(
          0.5,
          Math.min(1, agreements.reduce((s, x) => s + x, 0) / agreements.length),
        );
  const signal_strength = Math.round(countScore * agreementScore * 100) / 100;

  return {
    dominant_palette,
    accent_palette,
    palette_temperature,
    typography_voice,
    composition_density,
    composition_grid,
    recurring_patterns,
    motion_cues,
    signal_strength,
    source_count: n,
  };
}

/** Defensive parser — accepts whatever's on the persisted snapshot. */
export function normalizeStyleSynthesis(raw: unknown): StyleSynthesis {
  if (!raw || typeof raw !== "object") return EMPTY_STYLE_SYNTHESIS;
  const o = raw as Record<string, unknown>;
  const dominant = Array.isArray(o.dominant_palette)
    ? (o.dominant_palette as unknown[]).filter(isHex).slice(0, 4)
    : [];
  const accent = Array.isArray(o.accent_palette)
    ? (o.accent_palette as unknown[]).filter(isHex).slice(0, 2)
    : [];
  const temp =
    typeof o.palette_temperature === "string" &&
    ["warm", "neutral", "cool", "mixed", "unknown"].includes(o.palette_temperature)
      ? (o.palette_temperature as StyleSynthesis["palette_temperature"])
      : "unknown";
  const voice =
    typeof o.typography_voice === "string" &&
    [
      "humanist",
      "geometric",
      "monospaced",
      "serif",
      "mixed",
      "unknown",
    ].includes(o.typography_voice)
      ? (o.typography_voice as StyleSynthesis["typography_voice"])
      : "unknown";
  const density =
    typeof o.composition_density === "string" &&
    ["sparse", "balanced", "dense", "unknown"].includes(o.composition_density)
      ? (o.composition_density as StyleSynthesis["composition_density"])
      : "unknown";
  const grid =
    typeof o.composition_grid === "string" &&
    ["rigid", "loose", "asymmetric", "unknown"].includes(o.composition_grid)
      ? (o.composition_grid as StyleSynthesis["composition_grid"])
      : "unknown";
  const signal =
    typeof o.signal_strength === "number" && Number.isFinite(o.signal_strength)
      ? Math.max(0, Math.min(1, o.signal_strength))
      : 0;
  const count =
    typeof o.source_count === "number" && o.source_count >= 0
      ? Math.floor(o.source_count)
      : 0;
  return {
    dominant_palette: dominant,
    accent_palette: accent,
    palette_temperature: temp,
    typography_voice: voice,
    composition_density: density,
    composition_grid: grid,
    recurring_patterns: Array.isArray(o.recurring_patterns)
      ? (o.recurring_patterns as unknown[])
          .filter((s): s is string => typeof s === "string")
          .slice(0, 6)
      : [],
    motion_cues: Array.isArray(o.motion_cues)
      ? (o.motion_cues as unknown[])
          .filter((s): s is string => typeof s === "string")
          .slice(0, 4)
      : [],
    signal_strength: signal,
    source_count: count,
  };
}

/** Convenience: read all image_source rows for a space and aggregate.
 *  Soft-fail to EMPTY_STYLE_SYNTHESIS on any DB error. */
export async function aggregateStyleSynthesisForSpace(
  db: AnyDb,
  spaceId: string,
): Promise<StyleSynthesis> {
  try {
    const { data } = await db
      .from("library_objects")
      .select("content_snapshot")
      .eq("space_id", spaceId)
      .eq("object_type", "image_source");
    const rows = (data as Array<{ content_snapshot?: unknown }> | null) ?? [];
    return aggregateStyleSynthesis(rows);
  } catch (err) {
    console.warn(
      "[taste-profile] aggregateStyleSynthesisForSpace failed (soft):",
      err,
    );
    return EMPTY_STYLE_SYNTHESIS;
  }
}
