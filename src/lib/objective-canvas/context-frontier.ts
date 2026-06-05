// ── Context Frontier — Phase 0 substrate (CONTEXT_FRONTIER_PLAN.md) ────
//
// A first-class home for the user's PRIOR context/ideas, modelled as ROWS in
// the object layer (NOT in synthesis_data, which is overwrite-in-place + clobbers
// parallel sessions). Everything here is additive + soft-fail + migration-free:
//
//   improvement_goals (root objective)            ← unchanged
//      └─ library_objects (object_type='context_anchor')   ← companion to root
//           ├─ library_object_sources ──→ ingested_files   (each pasted/uploaded block)
//           │     role = 'prior_ideas' | 'reference'
//           ├─ library_object_notes      (kind='idea'|'intention'|'taste')
//           └─ object_links (relation='derived_from')
//                 └─ library_objects (object_type='context_concept', one per ContextConcept)
//
// `library_object_sources` + `library_object_notes` shipped in 20260917 with RLS
// but ZERO writers — this module is their first writer. The concept rows join the
// same `concept_slug` namespace as objective annotations + glossary (stored in
// content_snapshot here; library_objects has no concept_slug column).
//
// Phase 0 = writers + the scope reader. Consumers (extraction pass, decompose
// covered-frontier block, snapshot harvest of stickies/voice) land in later phases.

import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertLibraryObject, linkObjects } from "./library-objects";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

/** surpass vs honor — the split that powers anti-echo (prior_ideas) vs grounding (reference). */
export type ContextRole = "prior_ideas" | "reference";

/** The unit of extracted context. One becomes a `context_concept` library_object. */
export interface ContextConcept {
  /** Canonical noun phrase (≤4 words). */
  concept: string;
  /** SAME slug space as annotations + glossary — the cross-surface dedupe key. */
  concept_slug: string;
  kind: "idea" | "constraint" | "fact" | "question";
  role: ContextRole;
  /** 1 line — what the user already said/meant. */
  summary: string;
  /** Trace-back to the raw block (for the "from your context" chip + underline). */
  source_ingested_file_id: string | null;
  /** Verbatim span the concept was lifted from. */
  source_phrase: string | null;
}

/** What `getObjectiveContextScope` returns — the accumulating context the
 *  generators diff against. `priorIdeas` = surpass; `reference` = honor. */
export interface ObjectiveContextScope {
  anchorId: string | null;
  priorIdeas: ContextConcept[];
  reference: ContextConcept[];
}

const ANCHOR_SOURCE_REF = "context-anchor";

/** content_snapshot shape stashed on a `context_concept` row (library_objects
 *  has no dedicated columns for these — the JSONB blob is the metadata home,
 *  consistent with how the object layer stores card_face / evaluation). */
interface ConceptSnapshot {
  concept_slug: string;
  kind: ContextConcept["kind"];
  role: ContextRole;
  source_phrase: string | null;
  source_ingested_file_id: string | null;
}

/**
 * Find-or-create the per-space intake context anchor. Idempotent on the natural
 * key (space, type='context_anchor', source_ref='context-anchor'). Companion to
 * the root goal — does NOT touch root resolution. Returns the anchor object id,
 * or null on soft-fail (e.g. table not migrated).
 */
export async function ensureContextAnchor(
  db: AnyDb,
  args: { spaceId: string; userId: string; rootGoalId?: string | null },
): Promise<string | null> {
  return upsertLibraryObject(db, {
    spaceId: args.spaceId,
    userId: args.userId,
    objectType: "context_anchor",
    title: "Context",
    summary: "User-supplied prior context, ideas, and reference material for this objective.",
    sourceRef: ANCHOR_SOURCE_REF,
    sourceSubObjectiveId: args.rootGoalId ?? null,
  });
}

/**
 * Attach an ingested file (pasted text / uploaded doc / url / image) to the
 * context anchor as a source. First writer of `library_object_sources`.
 * Idempotent on UNIQUE(object_id, ingested_file_id).
 */
export async function addContextSource(
  db: AnyDb,
  args: {
    anchorId: string;
    userId: string;
    ingestedFileId: string;
    role: ContextRole;
  },
): Promise<void> {
  try {
    await db.from("library_object_sources").upsert(
      {
        user_id: args.userId,
        object_id: args.anchorId,
        ingested_file_id: args.ingestedFileId,
        role: args.role,
      },
      { onConflict: "object_id,ingested_file_id" },
    );
  } catch (err) {
    console.warn("[context-frontier] addContextSource failed (soft):", err);
  }
}

/**
 * Record a free-text idea / intention / taste note on the context anchor.
 * First writer of `library_object_notes` (kind CHECK already allows these).
 */
