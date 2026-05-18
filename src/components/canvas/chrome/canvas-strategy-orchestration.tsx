"use client";

// ── Canvas strategy orchestration ─────────────────────────────────
//
// Two thin orchestrators that wire the StrategyHeroCardShape's
// canvas-side expand experience together. Both live inside the
// InFrontOfTheCanvas tree so they get useEditor() without prop
// drilling.
//
//   1. CanvasStrategyExpandResponder
//      - Listens for `strategy-hero:toggle-expand` from the hero shape
//      - Resizes the shape (collapsed 680×280 → expanded 880×680)
//      - Zooms the camera onto the shape's bounds (with headroom for
//        the expanded card)
//      - Sets `data-canvas-strategy-expanded` body attribute so a CSS
//        rule in globals.css can dim other canvas shapes
//      - Only one card expanded at a time — auto-collapses any prior
//
//   2. CanvasEntityGlowResponder
//      - Listens for `strategy-hover:entities` and `strategy-click:entity`
//      - On hover: applies a transient glow halo to the kg-node shapes
//        whose entity_id matches the dispatched ids
//      - On click: pans camera to the first referenced entity's bounds
//      - Glow auto-clears after 1.5s
//
// Together these create the "expand card → hover tactic → entities
// glow on canvas → click tactic → camera pans to entity" experience.

import { useCallback, useEffect, useRef } from "react";
import { useEditor, type TLShapeId } from "tldraw";
import {
  STRATEGY_HERO_DEFAULT_W,
  STRATEGY_HERO_DEFAULT_H,
  STRATEGY_HERO_EXPANDED_W,
  STRATEGY_HERO_EXPANDED_H,
} from "@/components/canvas/shapes/strategy-hero-card-shape";

// ── 1. CanvasStrategyExpandResponder ──

const EXPANDED_BODY_ATTR = "data-canvas-strategy-expanded";
const EXPAND_ANIM_MS = 460;
const COLLAPSE_ANIM_MS = 360;

interface ToggleExpandDetail {
  shapeId: TLShapeId;
  expanded: boolean;
  spaceId: string;
}

export function CanvasStrategyExpandResponder() {
  const editor = useEditor();
  // Track the currently expanded shape so we can auto-collapse any
  // prior when a new one expands. Stored in a ref to avoid re-renders.
  const expandedShapeRef = useRef<TLShapeId | null>(null);

  // Easing helper — visionOS-style spring matches the rest of the
  // cinematic vocabulary (twin reveal, entrance animations).
  const easeInOutQuart = useCallback(
    (t: number) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
    [],
  );

  useEffect(() => {
    if (!editor) return;
    if (typeof document === "undefined") return;

    function collapseShape(shapeId: TLShapeId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shape = editor.getShape(shapeId) as any;
        if (!shape) return;
        editor.updateShape({
          id: shapeId,
          type: shape.type,
          props: {
            ...shape.props,
            w: STRATEGY_HERO_DEFAULT_W,
            h: STRATEGY_HERO_DEFAULT_H,
          },
        });
      } catch (err) {
        console.warn("[strategy-expand] collapseShape failed:", err);
      }
    }

    function expandShape(shapeId: TLShapeId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shape = editor.getShape(shapeId) as any;
        if (!shape) return;
        editor.updateShape({
          id: shapeId,
          type: shape.type,
          props: {
            ...shape.props,
            w: STRATEGY_HERO_EXPANDED_W,
            h: STRATEGY_HERO_EXPANDED_H,
          },
        });
      } catch (err) {
        console.warn("[strategy-expand] expandShape failed:", err);
      }
    }

    function reframeOnShape(shapeId: TLShapeId, duration: number) {
      try {
        const bounds = editor.getShapePageBounds(shapeId);
        if (!bounds) return;
        // Padding above + below so the headline/footer don't kiss the
        // viewport edges. Camera reframe matches the twin reveal's
        // ease curve for cinematic continuity.
        const padded = {
          x: bounds.x - 60,
          y: bounds.y - 100,
          w: bounds.w + 120,
          h: bounds.h + 160,
        };
        editor.zoomToBounds(padded, {
          animation: { duration, easing: easeInOutQuart },
          inset: 0,
        });
      } catch (err) {
        console.warn("[strategy-expand] reframeOnShape failed:", err);
      }
    }

    function onToggle(ev: Event) {
      const detail = (ev as CustomEvent<ToggleExpandDetail>).detail;
      if (!detail) return;
      const { shapeId, expanded } = detail;

      if (expanded) {
        // If another card is already expanded, collapse it first so
        // only one card holds the "expanded" state at a time.
        if (
          expandedShapeRef.current &&
          expandedShapeRef.current !== shapeId
        ) {
          collapseShape(expandedShapeRef.current);
        }
        expandedShapeRef.current = shapeId;
        // Resize → wait one frame → reframe camera. Splitting the
        // operations gives the resize a chance to apply before
        // zoomToBounds reads the new bounds.
        expandShape(shapeId);
        requestAnimationFrame(() => {
          reframeOnShape(shapeId, EXPAND_ANIM_MS);
        });
        document.body.setAttribute(EXPANDED_BODY_ATTR, "true");
      } else {
        if (expandedShapeRef.current === shapeId) {
          expandedShapeRef.current = null;
        }
        collapseShape(shapeId);
        requestAnimationFrame(() => {
          reframeOnShape(shapeId, COLLAPSE_ANIM_MS);
        });
        document.body.removeAttribute(EXPANDED_BODY_ATTR);
      }
    }

    window.addEventListener("strategy-hero:toggle-expand", onToggle);
    return () => {
      window.removeEventListener("strategy-hero:toggle-expand", onToggle);
      document.body.removeAttribute(EXPANDED_BODY_ATTR);
    };
  }, [editor, easeInOutQuart]);

  return null;
}

