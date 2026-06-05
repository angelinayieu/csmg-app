// ── Notebook block model ──────────────────────────────────────────────
//
// ARTIFACTS_DOCK_PLAN.md §5. A Notebook is an editable, persistent artifact
// (artifact_type "notebook") whose body is an ordered list of BLOCKS. The
// critical property: AI weaving APPENDS new ai_woven blocks; it never rewrites
// user/quote/locked blocks — so a user edit is never clobbered (unlike the old
// journal, which regenerated the whole thing every time).
//
// Pure types + coercion helpers — safe to import on client and server.

export type NotebookBlockKind = "ai_woven" | "user" | "quote";

export interface NotebookBlock {
  id: string;
  kind: NotebookBlockKind;
  heading?: string;
  body: string;
  /** For quote blocks dragged in from the whiteboard. */
  sourceObjectId?: string | null;
  /** A user has edited this block (or authored it) — weaving must skip it. */
  edited?: boolean;
  /** Pinned by the user — never auto-touch. */
  locked?: boolean;
  updatedAt?: string;
}

export interface NotebookContent {
  title: string;
  blocks: NotebookBlock[];
  /** How many of the space's voice notes have already been woven in (so a
   *  re-weave only incorporates NEW notes, never re-writing earlier entries). */
  wovenCount: number;
}

/** Old journal section shape (pre-block-model). */
interface LegacySection {
  heading?: string;
  body?: string;
}

let _seq = 0;
/** Stable-ish block id (no Date.now/Math.random dependence on the server path). */
export function genBlockId(prefix = "blk"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  _seq += 1;
  return `${prefix}-${_seq}-${Date.now()}`;
}

export function emptyNotebook(): NotebookContent {
  return { title: "Notebook", blocks: [], wovenCount: 0 };
}

/** Convert legacy journal sections → ai_woven blocks (lazy backfill). */
export function sectionsToBlocks(sections: LegacySection[]): NotebookBlock[] {
  return sections
    .filter((s) => s && typeof s.body === "string" && s.body.trim())
    .map((s) => ({
      id: genBlockId(),
      kind: "ai_woven" as const,
      heading: typeof s.heading === "string" ? s.heading : undefined,
      body: s.body as string,
    }));
}

/** Accept either the new block content, the legacy {sections} blob, or null,
 *  and return a normalized NotebookContent. `legacyNoteCount` seeds wovenCount
 *  for a backfilled journal (whose sections already incorporated all notes). */
export function coerceNotebookContent(
  raw: unknown,
  legacyNoteCount = 0,
): NotebookContent {
  if (!raw || typeof raw !== "object") return emptyNotebook();
  const r = raw as Record<string, unknown>;

  // New block content.
  if (Array.isArray(r.blocks)) {
    const blocks = (r.blocks as unknown[])
      .filter((b): b is NotebookBlock => !!b && typeof b === "object")
      .map((b) => {
        const bl = b as Partial<NotebookBlock>;
        return {
          id: typeof bl.id === "string" ? bl.id : genBlockId(),
          kind:
            bl.kind === "user" || bl.kind === "quote" ? bl.kind : "ai_woven",
          heading: typeof bl.heading === "string" ? bl.heading : undefined,
          body: typeof bl.body === "string" ? bl.body : "",
          sourceObjectId:
            typeof bl.sourceObjectId === "string" ? bl.sourceObjectId : null,
          edited: bl.edited === true,
          locked: bl.locked === true,
          updatedAt: typeof bl.updatedAt === "string" ? bl.updatedAt : undefined,
        } as NotebookBlock;
      });
    return {
      title: typeof r.title === "string" && r.title.trim() ? r.title : "Notebook",
      blocks,
      wovenCount:
        typeof r.wovenCount === "number" ? r.wovenCount : legacyNoteCount,
    };
  }

  // Legacy journal { title, sections }.
  if (Array.isArray(r.sections)) {
    return {
      title: typeof r.title === "string" && r.title.trim() ? r.title : "Notebook",
      blocks: sectionsToBlocks(r.sections as LegacySection[]),
      wovenCount: legacyNoteCount,
    };
  }

  return emptyNotebook();
}

/** Project blocks → {heading, body} sections for the glanceable board card. */
export function blocksToSections(
  blocks: NotebookBlock[],
): { heading: string; body: string }[] {
  return blocks.map((b) => ({ heading: b.heading ?? "", body: b.body }));
}
