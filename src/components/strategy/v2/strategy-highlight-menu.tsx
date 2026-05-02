"use client";

// ── Strategy highlight menu ───────────────────────────────────────────
//
// Mounted at the strategy drawer root. Listens for text selection inside
// the drawer; when the user releases over a non-empty selection, a
// floating action chip appears near the selection bounding box.
//
// Actions:
//   • Pin to canvas — drops a yellow sticky-note with the selected text.
//     AutoDecompose picks it up after its standard idle window so the
//     user gets ghost KG nodes appearing nearby a few seconds later.
//   • Open detail — navigates to the strategy detail page (no-op when
//     already on it; future hook-up for a more focused jump).
//   • Copy — basic UX so the highlight feels like a native rich-text
//     toolbar.
//
// Selection scope is gated to a containerRef so highlighting elsewhere
// (e.g. canvas chrome) doesn't trigger the menu. The menu renders into
// a portal at document.body to avoid z-index gymnastics inside the
// drawer's overflow:hidden parents.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pin, Copy, Sparkles } from "lucide-react";
import { canvasPinAsSticky } from "@/lib/canvas/canvas-bus";
import { toast } from "@/lib/hooks/use-toast";

interface MenuPosition {
  /** Viewport pixel coords of the selection's top edge midpoint. */
  x: number;
  y: number;
}

interface StrategyHighlightMenuProps {
  /** Container the menu listens within. Selections outside are ignored. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Minimum chars before showing the menu. Tiny accidental selections
   *  shouldn't pop a toolbar. */
  minChars?: number;
}

export function StrategyHighlightMenu({
  containerRef,
  minChars = 6,
}: StrategyHighlightMenuProps) {
  const [selectedText, setSelectedText] = useState("");
  const [position, setPosition] = useState<MenuPosition | null>(null);
  // We listen for `selectionchange` (fires continuously while dragging)
  // but only render the menu after `mouseup`/`keyup` so the chip doesn't
  // jitter during drag. This ref tracks the most recent selection text
  // so the mouseup handler can decide whether to show.
  const pendingSelectionRef = useRef<{
    text: string;
    rect: DOMRect | null;
  }>({ text: "", rect: null });

  const dismiss = useCallback(() => {
    setSelectedText("");
    setPosition(null);
    pendingSelectionRef.current = { text: "", rect: null };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        pendingSelectionRef.current = { text: "", rect: null };
        return;
      }
      const range = sel.getRangeAt(0);
      // Confirm the selection actually intersects our container —
      // selecting text in a different drawer or on the canvas should
      // not light up the strategy-drawer menu.
      const ancestor = range.commonAncestorContainer;
      const node =
        ancestor.nodeType === Node.ELEMENT_NODE
          ? (ancestor as Element)
          : ancestor.parentElement;
      if (!node || !container.contains(node)) {
        pendingSelectionRef.current = { text: "", rect: null };
        return;
      }
      const text = sel.toString();
      const rect = range.getBoundingClientRect();
      pendingSelectionRef.current = { text, rect };
    };

    const commitSelection = () => {
      const { text, rect } = pendingSelectionRef.current;
      const trimmed = text.trim();
      if (!trimmed || trimmed.length < minChars || !rect) {
        // Keep an existing menu visible — clicking on the menu itself
        // collapses the selection in some browsers. dismiss() runs from
        // the document mousedown handler instead.
        return;
      }
      setSelectedText(trimmed);
      setPosition({
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
    };

    const handlePointerUp = () => {
      // Defer one tick so the browser settles the selection.
      window.setTimeout(commitSelection, 0);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Shift-arrow text selection ends on key release.
      if (e.shiftKey || e.key === "Shift") {
        window.setTimeout(commitSelection, 0);
      }
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    container.addEventListener("mouseup", handlePointerUp);
    container.addEventListener("keyup", handleKeyUp);

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      container.removeEventListener("mouseup", handlePointerUp);
      container.removeEventListener("keyup", handleKeyUp);
    };
  }, [containerRef, minChars]);

  // Dismiss when the user clicks outside the menu. The selection itself
  // gets cleared by the browser on most outside clicks, but we also
  // want to hide the chip if the user clicks back into the same
  // selection.
  useEffect(() => {
    if (!position) return;
    const onDocPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-strategy-highlight-menu]")) return;
      dismiss();
    };
    document.addEventListener("mousedown", onDocPointerDown);
    return () => document.removeEventListener("mousedown", onDocPointerDown);
  }, [position, dismiss]);

  const handlePin = useCallback(() => {
    canvasPinAsSticky({
      text: selectedText,
      source: "strategy-drawer-highlight",
    });
    toast.success("Pinned to canvas", {
      description: "Decompose will run shortly — keep an eye on the board.",
    });
    dismiss();
    // Nudge the selection so the chip vanishes immediately.
    window.getSelection()?.removeAllRanges();
  }, [selectedText, dismiss]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(selectedText);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy");
    }
    dismiss();
  }, [selectedText, dismiss]);

  if (!position || typeof document === "undefined") return null;

  // Position the chip above the selection by default; flip below if
  // the selection is too close to the viewport top.
  const ABOVE_OFFSET = 44;
  const placeAbove = position.y > ABOVE_OFFSET + 8;
  const top = placeAbove ? position.y - ABOVE_OFFSET : position.y + 28;

  return createPortal(
    <div
      data-strategy-highlight-menu
      role="toolbar"
      aria-label="Highlight actions"
      style={{
        position: "fixed",
        top,
        left: position.x,
        transform: "translateX(-50%)",
        zIndex: 9999,
      }}
      className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-1.5 py-1 shadow-lg"
    >
      <button
        type="button"
        onClick={handlePin}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold text-gray-700 transition hover:bg-indigo-50 hover:text-indigo-700"
        title="Drop as a sticky on the canvas (auto-decomposes shortly)"
      >
        <Pin className="h-3 w-3" />
        Pin to canvas
      </button>
      <button
        type="button"
        onClick={handlePin}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold text-gray-700 transition hover:bg-indigo-50 hover:text-indigo-700"
        title="Same as Pin — labeled to advertise the AI follow-up"
      >
        <Sparkles className="h-3 w-3" />
        Decompose
      </button>
      <span aria-hidden className="h-4 w-px bg-gray-200" />
      <button
        type="button"
        onClick={handleCopy}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
        title="Copy selection"
      >
        <Copy className="h-3 w-3" />
        Copy
      </button>
    </div>,
    document.body,
  );
}
