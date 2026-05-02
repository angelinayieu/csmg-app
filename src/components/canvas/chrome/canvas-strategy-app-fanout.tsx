"use client";

// ── Canvas strategy → app fan-out connectors ───────────────────────────
//
// Phase 1.4 of the roadmap. When the user has a strategy-hero-card on
// canvas plus N app-card shapes (whether materialized via the painter
// at lab stage, hydrated from the apps table, or library-dragged),
// this overlay paints elbow arrows from the strategy down to each
// app — making the "plan → branches" flow visible at a glance.
//
// Why an overlay (not inline in the painter): apps land via several
// paths (app-card-hydrator, library drag, generate-apps painter
// emission). Wiring connector creation into each of those paths
// creates four places to maintain. A single reactive overlay watching
// `getCurrentPageShapes()` keeps the connector logic in one file.
//
// Idempotent: each fan-out arrow is keyed by
// `meta.strategyAppFanout = "{strategyShapeId}->{appShapeId}"` so
// re-renders just no-op. When an app is deleted, its arrow goes with
// it via tldraw's binding cleanup; we ALSO sweep on each tick to
// catch any orphans (stale strategy ref, etc.).

import { useEffect, useMemo } from "react";
import {
  useEditor,
  useValue,
  createShapeId,
  toRichText,
  type TLArrowShape,
  type TLShapeId,
  type TLShapePartial,
} from "tldraw";

interface Props {
  spaceId: string;
}

interface ShapeIndex {
  strategyHeroId: TLShapeId | null;
  /** appShapeId → meta key we expect to see on the matching arrow */
  appShapeIds: TLShapeId[];
  /** existing arrow connectors keyed by their meta.strategyAppFanout */
  arrowsByKey: Map<string, TLShapeId>;
}

function indexCanvas(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shapes: ReadonlyArray<any>,
): ShapeIndex {
  let strategyHeroId: TLShapeId | null = null;
  const appShapeIds: TLShapeId[] = [];
  const arrowsByKey = new Map<string, TLShapeId>();
  for (const shape of shapes) {
    if (shape.type === "strategy-hero-card") {
      strategyHeroId = shape.id as TLShapeId;
    } else if (shape.type === "app-card") {
      appShapeIds.push(shape.id as TLShapeId);
    } else if (shape.type === "arrow") {
      const key = shape.meta?.strategyAppFanout;
      if (typeof key === "string" && key) arrowsByKey.set(key, shape.id);
    }
  }
  return { strategyHeroId, appShapeIds, arrowsByKey };
}

export function CanvasStrategyAppFanout({ spaceId: _spaceId }: Props) {
  const editor = useEditor();

  // Reactive shape index — re-computes whenever any shape on the
  // current page changes type, position, or count. Using ids only as
  // the dependency so a position-jiggle doesn't re-trigger arrow
  // creation; tldraw arrow bindings handle position updates natively.
  const idsSignal = useValue<string>(
    "strategy-fanout-ids-signal",
    () => {
      if (!editor) return "";
      let key = "";
      for (const shape of editor.getCurrentPageShapes()) {
        if (
          shape.type === "strategy-hero-card" ||
          shape.type === "app-card"
        ) {
          key += `${shape.type}:${shape.id};`;
        } else if (
          shape.type === "arrow" &&
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          typeof (shape as any).meta?.strategyAppFanout === "string"
        ) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          key += `arrow:${(shape as any).meta.strategyAppFanout};`;
        }
      }
      return key;
    },
    [editor],
  );

  const desiredKeys = useMemo(() => {
    if (!editor) return null;
    const idx = indexCanvas(editor.getCurrentPageShapes());
    return idx;
  }, [editor, idsSignal]);

  useEffect(() => {
    if (!editor || !desiredKeys) return;
    const { strategyHeroId, appShapeIds, arrowsByKey } = desiredKeys;

    // No strategy hero on canvas → drop ALL fan-out arrows. They're
    // meaningless without the source. Tldraw's binding cleanup would
    // probably get most of these anyway when the strategy was deleted,
    // but be defensive.
    if (!strategyHeroId) {
      const stale = Array.from(arrowsByKey.values());
      if (stale.length) {
        editor.run(
          () => editor.deleteShapes(stale),
          { history: "ignore" },
        );
      }
      return;
    }

    // Compute desired arrows: one per (strategyHeroId, appShapeId).
    const desired = new Set<string>();
    for (const appId of appShapeIds) {
      desired.add(`${strategyHeroId}->${appId}`);
    }

    // Delete arrows whose key is no longer desired (app removed,
    // strategy hero swapped, etc.).
    const toDelete: TLShapeId[] = [];
    for (const [key, arrowId] of arrowsByKey) {
      if (!desired.has(key)) toDelete.push(arrowId);
    }

    // Create arrows for any desired keys we don't already have.
    const toCreate: Array<{
      arrow: TLShapePartial<TLArrowShape>;
      bindings: Array<{
        fromId: TLShapeId;
        toId: TLShapeId;
        terminal: "start" | "end";
        anchor: { x: number; y: number };
      }>;
    }> = [];
    for (const key of desired) {
      if (arrowsByKey.has(key)) continue;
      const [, appId] = key.split("->");
      const arrowId = createShapeId();
      toCreate.push({
        arrow: {
          id: arrowId,
          type: "arrow",
          props: {
            color: "grey",
            size: "s",
            font: "sans",
            dash: "solid",
            kind: "elbow",
            arrowheadStart: "none",
            arrowheadEnd: "arrow",
            richText: toRichText(""),
          },
          meta: {
            source: "strategy-app-fanout",
            strategyAppFanout: key,
          },
        },
        bindings: [
          {
            fromId: arrowId,
            toId: strategyHeroId,
            terminal: "start",
            anchor: { x: 0.5, y: 1 },
          },
          {
            fromId: arrowId,
            toId: appId as TLShapeId,
            terminal: "end",
            anchor: { x: 0.5, y: 0 },
          },
        ],
      });
    }

    if (toDelete.length === 0 && toCreate.length === 0) return;

    // Apply diff in a single history-ignored run so undo/redo isn't
    // polluted by these cosmetic-only connector flips.
    editor.run(
      () => {
        if (toDelete.length) editor.deleteShapes(toDelete);
        for (const item of toCreate) {
          editor.createShapes([item.arrow]);
          try {
            editor.createBindings(
              item.bindings.map((b) => ({
                fromId: b.fromId,
                toId: b.toId,
                type: "arrow" as const,
                props: {
                  terminal: b.terminal,
                  normalizedAnchor: b.anchor,
                  isExact: false,
                  isPrecise: false,
                },
                meta: {},
              })),
            );
          } catch (err) {
            // Per-arrow failure shouldn't break the whole pass.
            // eslint-disable-next-line no-console
            console.warn("[strategy-fanout] arrow bind failed:", err);
          }
        }
      },
      { history: "ignore" },
    );
  }, [editor, desiredKeys]);

  return null;
}
