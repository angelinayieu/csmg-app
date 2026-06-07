// ── Read / cache micro-objectives for a card ──────────────────────────
//
// Three storage tiers, in priority order:
//
//   1. library_objects.micro_objectives (TOP-LEVEL JSONB COLUMN — preferred)
//      — Migration 20260929 added this so cross-card queries ("every card
//        laddering into factor X") don't need to JSON-unpack every row.
//        GIN-indexed. The authoritative reader from here on.
//
//   2. library_objects.content_snapshot.micro_objectives (back-compat)
//      — Where the parallel session's first-pass writer put it. We still
//        READ from here if the new column is empty (no-op silently after
//        a row migrates forward on next derive).
//
//   3. spaces.synthesis_data.objective_canvas.card_micro_objectives[cardId]
//      — Fallback for board-only shapes that aren't (yet) in library_objects
//        (raw post-it notes, free-text, image cards). Matches the existing
//        voice_notes / prompt_sharpening / journal pattern.
//
// `getMicroObjectives` walks these in order, returns null if none has
// fresh content for `card`. `cacheMicroObjectives` writes to (1) AND (2)
// when the card is library-backed (one cycle of dual-write back-compat
// with the parallel session); otherwise to (3).
//
// All fns are SOFT-FAIL (try/catch → null/no-op) so they're safe to call
// before any migration, and a write failure never blocks the synth call.

import type { SupabaseClient } from "@supabase/supabase-js";
import { mergeObjectContentSnapshot } from "./library-objects";
import {
  type CardMicroObjectivesArtifact,
  isMicroObjectivesArtifactFresh,
} from "./derive-micro-objectives";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

/** Where did the cached artifact come from?  Lets callers debug / log the
 *  resolution path without re-querying. */
export type MicroObjectivesSource = "library_objects" | "synthesis_data" | null;

export interface ResolvedMicros {
  artifact: CardMicroObjectivesArtifact | null;
  source: MicroObjectivesSource;
  /** When the card is library-backed, the row id. Lets the caller pick a
   *  cache-write target without re-resolving. Null for shape-only cards. */
  libraryObjectId: string | null;
}

interface SynthesisDataLike {
  objective_canvas?: {
    card_micro_objectives?: Record<string, unknown>;
  } & Record<string, unknown>;
}

interface LibObjLookup {
  id: string;
  /** Top-level micro_objectives column (preferred read) — null when the
   *  card has never had micros derived OR pre-dates the 20260929 migration. */
  microObjectives: CardMicroObjectivesArtifact | null;
  /** Back-compat read from content_snapshot.micro_objectives. */
  fromContentSnapshot: CardMicroObjectivesArtifact | null;
  contentSnapshot: Record<string, unknown> | null;
}

/** Try `library_objects` first by id, then by board_shape_id. Returns the
 *  row's id + both micro-objective sources (the new top-level column AND
 *  the back-compat content_snapshot field) + content_snapshot for the
 *  back-compat writer. Null if not found / soft-fail. */
async function findLibraryObject(
  db: AnyDb,
  cardId: string,
): Promise<LibObjLookup | null> {
  const cols = "id, micro_objectives, content_snapshot";
  const project = (data: Record<string, unknown>): LibObjLookup => {
    const cs =
      typeof data.content_snapshot === "object" && data.content_snapshot
        ? (data.content_snapshot as Record<string, unknown>)
        : null;
    return {
      id: data.id as string,
      microObjectives:
        data.micro_objectives && typeof data.micro_objectives === "object"
          ? (data.micro_objectives as CardMicroObjectivesArtifact)
          : null,
      fromContentSnapshot:
        cs && cs.micro_objectives && typeof cs.micro_objectives === "object"
          ? (cs.micro_objectives as CardMicroObjectivesArtifact)
          : null,
      contentSnapshot: cs,
    };
  };
  try {
    // Try treating cardId as a library_objects.id first.
    {
      const { data } = await db
        .from("library_objects")
        .select(cols)
        .eq("id", cardId)
        .maybeSingle();
      if (data?.id) return project(data as Record<string, unknown>);
    }
    // Fallback: it might be a tldraw shape id stamped on the row.
    {
      const { data } = await db
        .from("library_objects")
        .select(cols)
        .eq("board_shape_id", cardId)
        .maybeSingle();
      if (data?.id) return project(data as Record<string, unknown>);
    }
    return null;
  } catch (err) {
    // Pre-migration: the `micro_objectives` column might not exist yet.
    // Retry with the legacy projection so the rest of the read path works.
    try {
      const cols2 = "id, content_snapshot";
      const { data } = await db
        .from("library_objects")
        .select(cols2)
        .eq("id", cardId)
        .maybeSingle();
      if (data?.id) {
        const cs =
          typeof data.content_snapshot === "object" && data.content_snapshot
            ? (data.content_snapshot as Record<string, unknown>)
            : null;
        return {
          id: data.id as string,
          microObjectives: null,
          fromContentSnapshot:
            cs && cs.micro_objectives && typeof cs.micro_objectives === "object"
              ? (cs.micro_objectives as CardMicroObjectivesArtifact)
              : null,
          contentSnapshot: cs,
        };
      }
    } catch {
      /* fall through */
    }
    console.warn("[get-micro-objectives] findLibraryObject failed:", err);
    return null;
  }
}

