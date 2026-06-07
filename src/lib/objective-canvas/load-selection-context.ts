// ── Rich context for Deep Synthesize's selection ──────────────────────
//
// Today the synthesizer sees only `text` per selected shape. That misses
// everything the user has accumulated on a library_object — the per-card
// micros, the user's TASTE notes, attached papers/images, the depends_on
// graph — so synthesis runs shallow on rich cards.
//
// This loader, given a set of tldraw shape ids + the space, returns:
//   - the resolved library_objects.id (when the shape is library-backed)
//   - micros — the per-card success rubric (from the new top-level column
//     OR content_snapshot back-compat path)
//   - notes — user metadata (idea / intention / taste / note), most recent
//     first, capped at 4 entries per card so the prompt doesn't bloat
//   - sources — attached ingested_files (papers / images / refs) by title
//   - links — outbound object_links (depends_on / feeds / derived_from /
//     delivers / validates) so the synthesizer can reason about structure,
//     not just text
//
// All reads soft-fail to null/[] so a missing migration / missing row
// degrades to "we don't have rich context for this card" rather than 500.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardMicroObjectivesArtifact } from "./derive-micro-objectives";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

/** One enriched selection item — keyed by the tldraw shape id the client
 *  sent, with whatever library context we could resolve attached. The
 *  shape id is the stable handle the prompt + tether code both use. */
export interface EnrichedSelectionItem {
  shapeId: string;
  /** Resolved library_objects.id, or null when the shape isn't library-
   *  backed (a raw note, an unsaved image card, …). */
  libraryObjectId: string | null;
  /** library_objects.object_type when resolved — useful context for the
   *  prompt ("this is a feature" vs "this is a variable"). */
  objectType: string | null;
  /** The card's per-card success rubric, if cached. The synthesizer can
   *  cross-reference micros: a branch linking two cards that share a
   *  micro is structurally meaningful. */
  micros: { slug: string; label: string; laddersTo: string[] }[];
  /** User-authored metadata on this card. */
  notes: { kind: string; text: string }[];
  /** Titles of attached ingested_files (paper / image / reference), so the
   *  model knows what evidence supports this card. */
  sources: string[];
  /** Outbound graph: this card depends_on / feeds / derived_from / etc.
   *  the named relations. Resolves the other object's title for the
   *  prompt — slugs alone are unreadable. */
  links: { relation: string; toTitle: string }[];
}

const NOTE_CAP = 4;
const SOURCE_CAP = 4;
const LINK_CAP = 6;

interface LibObjRow {
  id: string;
  title: string | null;
  object_type: string;
  board_shape_id: string | null;
  micro_objectives: CardMicroObjectivesArtifact | null;
  content_snapshot: Record<string, unknown> | null;
}

/** Fetch one row by id OR board_shape_id, prioritizing id (no extra round
 *  trip when the client already sent a library_objects.id as the shape
 *  handle — e.g. for cards forged off existing rows). */
async function findRowsByShapeIds(
  db: AnyDb,
  spaceId: string,
  shapeIds: string[],
): Promise<Map<string, LibObjRow>> {
  const out = new Map<string, LibObjRow>();
  if (shapeIds.length === 0) return out;
  const cols =
    "id, title, object_type, board_shape_id, micro_objectives, content_snapshot";
  try {
    // Match by board_shape_id — the canonical shape↔object link.
    const { data } = await db
      .from("library_objects")
      .select(cols)
      .eq("space_id", spaceId)
      .in("board_shape_id", shapeIds);
    for (const row of (data ?? []) as LibObjRow[]) {
      if (row.board_shape_id) out.set(row.board_shape_id, row);
    }
  } catch (err) {
    // Pre-migration retry without the new micro_objectives column.
    try {
      const cols2 =
        "id, title, object_type, board_shape_id, content_snapshot";
      const { data } = await db
        .from("library_objects")
        .select(cols2)
        .eq("space_id", spaceId)
        .in("board_shape_id", shapeIds);
      for (const row of (data ?? []) as Omit<LibObjRow, "micro_objectives">[]) {
        if (row.board_shape_id) {
          out.set(row.board_shape_id, {
            ...row,
            micro_objectives: null,
          });
        }
      }
    } catch (err2) {
      console.warn("[load-selection-context] row lookup failed:", err2);
    }
    void err;
  }
  return out;
}

