// ── Shape → Node adapter (the Synergism port seam) ──────────────────
//
// The reusable Synergism interaction logic in `lib/synergy/*`
// (autoMarkBoard / computeKeptIds / useFocusMode / useConvergeResult) is
// typed against `ClientNode {id,x,y,label,kind,parent}`. The new tldraw
// Objective Canvas speaks `TLShape`. This is the ONE projection that lets
// all of that logic drop in unchanged — board shapes → ClientNode[].
//
// Pure + tldraw-TYPE-only (no editor handle, no React, no tldraw.css
// side-effect) so it imports cheap and stays unit-testable. Callers pass
// `editor.getCurrentPageShapes()`.
//
// Shape → NodeKind mapping:
//   room-card     → "core"     — a decided sub-objective seed; always kept
//   artifact-card → "branch"   — a deliberately-placed room item (content)
//   insight-card  → "insight" | "synergy"  — AI connect/synthesis; its
//                   `sourceIds` become parent/parents, so the source cards
//                   read as "expanded threads" (kept) in the auto-marker
//   note (tldraw) → "variation" — brainstorm scratch; exploratory →
//                   excluded by default unless it gained children
//   everything else (arrow / geo / draw / text / layer-band / frame) is
//   skipped — edges, canvas chrome, and notes-to-self aren't decisions.
//
// Known limitation (acceptable for MVP): autoMarkBoard credits child
// count to the SINGLE `parent` only, so an insight's secondary sources
// (parents[1..]) don't gain "expanded" credit. Multi-parent crediting
// would require touching the shared synergy logic — deferred.

import type { TLShape } from "tldraw";
import type { ClientNode, NodeKind } from "@/lib/synergy/types";
import type { OperationTarget } from "@/lib/objective-canvas/canvas-operations";

type Props = Record<string, unknown>;

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

/** Recursively concatenate every `text` leaf under a ProseMirror node. */
function collectText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: unknown; content?: unknown };
  let out = typeof n.text === "string" ? n.text : "";
  if (Array.isArray(n.content)) {
    for (const child of n.content) out += collectText(child);
  }
  return out;
}

/** First non-empty top-level block of a tldraw note's richText — the
 *  brainstorm renderer writes `title\n\nsummary\n\nscore`, so the first
 *  block is the title (what we want as the node label). */
function firstLineOfRichText(rt: unknown): string {
  if (!rt || typeof rt !== "object") return "";
  const doc = rt as { content?: unknown };
  const blocks = Array.isArray(doc.content) ? doc.content : [];
  for (const block of blocks) {
    const t = collectText(block).trim();
    if (t) return t;
  }
  return collectText(rt).trim();
}

/** Project the current page's tldraw shapes into the ClientNode model
 *  the Synergism convergence logic consumes. Order is preserved (load
 *  order ≈ recency, which groupForStage1 relies on for plan ordering). */
export function boardShapesToNodes(shapes: TLShape[]): ClientNode[] {
  const nodes: ClientNode[] = [];

  for (const shape of shapes) {
    const props = shape.props as unknown as Props;
    const meta = (shape.meta ?? {}) as { compact?: boolean };
    // Unfurl-map nodes are transient visualization, not decided content.
    if (meta.compact) continue;

    const base = { id: shape.id as string, x: shape.x, y: shape.y };

    switch (shape.type) {
      case "room-card":
        nodes.push({ ...base, kind: "core", label: asString(props.title, "Room") });
        break;

      case "artifact-card":
        nodes.push({ ...base, kind: "branch", label: asString(props.title, "Item") });
        break;

      case "insight-card": {
        const sourceIds = Array.isArray(props.sourceIds)
          ? (props.sourceIds.filter((s) => typeof s === "string") as string[])
          : [];
        const kind: NodeKind = props.kind === "synthesize" ? "synergy" : "insight";
        nodes.push({
          ...base,
          kind,
          label: asString(props.headline, "Insight"),
          parent: sourceIds[0] ?? null,
          parents: sourceIds.length > 1 ? sourceIds : undefined,
        });
        break;
      }

      case "note":
        nodes.push({
          ...base,
          kind: "variation",
          label: firstLineOfRichText(props.richText) || "Note",
        });
        break;

      default:
        // arrow / geo / draw / text / layer-band / frame → not content
        break;
    }
  }

  return nodes;
}

/** Full text of a tldraw note/text/geo shape (richText doc → concatenated
 *  leaves; falls back to a legacy string `text` prop). */
function shapeFullText(props: Props): string {
  const fromRich = props.richText ? collectText(props.richText).trim() : "";
  if (fromRich) return fromRich;
  return typeof props.text === "string" ? (props.text as string).trim() : "";
}

/** Project a single board shape into an OperationTarget the AI scanner runs ops
 *  against — a sticky note / text / labeled geo, OR a board card (room /
 *  artifact / insight). Selecting any of these opens the scanner panel (the
 *  "sidebar"). Returns null for chrome (arrows, layer bands). See
 *  CANVAS_AI_SCANNER_PLAN.md §3a. */
export function shapeToScanTarget(shape: TLShape): OperationTarget | null {
  const props = shape.props as unknown as Props;
  switch (shape.type) {
    case "note":
    case "text":
    case "geo": {
      const text = shapeFullText(props);
      return text.length >= 3 ? { text, shapeId: shape.id as string } : null;
    }
    case "room-card":
    case "artifact-card": {
      const text = [asString(props.title), asString(props.subtitle)]
        .filter(Boolean)
        .join(" — ");
      if (text.length < 3) return null;
      const roomId = typeof props.roomId === "string" ? props.roomId : undefined;
      const entityId =
        typeof props.entityId === "string" && props.entityId
          ? props.entityId
          : roomId;
      return { text, shapeId: shape.id as string, entityId, roomId };
    }
    case "insight-card": {
      const text = [asString(props.headline), asString(props.body)]
        .filter(Boolean)
        .join(" — ");
      return text.length >= 3 ? { text, shapeId: shape.id as string } : null;
    }
    default:
      return null;
  }
}