/** Read the shape-only fallback map under synthesis_data.objective_canvas. */
async function readSpaceFallback(
  db: AnyDb,
  spaceId: string,
  cardId: string,
): Promise<CardMicroObjectivesArtifact | null> {
  try {
    const { data } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const sd = (data?.synthesis_data ?? null) as SynthesisDataLike | null;
    const map = sd?.objective_canvas?.card_micro_objectives;
    if (!map || typeof map !== "object") return null;
    const hit = (map as Record<string, unknown>)[cardId];
    if (!hit || typeof hit !== "object") return null;
    return hit as CardMicroObjectivesArtifact;
  } catch (err) {
    console.warn("[get-micro-objectives] readSpaceFallback failed:", err);
    return null;
  }
}

/** Resolve the cached micro-objectives artifact for `cardId` in `spaceId`.
 *  Returns the artifact AND the source so a caller that needs to refresh
 *  can write to the right place without re-resolving. Stale artifacts
 *  (model bump or card-body diff) are treated as miss. */
export async function getMicroObjectives(
  db: AnyDb,
  spaceId: string,
  cardId: string,
  card: { headline: string; body: string },
): Promise<ResolvedMicros> {
  // 1. library_objects — prefer the new top-level column, fall back to
  //    content_snapshot for rows the parallel session wrote before the
  //    20260929 migration.
  const lib = await findLibraryObject(db, cardId);
  if (lib) {
    if (lib.microObjectives && isMicroObjectivesArtifactFresh(lib.microObjectives, card)) {
      return {
        artifact: lib.microObjectives,
        source: "library_objects",
        libraryObjectId: lib.id,
      };
    }
    if (
      lib.fromContentSnapshot &&
      isMicroObjectivesArtifactFresh(lib.fromContentSnapshot, card)
    ) {
      return {
        artifact: lib.fromContentSnapshot,
        source: "library_objects",
        libraryObjectId: lib.id,
      };
    }
    // Library-backed card with no (or stale) cache — return null but remember
    // the row id so the writer can target it.
    return { artifact: null, source: null, libraryObjectId: lib.id };
  }

  // 2. synthesis_data fallback (shape-only cards)
  const fallback = await readSpaceFallback(db, spaceId, cardId);
  if (fallback && isMicroObjectivesArtifactFresh(fallback, card)) {
    return {
      artifact: fallback,
      source: "synthesis_data",
      libraryObjectId: null,
    };
  }
  return { artifact: null, source: null, libraryObjectId: null };
}

/** Write a fresh artifact to its preferred storage tier. Library-backed
 *  cards dual-write to BOTH (a) the new top-level column and (b)
 *  content_snapshot.micro_objectives — (b) is back-compat for one cycle so
 *  readers in the parallel-session writer's surfaces stay green. Shape-only
 *  cards go into synthesis_data.objective_canvas.card_micro_objectives[cardId].
 *  Each write is independently soft-fail (the column write surviving a
 *  content_snapshot failure, and vice versa). */
export async function cacheMicroObjectives(
  db: AnyDb,
  spaceId: string,
  cardId: string,
  artifact: CardMicroObjectivesArtifact,
  libraryObjectId: string | null,
): Promise<void> {
  if (libraryObjectId) {
    // (a) Top-level column — authoritative reader.
    try {
      await db
        .from("library_objects")
        .update({
          micro_objectives: artifact,
          updated_at: new Date().toISOString(),
        })
        .eq("id", libraryObjectId);
    } catch (err) {
      console.warn(
        "[get-micro-objectives] top-level column write failed (soft):",
        err,
      );
    }
    // (b) Back-compat content_snapshot mirror.
    await mergeObjectContentSnapshot(db, libraryObjectId, {
      micro_objectives: artifact,
    });
    return;
  }

  // Shape-only fallback: patch the keyed map under objective_canvas.
  try {
    const { data } = await db
      .from("spaces")
      .select("synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    const sd: SynthesisDataLike =
      (data?.synthesis_data as SynthesisDataLike | null) ?? {};
    const oc = (sd.objective_canvas ?? {}) as Record<string, unknown>;
    const existing =
      typeof oc.card_micro_objectives === "object" && oc.card_micro_objectives
        ? (oc.card_micro_objectives as Record<string, unknown>)
        : {};
    const next = { ...existing, [cardId]: artifact };
    await db
      .from("spaces")
      .update({
        synthesis_data: {
          ...(sd as Record<string, unknown>),
          objective_canvas: {
            ...oc,
            card_micro_objectives: next,
          },
        },
      })
      .eq("id", spaceId);
  } catch (err) {
    console.warn("[get-micro-objectives] cacheMicroObjectives fallback failed:", err);
  }
}
