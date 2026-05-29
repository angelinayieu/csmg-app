// ── Context Glossary (Arc 3.5 / v2) ────────────────────────────────
//
// One SUSTAINED, ACCUMULATING reader dictionary for a space — the key
// domain terms a newcomer would need defined, each with a CONTEXT-
// SPECIFIC definition.
//
// v2 unifies it with the Annotation Lens. The lens already produces
// vetted, context-specific `reading`s for the objective's load-bearing
// phrases AND steers generation — so those readings are the
// AUTHORITATIVE definitions. The glossary now:
//   1. seeds authoritative terms straight from the annotation readings
//      (parent objective + sub-objectives),
//   2. runs ONE LLM pass to mine remaining entity jargon NOT already
//      covered, and
//   3. MERGES into the existing glossary — accumulating, never wiping —
//      with strict authority (user > annotation > entity > llm) so a
//      user-edited ("pinned") definition is immutable and the reader-
//      facing definition can never contradict what the generator uses.
//
// Storage: spaces.synthesis_data.glossary (JSONB, no migration).
// Soft-fail: a failed LLM pass just means no NEW entity terms this run;
// annotation seeds + existing terms still flow through.

import { llmJSON } from "@/lib/llm";

export type GlossarySource = "annotation" | "entity" | "llm" | "user";

export interface GlossaryTerm {
  /** The canonical term as it reads in the UI. */
  term: string;
  /** Context-specific definition — what it means in THIS project. */
  definition: string;
  /** Other surface forms the inline matcher should also catch. */
  aliases: string[];
  /** Provenance — drives precedence on merge + a UI tag. */
  source: GlossarySource;
  /** When source==="annotation", the lens phrase it came from. */
  annotation_phrase?: string;
  /** Layer the source annotation belongs to (pain/features/...). */
  layer_tag?: string | null;
  /** Inherited from the annotation weight — ranks inclusion + sort. */
  weight?: number;
  /** User-edited / confirmed → NEVER overwritten on regeneration. */
  pinned?: boolean;
  updated_at: string;
}

/** One annotation reading promoted to an authoritative glossary seed. */
export interface AnnotationSeed {
  phrase: string;
  reading: string;
  weight?: number;
  layer_tag?: string | null;
}

export interface GenerateGlossaryInput {
  coreObjectiveText: string;
  subObjectiveTitles: string[];
  /** Entity names (pains / features / outcomes) — jargon source. */
  entityNames: string[];
  /** Authoritative readings from the Annotation Lens (parent + subs),
   *  deduped by phrase upstream. Seeded first, never overwritten by
   *  the entity pass. */
  annotations: AnnotationSeed[];
  /** The current persisted glossary — merged into, not replaced. */
  existing: GlossaryTerm[];
  /** Item definitions for entities that have one
   *  (expanded_detail.definition). When a mined term NAMES one of these
   *  entities, its glossary definition must stay CONSISTENT with the
   *  item's canonical definition — the glossary adds project-context
   *  framing without contradicting it. Optional; the entity pass falls
   *  back to name-only mining when absent. This is the glossary's link
   *  into the single-source-of-truth DAG (item definition is canonical;
   *  the glossary references it for coincident terms). */
  entityDefinitions?: Array<{ name: string; definition: string }>;
}

const AUTHORITY: Record<GlossarySource, number> = {
  user: 4,
  annotation: 3,
  entity: 2,
  llm: 1,
};

const MAX_TERMS = 48;

