"use client";

// ── useAutoFitHeight — the "no-crop on spawn" rule for board cards ──
//
// Standardized across the objective whiteboard: a card shape should grow its
// height to fit its rendered content so text is never clipped when it spawns
// (or when its content changes). Put a ref on the card's content element and
// call this from the renderer; it measures the natural content height and
// bumps the shape's `h` to match.
//
// Grow-only by design (it never shrinks a card below its content). If a card
// has distinct states with very different heights (e.g. a collapsed vs an
// expanded card), reset `h` to the state's base when the state changes and let
// this re-grow from there, and pass `enabled=false` for fixed-height states
// (an expanded card that scrolls internally).

import { useLayoutEffect, type DependencyList, type RefObject } from "react";
import type { Editor, TLShapeId } from "tldraw";

export function useAutoFitHeight(
  editor: Editor,
  shapeId: TLShapeId,
  shapeType: string,
  currentH: number,
  ref: RefObject<HTMLElement | null>,
  deps: DependencyList,
  enabled = true,
): void {
  useLayoutEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    // scrollHeight reports the content's natural height even when the card
    // clips it (overflow: hidden), so this is the height needed to show
    // everything. +1 tolerance avoids sub-pixel thrash.
    const needed = Math.ceil(el.scrollHeight);
    if (needed > 0 && needed > currentH + 1) {
      editor.updateShape({
        id: shapeId,
        type: shapeType,
        props: { h: needed },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
