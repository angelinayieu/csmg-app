// ── hydrate-refine-context — multi-input refine substrate ─────────
//
// Server-only. Turns a list of library_object ids (the user dragged onto
// the prototype) + sibling prototypes into a structured CONTEXT block the
// refine prompt prepends above the user's text feedback. Mirrors what
// generate-screen does for image-grounded UI generation.
//
// What it surfaces, per source type:
//   - image_source     → image_narrative + concept_slug (the "look like this")
//   - context_concept  → concept_slug + summary (the "this term means…")
//   - feature/insight  → title + summary (the "incorporate this card")
//   - taste_profile    → already in DESIGN.md; skipped here
//   - sibling prototype → title + latest changeNote (the "follow this thread")
//
// Soft-fails: every DB read is wrapped; missing table / RLS denial / bad
// ids degrade to an empty block instead of a 500. The refine call should
// still ship, just without enrichment.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any>;

export interface HydratedRefineContext {
  /** The composed markdown block, empty when nothing hydrated. */
  block: string;
  counts: {
    objects: number;
    images: number;
    siblings: number;
  };
}

const EMPTY: HydratedRefineContext = {
  block: "",
  counts: { objects: 0, images: 0, siblings: 0 },
};

interface Args {
  db: AnyDb;
  spaceId: string;
  /** library_objects ids the user wants the model to incorporate. */
  linkedObjectIds: string[];
  /** The artifact id currently being refined — excluded from siblings. */
  currentArtifactId?: string | null;
  /** Cap sibling-prototype fetch (most recent first). */
  maxSiblings?: number;
}

interface ObjectRow {
  id: string;
  title: string;
  summary: string | null;
  object_type: string;
  source_ref: string | null;
  content_snapshot: unknown;
  subsystem: string | null;
}

interface ImageDetail {
  imageNarrative: string | null;
  imageUrl: string | null;
  conceptSlugs: string[];
}

interface ArtifactRow {
  id: string;
  title: string;
  artifact_type: string;
  updated_at: string | null;
}

export async function hydrateRefineContext(
  args: Args,
): Promise<HydratedRefineContext> {
  const { db, spaceId } = args;
  if (!spaceId) return EMPTY;

  const ids = Array.isArray(args.linkedObjectIds)
    ? Array.from(new Set(args.linkedObjectIds.filter((s) => typeof s === "string" && s)))
    : [];
  const maxSiblings = Math.max(0, Math.min(args.maxSiblings ?? 3, 10));

  // Parallelize the three reads; each is soft-failed.
  const [objects, siblings] = await Promise.all([
    fetchObjects(db, spaceId, ids),
    fetchSiblingPrototypes(db, spaceId, args.currentArtifactId ?? null, maxSiblings),
  ]);

  // Pull image details for any image_source objects.
  const imageDetails = await fetchImageDetails(
    db,
    objects.filter((o) => o.object_type === "image_source"),
  );

  const block = composeBlock(objects, imageDetails, siblings);
  return {
    block,
    counts: {
      objects: objects.length,
      images: imageDetails.size,
      siblings: siblings.length,
    },
  };
}

// ── pure composer ──────────────────────────────────────────────────

/** Exposed for tests + the preflight harness. Pure — no DB. */
export function composeBlock(
  objects: ObjectRow[],
  imageDetails: Map<string, ImageDetail>,
  siblings: ArtifactRow[],
): string {
  const sections: string[] = [];

  const images = objects.filter((o) => o.object_type === "image_source");
  if (images.length) {
    const lines = images.map((o) => renderImageLine(o, imageDetails.get(o.id)));
    sections.push(
      `### Visual references the user wants you to honor\n${lines.join("\n\n")}`,
    );
  }

  const concepts = objects.filter((o) => o.object_type === "context_concept");
  if (concepts.length) {
    const lines = concepts.map((o) => renderConceptLine(o));
    sections.push(
      `### Concepts the user wants you to use literally\n${lines.join("\n")}`,
    );
  }

  const other = objects.filter(
    (o) => o.object_type !== "image_source" && o.object_type !== "context_concept",
  );
  if (other.length) {
    const lines = other.map((o) => renderObjectLine(o));
    sections.push(
      `### Cards the user wants you to incorporate\n${lines.join("\n")}`,
    );
  }

  if (siblings.length) {
    const lines = siblings.map(
      (s) => `- **${s.title}** — prior prototype on this objective (still on the board).`,
    );
    sections.push(
      `### Sibling prototypes (visible in the same space — stay coherent)\n${lines.join("\n")}`,
    );
  }

  if (!sections.length) return "";
  return [
    "## LINKED CONTEXT (drag-wired by the user, prefer these over your defaults)",
    "",
    sections.join("\n\n"),
    "",
    "Apply this context concretely: real text, real visual cues. Don't",
    "name-drop; weave it into the screen.",
    "",
  ].join("\n");
}

