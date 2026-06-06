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
  | "no_gos";

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
  name: string;
  thumbUrl: string | null;
  /** Concept slugs this source contributed. */
  conceptSlugs: string[];
}

/** The full content_snapshot stashed on the taste_profile row. */
export interface TasteProfileSnapshot {
  voice: TasteVoice;
  vocabulary: TasteVocab;
  tensions: string[];
  sources: TasteSource[];
  no_gos: string[];
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

const EMPTY_SNAPSHOT: TasteProfileSnapshot = {
  voice: EMPTY_VOICE,
  vocabulary: { coined: [], grounded: [], ai: [] },
  tensions: [],
  sources: [],
  no_gos: [],
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
  image_concepts: unknown;
}

/** Map analyzed images → TasteSource[]. */
export function readSources(images: ImageSourceRow[]): TasteSource[] {
  return images.slice(0, 12).map((img) => ({
    ingestedFileId: img.id,
    name: img.source_name?.trim() || "Untitled image",
    thumbUrl: img.image_url,
    conceptSlugs: Array.isArray(img.image_concepts)
      ? (img.image_concepts as unknown[]).filter(
          (s): s is string => typeof s === "string",
        )
      : [],
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
            name: typeof s.name === "string" ? s.name : "Untitled",
            thumbUrl: typeof s.thumbUrl === "string" ? s.thumbUrl : null,
            conceptSlugs: Array.isArray(s.conceptSlugs)
              ? (s.conceptSlugs as unknown[]).filter(
                  (x): x is string => typeof x === "string",
                )
              : [],
          }))
          .filter((s) => s.ingestedFileId)
      : [],
    no_gos: Array.isArray(o.no_gos)
      ? (o.no_gos as unknown[]).filter(
          (s): s is string => typeof s === "string",
        )
      : [],
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