/** Pull library_object_notes for the given object_ids in one round trip,
 *  most recent first. Returns a Map keyed by object_id. */
async function fetchNotes(
  db: AnyDb,
  objectIds: string[],
): Promise<Map<string, { kind: string; text: string }[]>> {
  const out = new Map<string, { kind: string; text: string }[]>();
  if (objectIds.length === 0) return out;
  try {
    const { data } = await db
      .from("library_object_notes")
      .select("object_id, kind, text, created_at")
      .in("object_id", objectIds)
      .order("created_at", { ascending: false });
    for (const r of (data ?? []) as {
      object_id: string;
      kind: string;
      text: string;
    }[]) {
      const arr = out.get(r.object_id) ?? [];
      if (arr.length < NOTE_CAP) {
        arr.push({ kind: r.kind, text: r.text });
        out.set(r.object_id, arr);
      }
    }
  } catch (err) {
    console.warn("[load-selection-context] notes lookup failed:", err);
  }
  return out;
}

/** Pull attached ingested_files titles in one round trip — we just need
 *  a readable label per source for the prompt, not the file content. */
async function fetchSources(
  db: AnyDb,
  objectIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (objectIds.length === 0) return out;
  try {
    const { data } = await db
      .from("library_object_sources")
      .select("object_id, role, ingested_files(source_name, source_type)")
      .in("object_id", objectIds);
    // Supabase types the nested projection as array; runtime can be a
    // single object OR array depending on the FK. Coerce via unknown
    // and normalize to the first element.
    for (const r of (data ?? []) as unknown as Array<{
      object_id: string;
      role: string | null;
      ingested_files:
        | { source_name: string | null; source_type: string | null }
        | Array<{ source_name: string | null; source_type: string | null }>
        | null;
    }>) {
      const f = Array.isArray(r.ingested_files)
        ? r.ingested_files[0] ?? null
        : r.ingested_files;
      const label = (f?.source_name || "").trim() || "(source)";
      const arr = out.get(r.object_id) ?? [];
      if (arr.length < SOURCE_CAP) {
        arr.push(r.role ? `${label} (${r.role})` : label);
        out.set(r.object_id, arr);
      }
    }
  } catch (err) {
    // Some installs join differently or `ingested_files` projection fails;
    // fall back to just role + an "(attached source)" placeholder.
    try {
      const { data } = await db
        .from("library_object_sources")
        .select("object_id, role")
        .in("object_id", objectIds);
      for (const r of (data ?? []) as {
        object_id: string;
        role: string | null;
      }[]) {
        const arr = out.get(r.object_id) ?? [];
        if (arr.length < SOURCE_CAP) {
          arr.push(r.role ?? "(attached source)");
          out.set(r.object_id, arr);
        }
      }
    } catch {
      /* drop silently */
    }
    void err;
  }
  return out;
}

/** Outbound object_links, with the other object's title resolved. Keyed
 *  by from_object_id. */
async function fetchLinks(
  db: AnyDb,
  spaceId: string,
  objectIds: string[],
): Promise<Map<string, { relation: string; toTitle: string }[]>> {
  const out = new Map<string, { relation: string; toTitle: string }[]>();
  if (objectIds.length === 0) return out;
  try {
    const { data } = await db
      .from("object_links")
      .select("from_object_id, to_object_id, relation")
      .eq("space_id", spaceId)
      .in("from_object_id", objectIds);
    const targets = (data ?? []) as Array<{
      from_object_id: string;
      to_object_id: string;
      relation: string;
    }>;
    const targetIds = Array.from(new Set(targets.map((t) => t.to_object_id)));
    const titleById = new Map<string, string>();
    if (targetIds.length > 0) {
      const { data: rows } = await db
        .from("library_objects")
        .select("id, title")
        .in("id", targetIds);
      for (const r of (rows ?? []) as { id: string; title: string | null }[]) {
        if (r.title) titleById.set(r.id, r.title);
      }
    }
    for (const t of targets) {
      const arr = out.get(t.from_object_id) ?? [];
      if (arr.length < LINK_CAP) {
        arr.push({
          relation: t.relation,
          toTitle: titleById.get(t.to_object_id) ?? "(unknown)",
        });
        out.set(t.from_object_id, arr);
      }
    }
  } catch (err) {
    console.warn("[load-selection-context] links lookup failed:", err);
  }
  return out;
}

