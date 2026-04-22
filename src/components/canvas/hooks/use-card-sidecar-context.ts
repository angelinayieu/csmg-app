"use client";

// ── useCardSidecarContext (Arc 5B.1) ───────────────────────────────────
//
// Builds the AI context block used by every tab in the CardSidecar. The
// primary job is to walk the thread ancestor chain when the selected
// shape is a ThreadNoteShape — so AI calls see the conversational
// history, not just the leaf content.
//
// Output shape is deliberately generic: a primary text + an array of
// context blocks. Each tab formats these into its own prompt.
//
// Shape-type awareness:
//   • thread-note: walks up to MAX_ANCESTORS (5) parents, each becoming a
//     block with kind="thread-ancestor". Primary text is the current
//     thread's content.
//   • sticky-note: primary text is the sticky's text; one block with
//     kind="dimension" if a dimension tag is set.
//   • kg-node: primary text is `${name} — ${description}`; blocks include
//     category + layer + entity tier signals.
//   • strategy-card: primary text is the title + readyScore; blocks include
//     version label + status.
//   • default: primary text = stringified JSON of the shape's props.
//
// Cache-by-shape-id is upstream — this hook is pure; callers memo.

import { useMemo } from "react";
import { type Editor, type TLShape, type TLShapeId } from "tldraw";
import type {
  ThreadNoteShape,
  StickyNoteShape,
  KGNodeShape,
  StrategyShape,
} from "../shapes/types";

const MAX_ANCESTORS = 5;

export type CardContextBlock =
  | { kind: "thread-ancestor"; author: string | null; text: string; depth: number }
  | { kind: "dimension"; value: string }
  | { kind: "category"; value: string }
  | { kind: "layer"; value: string }
  | { kind: "entity-flag"; flag: "leverage" | "risk" | "bottleneck" | "convergence" | "ghost" }
  | { kind: "strategy-status"; value: string }
  | { kind: "strategy-ready-score"; value: number }
  | { kind: "strategy-version"; value: string };

export interface CardContext {
  /** tldraw shape id */
  shapeId: string;
  shapeType: string;
  /** The main content of the selected shape — used as the AI prompt subject. */
  primaryText: string;
  /** Supplementary blocks formatted independently per tab. */
  blocks: CardContextBlock[];
  /** For thread notes: the root shape id (the non-thread ancestor everything hangs on). */
  rootShapeId: string | null;
  /** For thread notes: total depth in the tree. */
  threadDepth: number | null;
}

interface UseCardSidecarContextOpts {
  editor: Editor | null;
  selectedShape: TLShape | null;
}

