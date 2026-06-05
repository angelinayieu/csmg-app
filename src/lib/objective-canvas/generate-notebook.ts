// ── generate-notebook ─────────────────────────────────────────────────
//
// Append-oriented notebook synthesis (ARTIFACTS_DOCK_PLAN.md §5). Unlike the
// legacy journal (which regenerated the whole artifact every time and would
// clobber user edits), this:
//   1. loads the existing notebook blocks (or backfills from the legacy
//      journal blob),
//   2. appends any incoming `quotes` (cards added from the whiteboard) as
//      quote blocks,
//   3. weaves ONLY the NEW voice notes (those past wovenCount) into 1–3 fresh
//      ai_woven blocks — existing user/quote/locked/edited blocks are untouched.
// Persists the result as an `artifacts` row (+ version). Soft-fail throughout.

import { llmJSON } from "../llm";
import {
  coerceNotebookContent,
  genBlockId,
  type NotebookBlock,
  type NotebookContent,
} from "./notebook-types";
import {
  listArtifacts,
  upsertArtifact,
  appendArtifactVersion,
} from "./artifacts";

const NOTEBOOK_MODEL = "claude-opus-4-6";
const MAX_NOTES = 200;

const NOTEBOOK_SYSTEM = `You extend a person's private notebook. You receive the EXISTING entries
(for context, do NOT rewrite them) and a list of NEW voice notes since the last
weave. Write 1–3 NEW notebook entries that weave ONLY the new notes.

Rules:
- Preserve the user's OWN first-person voice. Do not invent facts/advice/events
  they didn't say. Lightly tidy grammar/filler.
- Each new entry = a short heading + 1–3 short paragraphs of reflective prose.
- Do NOT repeat or restate the existing entries — only cover the new material.
- This is journaling, NOT analysis: no action-item bullet lists, no
  "recommendations", no "Summary"/"Next steps" headings.
- If the new notes are thin, write a single short entry — never pad.
- Suggest a notebook TITLE only if the notebook has no real title yet
  (i.e. it is currently "Notebook"); otherwise return an empty title.

Return JSON: { "title": string, "newBlocks": [{ "heading": string, "body": string }] }.`;

const NOTEBOOK_USER = (existingTitle: string, existingSummary: string[], newNotes: string[]) =>
  `Notebook title: ${existingTitle}\n\nExisting entries (context only — do not rewrite):\n${
    existingSummary.length ? existingSummary.map((s, i) => `${i + 1}. ${s}`).join("\n") : "(none yet)"
  }\n\nNEW voice notes to weave:\n${newNotes
    .map((n, i) => `${i + 1}. ${n}`)
    .join("\n")}\n\nReturn the new entries JSON.`;

const NOTEBOOK_WEAVE_SCHEMA = {
  name: "notebook_weave_v1",
  schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      newBlocks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            heading: { type: "string" },
            body: { type: "string" },
          },
          required: ["heading", "body"],
        },
      },
    },
    required: ["title", "newBlocks"],
  },
} as const;

interface WeaveResponse {
  title: string;
  newBlocks: { heading: string; body: string }[];
}

function normalizeWeave(data: unknown): WeaveResponse {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const newBlocks = Array.isArray(d.newBlocks)
    ? (d.newBlocks as unknown[])
        .filter(
          (b): b is { heading?: string; body: string } =>
            !!b && typeof b === "object" && typeof (b as { body?: unknown }).body === "string",
        )
        .map((b) => ({
          heading: typeof b.heading === "string" ? b.heading : "",
          body: b.body,
        }))
    : [];
  return {
    title: typeof d.title === "string" ? d.title.trim() : "",
    newBlocks,
  };
}

export interface NotebookQuote {
  text: string;
  sourceObjectId?: string | null;
}

export interface SynthesizeNotebookResult {
  artifactId: string | null;
  content: NotebookContent;
}