const SYSTEM_PROMPT = `You extend a CONTEXT GLOSSARY for a strategy workspace — the key terms a smart newcomer to THIS specific objective needs defined to read the room without getting lost.

You'll be given the objective, the rooms/entities in play, and a list of terms ALREADY DEFINED. Your job: surface ONLY the terms that genuinely need defining and are NOT already covered.

For each NEW term:
- term: the canonical phrase as it appears.
- definition: 1-2 sentences. The meaning IN THIS PROJECT'S CONTEXT — not the generic dictionary sense.
- aliases: other surface forms (plural, acronym, close synonym). Empty array if none.

Rules:
- Do NOT repeat or trivially re-word any ALREADY DEFINED term — those are owned by the objective lens / prior runs.
- Pick domain jargon, acronyms, metrics, mechanism names, terms used in a non-obvious way. Skip common English ("user", "increase").
- DEDUPE: never emit two entries for the same concept.
- Be specific to the objective. ≤5 words per term. Emit 0 if everything important is already covered.
- CONSISTENCY WITH ITEM DEFINITIONS: some terms name a project ENTITY that already has a canonical item definition (shown under ENTITY DEFINITIONS, when provided). If you define such a term, your definition MUST be consistent with that item definition — add the cross-cutting / project-context angle, never contradict or override what the item says it is. Terms that are NOT entities (cross-cutting jargon, metrics, acronyms) you define freely as usual.

Return strict JSON. No prose outside the JSON.`;

const SCHEMA = {
  name: "context_glossary",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      terms: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            term: { type: "string" },
            definition: { type: "string" },
            aliases: { type: "array", items: { type: "string" } },
          },
          required: ["term", "definition", "aliases"],
        },
      },
    },
    required: ["terms"],
  },
};

/** Normalize a surface form for matching. */
const norm = (s: string) => s.trim().toLowerCase();

/** All lowercased surface forms (term + aliases) of a glossary term. */
function surfaces(t: { term: string; aliases?: string[] }): string[] {
  return [t.term, ...(t.aliases ?? [])].map(norm).filter(Boolean);
}

/** Find an existing term whose term/alias overlaps the incoming one. */
function findMatch(
  existing: GlossaryTerm[],
  incoming: { term: string; aliases?: string[] },
): GlossaryTerm | undefined {
  const inc = new Set(surfaces(incoming));
  return existing.find((e) => surfaces(e).some((s) => inc.has(s)));
}

/** Accumulate-merge: existing ⊕ incoming, with authority + pinned
 *  rules. Existing terms are preserved; incoming updates a term only
 *  when it's not pinned AND its source outranks (or the existing def is
 *  empty). New incoming terms are added. Capped by weight/recency. */
export function mergeGlossary(
  existing: GlossaryTerm[],
  incoming: GlossaryTerm[],
): GlossaryTerm[] {
  const out: GlossaryTerm[] = existing.map((t) => ({ ...t }));
  for (const inc of incoming) {
    const match = findMatch(out, inc);
    if (!match) {
      out.push(inc);
      continue;
    }
    if (match.pinned) continue; // user-owned — immutable
    const incRank = AUTHORITY[inc.source] ?? 1;
    const curRank = AUTHORITY[match.source] ?? 1;
    if (incRank >= curRank || !match.definition.trim()) {
      match.definition = inc.definition;
      match.source = inc.source;
      match.aliases = Array.from(
        new Set([...(match.aliases ?? []), ...(inc.aliases ?? [])]),
      ).slice(0, 6);
      match.annotation_phrase = inc.annotation_phrase ?? match.annotation_phrase;
      match.layer_tag = inc.layer_tag ?? match.layer_tag;
      match.weight = inc.weight ?? match.weight;
      match.updated_at = inc.updated_at;
    }
  }
  // Cap — keep pinned first, then by authority, weight, recency.
  out.sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    const ar = AUTHORITY[a.source] ?? 1;
    const br = AUTHORITY[b.source] ?? 1;
    if (br !== ar) return br - ar;
    const aw = a.weight ?? 0.5;
    const bw = b.weight ?? 0.5;
    if (bw !== aw) return bw - aw;
    return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
  });
  return out.slice(0, MAX_TERMS);
}