// ── 2. CanvasEntityGlowResponder ──

interface HoverEntitiesDetail {
  entity_ids: string[];
}
interface ClickEntityDetail {
  entity_id: string;
}

const GLOW_DURATION_MS = 1500;

export function CanvasEntityGlowResponder() {
  const editor = useEditor();
  // Track which shapes currently have glow applied so we can clean
  // up before reapplying or on unmount.
  const glowingShapesRef = useRef<Set<TLShapeId>>(new Set());
  const glowTimerRef = useRef<number | null>(null);

  const easeInOutQuart = useCallback(
    (t: number) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
    [],
  );

  useEffect(() => {
    if (!editor) return;

    function clearGlow() {
      for (const shapeId of glowingShapesRef.current) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const shape = editor.getShape(shapeId) as any;
          if (!shape) continue;
          // Strip the meta flag — the kg-node-shape's renderer reads
          // meta.strategy_glow and applies the visual treatment.
          editor.updateShape({
            id: shapeId,
            type: shape.type,
            meta: {
              ...(shape.meta ?? {}),
              strategy_glow: undefined,
            },
          });
        } catch {
          // Shape may have been deleted mid-glow; ignore.
        }
      }
      glowingShapesRef.current.clear();
    }

    function findKgNodeShapesForEntityIds(entityIds: string[]): TLShapeId[] {
      const all = editor.getCurrentPageShapes();
      const matches: TLShapeId[] = [];
      for (const s of all) {
        if (s.type !== "kg-node") continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const props = s.props as any;
        if (entityIds.includes(props?.entityId)) {
          matches.push(s.id);
        }
      }
      return matches;
    }

    function onHover(ev: Event) {
      const detail = (ev as CustomEvent<HoverEntitiesDetail>).detail;
      if (!detail?.entity_ids?.length) return;
      // Cancel any existing glow timer + clear current glow
      if (glowTimerRef.current !== null) {
        window.clearTimeout(glowTimerRef.current);
      }
      clearGlow();

      const shapeIds = findKgNodeShapesForEntityIds(detail.entity_ids);
      for (const id of shapeIds) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const shape = editor.getShape(id) as any;
          if (!shape) continue;
          editor.updateShape({
            id,
            type: shape.type,
            meta: {
              ...(shape.meta ?? {}),
              strategy_glow: Date.now(),
            },
          });
          glowingShapesRef.current.add(id);
        } catch (err) {
          console.warn("[entity-glow] updateShape failed:", err);
        }
      }
      // Auto-clear after pulse duration
      glowTimerRef.current = window.setTimeout(() => {
        clearGlow();
        glowTimerRef.current = null;
      }, GLOW_DURATION_MS);
    }

    function onClick(ev: Event) {
      const detail = (ev as CustomEvent<ClickEntityDetail>).detail;
      if (!detail?.entity_id) return;
      const matches = findKgNodeShapesForEntityIds([detail.entity_id]);
      if (matches.length === 0) return;
      try {
        const bounds = editor.getShapePageBounds(matches[0]);
        if (!bounds) return;
        const padded = {
          x: bounds.x - 80,
          y: bounds.y - 80,
          w: bounds.w + 160,
          h: bounds.h + 160,
        };
        editor.zoomToBounds(padded, {
          animation: { duration: 800, easing: easeInOutQuart },
          inset: 0,
        });
      } catch (err) {
        console.warn("[entity-glow] camera pan failed:", err);
      }
    }

    window.addEventListener("strategy-hover:entities", onHover);
    window.addEventListener("strategy-click:entity", onClick);
    return () => {
      window.removeEventListener("strategy-hover:entities", onHover);
      window.removeEventListener("strategy-click:entity", onClick);
      if (glowTimerRef.current !== null) {
        window.clearTimeout(glowTimerRef.current);
      }
      clearGlow();
    };
  }, [editor, easeInOutQuart]);

  return null;
}