function renderImageLine(o: ObjectRow, detail: ImageDetail | undefined): string {
  const slugs = detail?.conceptSlugs ?? readSlugsFromSnapshot(o.content_snapshot);
  const slugBlock = slugs.length
    ? ` · slugs: ${slugs.map((s) => `\`${s}\``).join(", ")}`
    : "";
  const narrative = (detail?.imageNarrative ?? "").trim();
  const narrativeBlock = narrative
    ? `\n  > ${narrative.replace(/\n+/g, " ").slice(0, 600)}`
    : "";
  return `- **${o.title}**${slugBlock}${narrativeBlock}`;
}

function renderConceptLine(o: ObjectRow): string {
  const slug = readSlug(o.content_snapshot);
  const slugBlock = slug ? ` (\`${slug}\`)` : "";
  const summary = (o.summary ?? "").trim();
  return `- **${o.title}**${slugBlock}${summary ? ` — ${summary.slice(0, 240)}` : ""}`;
}

function renderObjectLine(o: ObjectRow): string {
  const summary = (o.summary ?? "").trim();
  const sub = o.subsystem ? ` _[${o.subsystem}]_` : "";
  return `- **${o.title}**${sub}${summary ? ` — ${summary.slice(0, 240)}` : ""}`;
}

function readSlug(snap: unknown): string | null {
  if (!snap || typeof snap !== "object") return null;
  const s = (snap as Record<string, unknown>).concept_slug;
  return typeof s === "string" ? s : null;
}

function readSlugsFromSnapshot(snap: unknown): string[] {
  if (!snap || typeof snap !== "object") return [];
  const raw = (snap as Record<string, unknown>).concept_slugs;
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter((s): s is string => typeof s === "string");
}

// ── DB reads (soft-fail) ───────────────────────────────────────────

async function fetchObjects(
  db: AnyDb,
  spaceId: string,
  ids: string[],
): Promise<ObjectRow[]> {
  if (!ids.length) return [];
  try {
    const { data } = await db
      .from("library_objects")
      .select("id, title, summary, object_type, source_ref, content_snapshot, subsystem")
      .eq("space_id", spaceId)
      .in("id", ids);
    return (data as ObjectRow[] | null) ?? [];
  } catch (err) {
    console.warn("[hydrate-refine-context] fetchObjects soft-fail:", err);
    return [];
  }
}

/** Image library_objects address their underlying ingested_files row via
 *  `source_ref = 'img:<ingestedFileId>'`. We resolve the back-link to grab
 *  the actual narrative + URL the vision pass wrote. */
async function fetchImageDetails(
  db: AnyDb,
  imageObjects: ObjectRow[],
): Promise<Map<string, ImageDetail>> {
  const out = new Map<string, ImageDetail>();
  if (!imageObjects.length) return out;

  const fileIdByObjectId = new Map<string, string>();
  for (const o of imageObjects) {
    const ref = (o.source_ref ?? "").trim();
    if (!ref.startsWith("img:")) continue;
    const fileId = ref.slice(4);
    if (fileId) fileIdByObjectId.set(o.id, fileId);
  }
  const fileIds = Array.from(new Set(fileIdByObjectId.values()));
  if (!fileIds.length) return out;

  try {
    const { data } = await db
      .from("ingested_files")
      .select("id, image_narrative, image_url, image_concepts")
      .in("id", fileIds);
    const byFileId = new Map<
      string,
      { image_narrative: string | null; image_url: string | null; image_concepts: unknown }
    >();
    for (const r of (data ?? []) as Array<{
      id: string;
      image_narrative: string | null;
      image_url: string | null;
      image_concepts: unknown;
    }>) {
      byFileId.set(r.id, r);
    }
    for (const [objectId, fileId] of fileIdByObjectId) {
      const r = byFileId.get(fileId);
      if (!r) continue;
      const slugs = Array.isArray(r.image_concepts)
        ? (r.image_concepts as unknown[]).filter(
            (s): s is string => typeof s === "string",
          )
        : [];
      out.set(objectId, {
        imageNarrative: r.image_narrative,
        imageUrl: r.image_url,
        conceptSlugs: slugs,
      });
    }
  } catch (err) {
    console.warn("[hydrate-refine-context] fetchImageDetails soft-fail:", err);
  }
  return out;
}

async function fetchSiblingPrototypes(
  db: AnyDb,
  spaceId: string,
  currentArtifactId: string | null,
  max: number,
): Promise<ArtifactRow[]> {
  if (!max) return [];
  try {
    let q = db
      .from("artifacts")
      .select("id, title, artifact_type, updated_at")
      .eq("space_id", spaceId)
      .eq("artifact_type", "prototype")
      .order("updated_at", { ascending: false })
      .limit(max + (currentArtifactId ? 1 : 0));
    const { data } = await q;
    const rows = (data as ArtifactRow[] | null) ?? [];
    const filtered = currentArtifactId
      ? rows.filter((r) => r.id !== currentArtifactId)
      : rows;
    return filtered.slice(0, max);
  } catch (err) {
    console.warn("[hydrate-refine-context] fetchSiblingPrototypes soft-fail:", err);
    return [];
  }
}