export async function synthesizeNotebookForSpace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  spaceId: string,
  userId: string,
  opts: { quotes?: NotebookQuote[]; boardShapeId?: string | null } = {},
): Promise<SynthesizeNotebookResult | null> {
  try {
    const { data: space } = await db
      .from("spaces")
      .select("user_id, synthesis_data")
      .eq("id", spaceId)
      .maybeSingle();
    if (!space || space.user_id !== userId) return null;

    const oc = (space.synthesis_data as Record<string, unknown> | null)
      ?.objective_canvas as { voice_notes?: unknown; journal?: unknown } | undefined;
    const notes: string[] = Array.isArray(oc?.voice_notes)
      ? (oc!.voice_notes as unknown[]).filter(
          (n): n is string => typeof n === "string" && n.trim().length > 0,
        )
      : [];
    const bounded = notes.slice(-MAX_NOTES);

    // Load existing notebook artifact (or backfill from the legacy journal blob).
    const existing = (await listArtifacts(db, spaceId, { artifactType: "notebook" }))[0];
    let content: NotebookContent;
    let artifactId: string | null = existing?.id ?? null;
    if (existing?.content) {
      content = coerceNotebookContent(existing.content, bounded.length);
    } else if (oc?.journal) {
      // First open after Phase 1/2: seed from the legacy journal sections, and
      // assume those already incorporated every note so far.
      content = coerceNotebookContent(oc.journal, bounded.length);
    } else {
      content = coerceNotebookContent(null, 0);
    }

    // 1. Append quote blocks (cards added from the whiteboard).
    const quotes = opts.quotes ?? [];
    for (const q of quotes) {
      const text = (q.text ?? "").trim();
      if (!text) continue;
      const block: NotebookBlock = {
        id: genBlockId("quote"),
        kind: "quote",
        body: text,
        sourceObjectId: q.sourceObjectId ?? null,
        updatedAt: new Date().toISOString(),
      };
      content.blocks.push(block);
    }

    // 2. Weave ONLY the new notes (past wovenCount) into fresh ai_woven blocks.
    const newNotes = bounded.slice(content.wovenCount);
    if (newNotes.length > 0) {
      const existingSummary = content.blocks
        .filter((b) => b.kind !== "quote")
        .slice(-6)
        .map((b) => (b.heading ? `${b.heading}: ${b.body}` : b.body).slice(0, 240));
      try {
        const woven = await llmJSON<WeaveResponse>({
          system: NOTEBOOK_SYSTEM,
          user: NOTEBOOK_USER(content.title, existingSummary, newNotes),
          provider: "anthropic",
          model: NOTEBOOK_MODEL,
          maxTokens: 2400,
          responseSchema: NOTEBOOK_WEAVE_SCHEMA,
          validator: (d) => normalizeWeave(d),
        });
        for (const nb of woven.newBlocks) {
          content.blocks.push({
            id: genBlockId("ai"),
            kind: "ai_woven",
            heading: nb.heading || undefined,
            body: nb.body,
            updatedAt: new Date().toISOString(),
          });
        }
        if (
          woven.title &&
          (!content.title || content.title === "Notebook")
        ) {
          content.title = woven.title;
        }
        content.wovenCount = bounded.length;
      } catch (e) {
        console.warn(
          "[notebook] weave failed (keeping quotes):",
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    // Nothing to persist (no quotes, no new notes, no existing) → bail.
    if (content.blocks.length === 0 && !artifactId) return null;

    artifactId = await upsertArtifact(db, {
      spaceId,
      userId,
      artifactType: "notebook",
      engineKey: "notebook",
      title: content.title,
      status: "ready",
      content,
      boardShapeId: opts.boardShapeId ?? existing?.board_shape_id ?? null,
      lastUpdatedBy: "agent:notebook",
    });
    if (artifactId) {
      await appendArtifactVersion(db, artifactId, {
        content,
        changeType: "agent_update",
        changedBy: userId,
      });
    }
    return { artifactId, content };
  } catch (err) {
    console.warn(
      "[notebook] generation failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