export async function addContextNote(
  db: AnyDb,
  args: {
    anchorId: string;
    userId: string;
    kind: "idea" | "intention" | "taste" | "note";
    text: string;
  },
): Promise<void> {
  try {
    await db.from("library_object_notes").insert({
      user_id: args.userId,
      object_id: args.anchorId,
      kind: args.kind,
      text: args.text,
    });
  } catch (err) {
    console.warn("[context-frontier] addContextNote failed (soft):", err);
  }
}

/**
 * Persist one extracted ContextConcept as a `context_concept` library_object
 * linked `derived_from` the anchor. Idempotent per concept_slug, so re-running
 * the extraction pass updates rather than duplicates. Returns the concept
 * object id (or null on soft-fail).
 */
export async function recordContextConcept(
  db: AnyDb,
  args: {
    spaceId: string;
    userId: string;
    anchorId: string;
    concept: ContextConcept;
  },
): Promise<string | null> {
  const snapshot: ConceptSnapshot = {
    concept_slug: args.concept.concept_slug,
    kind: args.concept.kind,
    role: args.concept.role,
    source_phrase: args.concept.source_phrase,
    source_ingested_file_id: args.concept.source_ingested_file_id,
  };
  const objectId = await upsertLibraryObject(db, {
    spaceId: args.spaceId,
    userId: args.userId,
    objectType: "context_concept",
    title: args.concept.concept,
    summary: args.concept.summary,
    // Stable per-concept ref → idempotent re-extraction.
    sourceRef: `ctx:${args.concept.concept_slug}`,
    contentSnapshot: snapshot,
  });
  if (objectId) {
    await linkObjects(db, {
      spaceId: args.spaceId,
      fromObjectId: objectId,
      toObjectId: args.anchorId,
      relation: "derived_from",
    });
  }
  return objectId;
}

/** Defensive parse of a context_concept row's content_snapshot → ContextConcept. */
function rowToConcept(row: {
  title: string;
  summary: string | null;
  content_snapshot?: unknown;
}): ContextConcept | null {
  const snap =
    row.content_snapshot && typeof row.content_snapshot === "object"
      ? (row.content_snapshot as Partial<ConceptSnapshot>)
      : null;
  if (!snap || typeof snap.concept_slug !== "string") return null;
  const role: ContextRole = snap.role === "reference" ? "reference" : "prior_ideas";
  const kind =
    snap.kind === "constraint" || snap.kind === "fact" || snap.kind === "question"
      ? snap.kind
      : "idea";
  return {
    concept: row.title,
    concept_slug: snap.concept_slug,
    kind,
    role,
    summary: row.summary ?? "",
    source_phrase: typeof snap.source_phrase === "string" ? snap.source_phrase : null,
    source_ingested_file_id:
      typeof snap.source_ingested_file_id === "string"
        ? snap.source_ingested_file_id
        : null,
  };
}

/**
 * The accumulating context scope for an objective — what the generators diff
 * against so decomposition AUGMENTS rather than repeats. Reads the row-backed
 * `context_concept` objects and splits them by role.
 *
 * NOTE (Phase 7): this is the single resolver §7 of the plan calls for. The
 * row-backed concepts are wired here; harvesting snapshot-only sources (tagged
 * stickies, committed voice transcripts) + folding in accepted insight/kept
 * cards is a deliberate later extension — callers get the durable concepts now
 * and the union grows without changing this signature.
 */
export async function getObjectiveContextScope(
  db: AnyDb,
  spaceId: string,
): Promise<ObjectiveContextScope> {
  const empty: ObjectiveContextScope = {
    anchorId: null,
    priorIdeas: [],
    reference: [],
  };
  try {
    const { data: anchor } = await db
      .from("library_objects")
      .select("id")
      .eq("space_id", spaceId)
      .eq("object_type", "context_anchor")
      .eq("source_ref", ANCHOR_SOURCE_REF)
      .maybeSingle();

    const { data: rows } = await db
      .from("library_objects")
      .select("title, summary, content_snapshot")
      .eq("space_id", spaceId)
      .eq("object_type", "context_concept");

    const concepts = ((rows as Array<{
      title: string;
      summary: string | null;
      content_snapshot?: unknown;
    }> | null) ?? [])
      .map(rowToConcept)
      .filter((c): c is ContextConcept => c !== null);

    return {
      anchorId: (anchor as { id: string } | null)?.id ?? null,
      priorIdeas: concepts.filter((c) => c.role === "prior_ideas"),
      reference: concepts.filter((c) => c.role === "reference"),
    };
  } catch (err) {
    console.warn("[context-frontier] getObjectiveContextScope failed (soft):", err);
    return empty;
  }
}