/** Extract micros from the row, preferring the top-level column over the
 *  content_snapshot back-compat field. Returns the trimmed shape the
 *  prompt needs (slug + label + ladders). */
function extractMicros(
  row: LibObjRow,
): { slug: string; label: string; laddersTo: string[] }[] {
  const fromColumn = row.micro_objectives?.micros;
  if (Array.isArray(fromColumn) && fromColumn.length) {
    return fromColumn.map((m) => ({
      slug: m.slug,
      label: m.label,
      laddersTo: Array.isArray(m.laddersTo) ? m.laddersTo : [],
    }));
  }
  const cs = row.content_snapshot ?? {};
  const fromSnapshot = (cs.micro_objectives as
    | CardMicroObjectivesArtifact
    | undefined)?.micros;
  if (Array.isArray(fromSnapshot) && fromSnapshot.length) {
    return fromSnapshot.map((m) => ({
      slug: m.slug,
      label: m.label,
      laddersTo: Array.isArray(m.laddersTo) ? m.laddersTo : [],
    }));
  }
  return [];
}

/** Public entry — enrich a list of shape ids with library context. The
 *  return preserves the input order so the caller can zip it with the
 *  numbered selection block sent to the LLM. */
export async function enrichSelection(
  db: AnyDb,
  spaceId: string,
  shapeIds: string[],
): Promise<EnrichedSelectionItem[]> {
  if (shapeIds.length === 0) return [];
  const rowByShape = await findRowsByShapeIds(db, spaceId, shapeIds);
  const objectIds = Array.from(rowByShape.values()).map((r) => r.id);
  const [notes, sources, links] = await Promise.all([
    fetchNotes(db, objectIds),
    fetchSources(db, objectIds),
    fetchLinks(db, spaceId, objectIds),
  ]);

  return shapeIds.map((sid) => {
    const row = rowByShape.get(sid) ?? null;
    if (!row) {
      return {
        shapeId: sid,
        libraryObjectId: null,
        objectType: null,
        micros: [],
        notes: [],
        sources: [],
        links: [],
      };
    }
    return {
      shapeId: sid,
      libraryObjectId: row.id,
      objectType: row.object_type,
      micros: extractMicros(row),
      notes: notes.get(row.id) ?? [],
      sources: sources.get(row.id) ?? [],
      links: links.get(row.id) ?? [],
    };
  });
}

/** Render an enriched item as a compact context block for the prompt.
 *  Only includes sections that have content, so a bare note doesn't get
 *  a "(no micros)" stub. Returns "" when the item has no library context
 *  at all — caller can skip the context line for that item. */
export function renderSelectionContext(item: EnrichedSelectionItem): string {
  if (!item.libraryObjectId) return "";
  const lines: string[] = [];
  if (item.objectType) lines.push(`   object: ${item.objectType}`);
  if (item.micros.length) {
    const microStr = item.micros
      .map(
        (m) =>
          `${m.label}${m.laddersTo.length ? ` (→ ${m.laddersTo.join(", ")})` : ""}`,
      )
      .join("; ");
    lines.push(`   micros: ${microStr}`);
  }
  if (item.notes.length) {
    const noteStr = item.notes
      .slice(0, NOTE_CAP)
      .map((n) => `${n.kind}: "${n.text.replace(/\s+/g, " ").slice(0, 140)}"`)
      .join(" | ");
    lines.push(`   user notes: ${noteStr}`);
  }
  if (item.sources.length) {
    lines.push(`   sources: ${item.sources.join("; ")}`);
  }
  if (item.links.length) {
    const linkStr = item.links
      .map((l) => `${l.relation} → "${l.toTitle}"`)
      .join("; ");
    lines.push(`   links: ${linkStr}`);
  }
  return lines.length ? lines.join("\n") : "";
}