export function useCardSidecarContext({
  editor,
  selectedShape,
}: UseCardSidecarContextOpts): CardContext | null {
  return useMemo(() => {
    if (!editor || !selectedShape) return null;
    const shape = selectedShape;

    // ── thread-note: walk ancestors ─────────────────────────────────
    if (shape.type === "thread-note") {
      const t = shape as ThreadNoteShape;
      const blocks: CardContextBlock[] = [];

      let currentParentId: string | null = t.props.parentShapeId;
      let ancestorCount = 0;
      while (currentParentId && ancestorCount < MAX_ANCESTORS) {
        const parent = editor.getShape(
          currentParentId as TLShapeId,
        ) as TLShape | undefined;
        if (!parent) break;
        if (parent.type === "thread-note") {
          const p = parent as ThreadNoteShape;
          blocks.push({
            kind: "thread-ancestor",
            author: p.props.authorDisplay || null,
            text: p.props.text || "",
            depth: p.props.depth,
          });
          currentParentId = p.props.parentShapeId;
        } else {
          // Non-thread parent — walk stops here. Include its summary as a
          // single block too so AI knows the conversation root.
          blocks.push({
            kind: "thread-ancestor",
            author: null,
            text: primaryTextForShape(parent),
            depth: -1, // sentinel for "the root subject, not another reply"
          });
          currentParentId = null;
        }
        ancestorCount++;
      }
      // Ancestors accumulate deepest-first in the walk. Reverse so they
      // render oldest-first (like a normal conversation thread).
      blocks.reverse();

      return {
        shapeId: t.id,
        shapeType: t.type,
        primaryText: t.props.text || "",
        blocks,
        rootShapeId: t.props.rootShapeId || null,
        threadDepth: t.props.depth,
      };
    }

    // ── sticky-note ────────────────────────────────────────────────
    if (shape.type === "sticky-note") {
      const s = shape as StickyNoteShape;
      const blocks: CardContextBlock[] = [];
      if (s.props.dimension) {
        blocks.push({ kind: "dimension", value: s.props.dimension });
      }
      return {
        shapeId: s.id,
        shapeType: s.type,
        primaryText: s.props.text || "",
        blocks,
        rootShapeId: null,
        threadDepth: null,
      };
    }

    // ── kg-node ────────────────────────────────────────────────────
    if (shape.type === "kg-node") {
      const k = shape as KGNodeShape;
      const blocks: CardContextBlock[] = [
        { kind: "category", value: k.props.category },
        { kind: "layer", value: k.props.layer },
      ];
      if (k.props.isLeverage) blocks.push({ kind: "entity-flag", flag: "leverage" });
      if (k.props.isRisk) blocks.push({ kind: "entity-flag", flag: "risk" });
      if (k.props.isBottleneck) blocks.push({ kind: "entity-flag", flag: "bottleneck" });
      if (k.props.isConvergence) blocks.push({ kind: "entity-flag", flag: "convergence" });
      if (k.props.isGhost) blocks.push({ kind: "entity-flag", flag: "ghost" });
      return {
        shapeId: k.id,
        shapeType: k.type,
        primaryText: `${k.props.name}${k.props.description ? ` — ${k.props.description}` : ""}`,
        blocks,
        rootShapeId: null,
        threadDepth: null,
      };
    }

    // ── strategy-card ──────────────────────────────────────────────
    if (shape.type === "strategy-card") {
      const s = shape as StrategyShape;
      const blocks: CardContextBlock[] = [
        { kind: "strategy-status", value: s.props.status },
        { kind: "strategy-version", value: s.props.label },
      ];
      if (s.props.readyScore !== null) {
        blocks.push({ kind: "strategy-ready-score", value: s.props.readyScore });
      }
      return {
        shapeId: s.id,
        shapeType: s.type,
        primaryText: s.props.title || "Untitled strategy",
        blocks,
        rootShapeId: null,
        threadDepth: null,
      };
    }

    // ── fallback ──────────────────────────────────────────────────
    return {
      shapeId: shape.id,
      shapeType: shape.type,
      primaryText: primaryTextForShape(shape),
      blocks: [],
      rootShapeId: null,
      threadDepth: null,
    };
  }, [editor, selectedShape]);
}

/** Narrow helper for any unknown shape — extract "something representative". */
function primaryTextForShape(shape: TLShape): string {
  if (shape.type === "sticky-note") {
    return (shape as StickyNoteShape).props.text || "";
  }
  if (shape.type === "kg-node") {
    const k = shape as KGNodeShape;
    return `${k.props.name}${k.props.description ? ` — ${k.props.description}` : ""}`;
  }
  if (shape.type === "strategy-card") {
    return (shape as StrategyShape).props.title || "Strategy card";
  }
  if (shape.type === "thread-note") {
    return (shape as ThreadNoteShape).props.text || "";
  }
  return `(${shape.type})`;
}

// Serialisation helper used by tabs when calling API routes — keeps the
// shape of the payload consistent across the three endpoints.
export function serialiseContextForAPI(ctx: CardContext): {
  shape_id: string;
  shape_type: string;
  primary_text: string;
  thread_ancestors: Array<{ author: string | null; text: string; depth: number }>;
  tags: string[];
} {
  const tags: string[] = [];
  const ancestors: Array<{ author: string | null; text: string; depth: number }> = [];
  for (const b of ctx.blocks) {
    if (b.kind === "thread-ancestor") {
      ancestors.push({ author: b.author, text: b.text, depth: b.depth });
    } else if (b.kind === "dimension" || b.kind === "category" || b.kind === "layer") {
      tags.push(`${b.kind}:${b.value}`);
    } else if (b.kind === "entity-flag") {
      tags.push(`flag:${b.flag}`);
    } else if (b.kind === "strategy-status") {
      tags.push(`status:${b.value}`);
    } else if (b.kind === "strategy-version") {
      tags.push(`version:${b.value}`);
    } else if (b.kind === "strategy-ready-score") {
      tags.push(`ready:${b.value}`);
    }
  }
  return {
    shape_id: ctx.shapeId,
    shape_type: ctx.shapeType,
    primary_text: ctx.primaryText,
    thread_ancestors: ancestors,
    tags,
  };
}
