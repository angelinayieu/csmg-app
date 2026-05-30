// ── Render a brainstorm session as sticky notes on the tldraw board ──
//
// Called from WhiteboardBase's listener for BRAINSTORM_OPEN_ON_BOARD_EVENT.
// Pure tldraw-editor manipulation — no React, no fetches.
//
// Layout: 3 horizontal lanes by ribbon
//   y= 100  green  (ready to elect)
//   y= 360  amber  (explore)
//   y= 620  tray   (discarded)
//
// Each card is 200×200, gap 20px, color by intent.
// Re-firing the event updates existing shapes (matched by meta.proposal_id)
// rather than duplicating — so the panel can stream additions as the
// runner appends generations.

import type { Editor, TLPageId } from "tldraw";
import { createShapeId, toRichText } from "tldraw";
import type {
  BrainstormCandidateForBoard,
  BrainstormOpenOnBoardDetail,
} from "./brainstorm-board-bus";
import type { SubObjectiveIntent } from "@/lib/objective-canvas/sub-objective-state";

const CARD_W = 200;
const CARD_H = 200;
const CARD_GAP = 20;
const X_ORIGIN = 100;
const LANE_GREEN_Y = 100;
const LANE_AMBER_Y = 360;
const LANE_TRAY_Y = 620;

/** Marker on shape.meta so the renderer recognises its own shapes
 *  when streaming updates land. */
const BRAINSTORM_META_FLAG = "brainstorm_candidate";

/** Tldraw built-in note color per intent. Tldraw notes accept these
 *  named colors — see TLDefaultColorStyle. */
function colorForIntent(
  intent: SubObjectiveIntent,
): "blue" | "light-blue" | "grey" | "orange" | "red" | "yellow" | "green" {
  switch (intent) {
    case "creative":
      return "blue";
    case "concrete":
      return "green";
    case "contrarian":
      return "grey";
    case "gap_fill":
      return "orange";
    case "ambitious":
      return "red";
    case "wildcard":
      return "light-blue";
    default:
      return "yellow";
  }
}

function ribbonY(ribbon: BrainstormCandidateForBoard["ribbon"]): number {
  if (ribbon === "green") return LANE_GREEN_Y;
  if (ribbon === "amber") return LANE_AMBER_Y;
  return LANE_TRAY_Y;
}

/** Find a page by name; null if not present. */
function findPageByName(editor: Editor, name: string): TLPageId | null {
  for (const p of editor.getPages()) {
    if (p.name === name) return p.id;
  }
  return null;
}

/** Top-level entry. Idempotent — safe to call repeatedly with the same
 *  sessionId to push updates (new candidates appended, ribbons changed). */