export async function generateGlossary(
  input: GenerateGlossaryInput,
): Promise<GlossaryTerm[]> {
  const now = new Date().toISOString();

  // ── 1. Authoritative seeds from the Annotation Lens readings ──
  const seeds: GlossaryTerm[] = [];
  const seedKeys = new Set<string>();
  for (const a of input.annotations) {
    const term = a.phrase?.trim().slice(0, 60) ?? "";
    const definition = a.reading?.trim().slice(0, 320) ?? "";
    if (!term || !definition) continue;
    const key = norm(term);
    if (seedKeys.has(key)) continue; // parent + sub readings can overlap
    seedKeys.add(key);
    seeds.push({
      term,
      definition,
      aliases: [],
      source: "annotation",
      annotation_phrase: a.phrase,
      layer_tag: a.layer_tag ?? null,
      weight: a.weight,
      updated_at: now,
    });
  }

  // ── 2. Entity-jargon LLM pass — told what's already covered ──
  // Covered = annotation seeds + existing terms, so the model only
  // proposes genuinely new jargon.
  const coveredSurfaces = new Set<string>([
    ...seeds.flatMap(surfaces),
    ...input.existing.flatMap(surfaces),
  ]);
  const coveredList = Array.from(
    new Set([
      ...seeds.map((s) => s.term),
      ...input.existing.map((e) => e.term),
    ]),
  ).slice(0, 60);

  const subs =
    input.subObjectiveTitles.length > 0
      ? `\n\nSUB-OBJECTIVES:\n${input.subObjectiveTitles
          .slice(0, 20)
          .map((s) => `  • ${s}`)
          .join("\n")}`
      : "";
  const ents =
    input.entityNames.length > 0
      ? `\n\nTERMS IN PLAY (mine jargon from these — problems, mechanisms, outcomes):\n${input.entityNames
          .slice(0, 80)
          .map((e) => `  • ${e}`)
          .join("\n")}`
      : "";
  const covered =
    coveredList.length > 0
      ? `\n\nALREADY DEFINED (do NOT repeat these or close variants):\n${coveredList
          .map((t) => `  • ${t}`)
          .join("\n")}`
      : "";

  // Item definitions for entity-coincident terms — the glossary stays
  // consistent with the canonical item definition (references it, adds
  // project context) rather than minting an independent one.
  const defs =
    input.entityDefinitions && input.entityDefinitions.length > 0
      ? `\n\nENTITY DEFINITIONS (if you define a term that NAMES one of these entities, stay consistent with its definition — add project context, don't contradict):\n${input.entityDefinitions
          .filter((e) => e.name?.trim() && e.definition?.trim())
          .slice(0, 30)
          .map((e) => `  • ${e.name}: ${e.definition.slice(0, 200)}`)
          .join("\n")}`
      : "";

  const user = `OBJECTIVE:\n"""\n${input.coreObjectiveText.slice(0, 1200)}\n"""${subs}${ents}${defs}${covered}\n\nAdd ONLY new terms not already defined. Dedupe aggressively. Emit 0 if everything important is covered.`;

  const entityTerms: GlossaryTerm[] = [];
  try {
    const raw = await llmJSON<{
      terms?: Array<{ term?: unknown; definition?: unknown; aliases?: unknown }>;
    }>({
      system: SYSTEM_PROMPT,
      user,
      responseSchema: SCHEMA,
      temperature: 0.3,
      maxTokens: 2200,
    });
    const seen = new Set<string>();
    for (const t of raw?.terms ?? []) {
      const term = typeof t?.term === "string" ? t.term.trim().slice(0, 60) : "";
      const definition =
        typeof t?.definition === "string"
          ? t.definition.trim().slice(0, 320)
          : "";
      if (!term || !definition) continue;
      const key = norm(term);
      if (seen.has(key) || coveredSurfaces.has(key)) continue; // already covered
      seen.add(key);
      const aliases = Array.isArray(t?.aliases)
        ? (t.aliases as unknown[])
            .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
            .map((a) => a.trim().slice(0, 60))
            .filter((a) => norm(a) !== key)
            .slice(0, 5)
        : [];
      entityTerms.push({
        term,
        definition,
        aliases,
        source: "entity",
        updated_at: now,
      });
    }
  } catch (err) {
    console.warn(
      "[generate-glossary] entity pass failed (soft-fail):",
      err instanceof Error ? err.message : String(err),
    );
    // Annotation seeds + existing still merge through below.
  }

  // ── 3. Accumulate-merge into the existing glossary ──
  return mergeGlossary(input.existing, [...seeds, ...entityTerms]);
}
