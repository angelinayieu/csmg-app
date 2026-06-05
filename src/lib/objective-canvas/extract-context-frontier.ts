// ── extract-context-frontier — Phase 2 (CONTEXT_FRONTIER_PLAN.md) ──────
//
// Turns a block of the user's PRIOR material (pasted context, ideas they've
// already had, reference facts) into discrete, addressable metadata — one
// ContextConcept per idea/claim, joined to the objective's `concept_slug`
// namespace. This is the "text → metadata" pass: it makes the user's prior
// thinking diff-able so downstream generation can AUGMENT it instead of
// repeating it.
//
// Faithful extraction only — it lifts what the text ALREADY contains; it does
// NOT ideate (that's decompose's job, downstream, fed by the frontier this
// produces). Mirrors the depth/salience pass: sonnet-4-6, forced structured
// output, soft-fail throughout. Token usage is recorded by llmJSON against the
// active credit meter, same as every other pass.

import { llmJSON } from "../llm";
import { slugifyConcept } from "./normalize-annotations";
import {
  recordContextConcept,
  type ContextConcept,
  type ContextRole,
} from "./context-frontier";

const EXTRACT_MODEL = "claude-sonnet-4-6";

const SYSTEM = `You are the Context Frontier Analyst.

The user has supplied PRIOR material for an objective — context they've already written, ideas they've already considered, or reference facts. Extract the DISCRETE concepts the material ALREADY contains, so downstream work can build BEYOND them rather than restate them.

For each distinct concept / idea / claim, emit:
- concept — a canonical NOUN PHRASE naming the thing itself (≤4 words). Not a verb/action. Prefer the user's own wording.
- kind — one of:
    idea       — a solution, approach, or feature the user is proposing
    constraint — a hard limit, requirement, or non-negotiable the user states
    fact       — a stated background truth / given about their situation
    question   — an open question or uncertainty the user raises
- summary — ONE line: what the user actually said or meant about it.
- source_phrase — the exact verbatim span (quoted from the text) this was lifted from.

RULES:
- Extract only what is ALREADY in the text. NEVER invent a concept the text doesn't contain.
- One concept per distinct idea. Merge restatements; skip filler, pleasantries, and meta-commentary.
- Be faithful, not padded: 3–15 concepts depending on the material's real richness. Fewer is fine.
- Quote source_phrase verbatim so the UI can link the metadata back to the user's words.

Return strict JSON.`;

const RESPONSE_SCHEMA = {
  name: "context_frontier",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      concepts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            concept: { type: "string" },
            kind: {
              type: "string",
              enum: ["idea", "constraint", "fact", "question"],
            },
            summary: { type: "string" },
            source_phrase: { type: "string" },
          },
          required: ["concept", "kind", "summary", "source_phrase"],
        },
      },
    },
    required: ["concepts"],
  },
} as const;

interface RawConcept {
  concept?: unknown;
  kind?: unknown;
  summary?: unknown;
  source_phrase?: unknown;
}

function normalizeKind(k: unknown): ContextConcept["kind"] {
  return k === "constraint" || k === "fact" || k === "question" ? k : "idea";
}

/**
 * Extract ContextConcepts from one block of prior material. `role` is the
 * user's block-level intent (prior_ideas = surpass downstream; reference =
 * honor) and is stamped onto every concept. Soft-fails to [].
 */
export async function extractContextConcepts(
  text: string,
  role: ContextRole,
  sourceIngestedFileId: string | null,
): Promise<ContextConcept[]> {
  const trimmed = (text || "").trim();
  if (trimmed.length < 8) return [];
  try {
    const result = await llmJSON<{ concepts?: RawConcept[] }>({
      system: SYSTEM,
      user: `PRIOR MATERIAL (role: ${role}):\n"""\n${trimmed.slice(0, 12000)}\n"""\n\nReturn the context_frontier JSON.`,
      provider: "anthropic",
      model: EXTRACT_MODEL,
      maxTokens: 3000,
      responseSchema: RESPONSE_SCHEMA,
    });

    const items = Array.isArray(result?.concepts) ? result.concepts : [];
    const seen = new Set<string>();
    const out: ContextConcept[] = [];
    for (const it of items) {
      const concept =
        typeof it?.concept === "string" ? it.concept.trim().slice(0, 80) : "";
      if (!concept) continue;
      const concept_slug = slugifyConcept(concept);
      if (!concept_slug || seen.has(concept_slug)) continue;
      seen.add(concept_slug);
      out.push({
        concept,
        concept_slug,
        kind: normalizeKind(it?.kind),
        role,
        summary:
          typeof it?.summary === "string" ? it.summary.trim().slice(0, 280) : "",
        source_phrase:
          typeof it?.source_phrase === "string"
            ? it.source_phrase.trim().slice(0, 400)
            : null,
        source_ingested_file_id: sourceIngestedFileId,
      });
    }
    return out;
  } catch (err) {
    console.warn(
      "[context-frontier] extract failed (soft):",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

/**
 * Orchestrator the route fires post-response: read the block's text, extract
 * its concepts, and persist each as a `context_concept` library_object linked
 * to the anchor. Returns the number of concepts recorded. Soft-fail (0).
 */
export async function extractAndRecordContextBlock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  args: {
    spaceId: string;
    userId: string;
    anchorId: string;
    ingestedFileId: string;
    role: ContextRole;
    /** Pass the text directly to skip a re-read; otherwise read normalized_text. */
    text?: string | null;
  },
): Promise<number> {
  try {
    let text = args.text ?? null;
    if (!text) {
      const { data } = await db
        .from("ingested_files")
        .select("normalized_text")
        .eq("id", args.ingestedFileId)
        .maybeSingle();
      text = (data?.normalized_text as string | null) ?? null;
    }
    if (!text || text.trim().length < 8) return 0;

    const concepts = await extractContextConcepts(
      text,
      args.role,
      args.ingestedFileId,
    );
    let recorded = 0;
    for (const concept of concepts) {
      const id = await recordContextConcept(db, {
        spaceId: args.spaceId,
        userId: args.userId,
        anchorId: args.anchorId,
        concept,
      });
      if (id) recorded += 1;
    }
    return recorded;
  } catch (err) {
    console.warn(
      "[context-frontier] extractAndRecordContextBlock failed (soft):",
      err instanceof Error ? err.message : String(err),
    );
    return 0;
  }
}