export function renderBrainstormOnBoard(
  editor: Editor,
  detail: BrainstormOpenOnBoardDetail,
): void {
  const { sessionId, pageTitle, candidates } = detail;
  if (!candidates.length) {
    return;
  }

  // Phase 4b-2: each brainstorm = its own tldraw page on the existing
  // objective board. Reuse the page if it already exists (incremental
  // updates from streaming).
  let pageId: TLPageId = (findPageByName(editor, pageTitle) ??
    editor.getCurrentPageId()) as TLPageId;
  if (!findPageByName(editor, pageTitle)) {
    try {
      // Pin the session id into the page name as well so we can find
      // it even after a user rename. tldraw page names allow newlines
      // visually but we keep it single-line for the tab label.
      const page = editor.createPage({ name: pageTitle });
      // createPage's return type sometimes infers as { id: string }
      // depending on tldraw version; coerce to TLPageId.
      pageId = page.id as TLPageId;
    } catch {
      // createPage can throw if the editor is mid-batch — degrade
      // by staying on the current page and just adding the shapes there.
      pageId = editor.getCurrentPageId() as TLPageId;
    }
  }

  // Switch the editor to the brainstorm page (no-op if already there).
  if (editor.getCurrentPageId() !== pageId) {
    editor.setCurrentPage(pageId);
  }

  // Group by ribbon for stable left-to-right ordering within each lane.
  const byRibbon: Record<"green" | "amber" | "tray", BrainstormCandidateForBoard[]> = {
    green: [],
    amber: [],
    tray: [],
  };
  for (const c of candidates) {
    const r = c.ribbon ?? "tray";
    byRibbon[r].push(c);
  }

  // Existing shapes on this page that we own (by meta flag), indexed
  // by proposal_id so we can update positions/text instead of duplicating.
  const ownedById = new Map<string, ReturnType<typeof editor.getShape>>();
  for (const s of editor.getCurrentPageShapes()) {
    const meta = s.meta as {
      kind?: string;
      proposal_id?: string;
      session_id?: string;
    };
    if (meta?.kind === BRAINSTORM_META_FLAG && meta.session_id === sessionId) {
      if (meta.proposal_id) ownedById.set(meta.proposal_id, s);
    }
  }

  // Emit shapes per lane.
  for (const ribbon of ["green", "amber", "tray"] as const) {
    const lane = byRibbon[ribbon];
    const y = ribbonY(ribbon);
    lane.forEach((c, idx) => {
      const x = X_ORIGIN + idx * (CARD_W + CARD_GAP);
      const text = composeNoteText(c);
      const existing = ownedById.get(c.proposal_id);
      if (existing) {
        // Update in place — adjust position + text if ribbon/score changed.
        // tldraw's updateShape signature is a discriminated union on
        // type; we own only 'note' shapes (we filtered by meta.kind),
        // so hardcode the literal to satisfy the narrowing.
        try {
          editor.updateShape({
            id: existing.id,
            type: "note",
            x,
            y,
            props: {
              color: colorForIntent(c.intent_of_origin),
              richText: toRichText(text),
            },
          });
        } catch {
          /* swallow — next update tick will retry */
        }
        ownedById.delete(c.proposal_id);
      } else {
        try {
          editor.createShape({
            id: createShapeId(),
            type: "note",
            x,
            y,
            meta: {
              kind: BRAINSTORM_META_FLAG,
              session_id: sessionId,
              proposal_id: c.proposal_id,
              ribbon,
            },
            props: {
              color: colorForIntent(c.intent_of_origin),
              size: "m",
              richText: toRichText(text),
            },
          });
        } catch {
          /* shape creation can fail mid-batch; safe to skip */
        }
      }
    });
  }

  // Anything left in ownedById was orphaned by a re-render where the
  // candidate disappeared (e.g. dedup pass removed it). Hide rather
  // than delete so the user can recover via tldraw's undo.
  for (const orphan of ownedById.values()) {
    if (!orphan) continue;
    try {
      editor.updateShape({
        id: orphan.id,
        type: orphan.type,
        opacity: 0.25,
      } as Parameters<typeof editor.updateShape>[0]);
    } catch {
      /* swallow */
    }
  }

  // Frame the new content so the user sees the layout — but only on
  // first paint (when ownedById was empty before render). Subsequent
  // re-renders during streaming should NOT yank the viewport.
  if (ownedById.size === 0 && candidates.length > 0) {
    try {
      const ids = editor
        .getCurrentPageShapes()
        .filter(
          (s) =>
            (s.meta as { kind?: string; session_id?: string }).kind ===
              BRAINSTORM_META_FLAG &&
            (s.meta as { session_id?: string }).session_id === sessionId,
        )
        .map((s) => s.id);
      if (ids.length > 0) {
        editor.select(...ids);
        editor.zoomToSelection({ animation: { duration: 300 } });
        editor.selectNone();
      }
    } catch {
      /* swallow */
    }
  }
}

/** Compose the readable text body for a candidate sticky note.
 *  Tldraw note shapes wrap automatically; we keep title + brief summary
 *  + score so the card reads at a glance without the user having to
 *  open the panel. */
function composeNoteText(c: BrainstormCandidateForBoard): string {
  const head = c.title.trim() || "(untitled)";
  const summary = (c.summary ?? "").trim().slice(0, 160);
  const score =
    typeof c.composite_score === "number"
      ? `\n\nscore: ${c.composite_score.toFixed(2)}`
      : "";
  return summary ? `${head}\n\n${summary}${score}` : `${head}${score}`;
}

/** Switch the editor back to the first non-brainstorm page. The
 *  brainstorm page persists in the page sidebar for re-opening. */
export function collapseBrainstormPage(
  editor: Editor,
  sessionId: string,
): void {
  // Find a page that is NOT a brainstorm page (heuristic: doesn't host
  // any brainstorm-marker shapes for ANY session). Fall back to the
  // first page if all pages are brainstorms.
  let targetId: TLPageId | null = null;
  for (const p of editor.getPages()) {
    if (p.id === editor.getCurrentPageId()) continue;
    targetId = p.id;
    break;
  }
  if (targetId && editor.getCurrentPageId() !== targetId) {
    editor.setCurrentPage(targetId);
  }
  // sessionId currently unused — kept in the signature so future
  // versions can target a specific page's brainstorm shapes for cleanup
  // (e.g. an explicit "Discard session" action that strips its sticky
  // notes from the board on collapse).
  void sessionId;
}
