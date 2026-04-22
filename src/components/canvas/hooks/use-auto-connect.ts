"use client";

// ── useAutoConnect (Phase 2D) ──
//
// Watches for sticky-note edits/creations. When the user adds a
// sticky or changes its text and the brainstorm auto-connect
// feature is enabled, pair-scans the sticky against every other
// sticky on the canvas using local Jaccard similarity. Pairs above
// a moderate threshold get an AI-suggested arrow materialized
// between them (dashed gray so it's visually distinct from
// user-drawn arrows).
//
// Design notes:
//   - Pure local computation, no network. Runs instantly on every
//     text change and costs nothing.
//   - Debounced — 2s after the last edit so we don't recompute on
//     every keystroke while the user is typing.
//   - Idempotent — a `pairKey` set tracks which pairs have been
//     connected so we never duplicate arrows.
//   - Respectful of user agency — once a user deletes an AI-created
//     arrow, we track the pair as "dismissed" in a session-scoped
//     ref so we don't re-create it. Reopening the space resets
//     dismissals (intentional — users may want to re-run after
//     adding new context).
//
// The companion `deepSearch` toggle (future) layers network-backed
// semantic similarity on top of this for subtler connections. The
// two compose — auto-connect finds obvious overlaps; deep-search
// catches the non-obvious ones.

import { useEffect, useRef } from "react";
import {
  createShapeId,
  type Editor,
  type TLArrowShape,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
} from "tldraw";
import {
  jaccardSimilarity,
  pairKey,
  tokenize,
} from "@/lib/brainstorm/text-similarity";
import type { StickyNoteShape } from "../shapes/types";

// Threshold tuning — calibrated on common sticky text patterns.
// Below 0.30 = noise; above 0.50 = near-duplicates (rare). 0.35
// catches obvious thematic overlap without over-connecting.
const SIMILARITY_THRESHOLD = 0.35;

// Minimum text length before we bother scanning. Stickies with
// fewer characters are too sparse for Jaccard to produce meaningful
// scores.
const MIN_TEXT_LENGTH = 10;

// Debounce window — wait N ms after the last edit before scanning.
// 2s feels right for typing cadence: long enough to avoid thrashing
// per keystroke, short enough that suggestions arrive while the
// user still has the context in mind.
const DEBOUNCE_MS = 2000;

/**
 * Snapshot each sticky's (id, text) at scan time. Avoids holding
 * stale shape references across async boundaries.
 */
interface StickySnapshot {
  id: TLShapeId;
  text: string;
}

function collectStickies(editor: Editor): StickySnapshot[] {
  const out: StickySnapshot[] = [];
  for (const id of editor.getCurrentPageShapeIds()) {
    const shape = editor.getShape(id) as TLShape | undefined;
    if (!shape || shape.type !== "sticky-note") continue;
    const text = (shape as StickyNoteShape).props.text ?? "";
    if (text.trim().length < MIN_TEXT_LENGTH) continue;
    out.push({ id, text });
  }
  return out;
}

/**
 * Check whether any existing arrow on the canvas binds the two
 * given shapes together (in either direction). Used to skip pairs
 * that the user or a prior scan already connected.
 */
function hasExistingArrowBetween(
  editor: Editor,
  aId: TLShapeId,
  bId: TLShapeId,
): boolean {
  const aBindings = editor.getBindingsInvolvingShape(aId, "arrow");
  if (aBindings.length === 0) return false;
  const aArrowIds = new Set(aBindings.map((b) => b.fromId));
  const bBindings = editor.getBindingsInvolvingShape(bId, "arrow");
  for (const binding of bBindings) {
    if (aArrowIds.has(binding.fromId)) return true;
  }
  return false;
}

/**
 * Materialize a dashed gray arrow between two shapes. Style matches
 * `pipeline-event-painter.tsx`'s ghost-edge convention so users
 * recognize AI-suggested connections at a glance.
 */
function createArrowBetween(
  editor: Editor,
  fromId: TLShapeId,
  toId: TLShapeId,
): TLShapeId | null {
  const arrowId = createShapeId();
  try {
    const arrow: TLShapePartial<TLArrowShape> = {
      id: arrowId,
      type: "arrow",
      props: {
        color: "grey",
        size: "s",
        dash: "dashed",
      },
      meta: {
        // Mark the arrow as AI-created so future features (an undo
        // affordance, an accept/reject review mode) can filter it.
        source: "auto-connect",
      },
    };
    editor.createShapes([arrow]);
    editor.createBindings([
      {
        fromId: arrowId,
        toId: fromId,
        type: "arrow",
        props: {
          terminal: "start",
          normalizedAnchor: { x: 0.5, y: 0.5 },
          isExact: false,
          isPrecise: false,
        },
        meta: {},
      },
      {
        fromId: arrowId,
        toId: toId,
        type: "arrow",
        props: {
          terminal: "end",
          normalizedAnchor: { x: 0.5, y: 0.5 },
          isExact: false,
          isPrecise: false,
        },
        meta: {},
      },
    ]);
    return arrowId;
  } catch (err) {
    // Binding creation can fail if shapes disappeared between
    // snapshot + mutation. Log + skip — next tick re-evaluates.
    console.warn("[auto-connect] arrow binding failed:", err);
    return null;
  }
}

export interface UseAutoConnectOptions {
  editor: Editor | null;
  enabled: boolean;
}

export function useAutoConnect({ editor, enabled }: UseAutoConnectOptions) {
  const connectedPairsRef = useRef<Set<string>>(new Set());
  const dismissedPairsRef = useRef<Set<string>>(new Set());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    if (!enabled || !editor) {
      // Clean exit — cancel pending timer so we don't fire after
      // the toggle flipped off.
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      return;
    }

    // Track arrow deletions — when the user removes an auto-
    // created arrow, mark the pair as dismissed so we don't re-add
    // it on the next scan. Session-scoped; resets on reload.
    const handleArrowRemoval = (shapeId: TLShapeId) => {
      const shape = editor.getShape(shapeId);
      if (!shape || shape.type !== "arrow") return;
      const meta = (shape.meta ?? {}) as Record<string, unknown>;
      if (meta.source !== "auto-connect") return;
      const bindings = editor.getBindingsFromShape(shapeId, "arrow");
      if (bindings.length < 2) return;
      const [a, b] = bindings.map((binding) => binding.toId);
      if (!a || !b) return;
      dismissedPairsRef.current.add(pairKey(a, b));
      connectedPairsRef.current.delete(pairKey(a, b));
    };

    const runScan = () => {
      try {
        const stickies = collectStickies(editor);
        if (stickies.length < 2) return;

        // Tokenize once per sticky to avoid re-computation inside
        // the O(n^2) pair loop.
        const tokenSets = new Map<TLShapeId, Set<string>>();
        for (const s of stickies) {
          tokenSets.set(s.id, tokenize(s.text));
        }

        for (let i = 0; i < stickies.length; i++) {
          const a = stickies[i];
          const aTokens = tokenSets.get(a.id)!;
          if (aTokens.size < 2) continue;
          for (let j = i + 1; j < stickies.length; j++) {
            const b = stickies[j];
            const key = pairKey(a.id, b.id);
            if (connectedPairsRef.current.has(key)) continue;
            if (dismissedPairsRef.current.has(key)) continue;
            if (hasExistingArrowBetween(editor, a.id, b.id)) {
              // User or prior scan already connected these — track
              // so we don't recompute on every tick.
              connectedPairsRef.current.add(key);
              continue;
            }

            const bTokens = tokenSets.get(b.id)!;
            if (bTokens.size < 2) continue;
            const sim = jaccardSimilarity(aTokens, bTokens);
            if (sim >= SIMILARITY_THRESHOLD) {
              const arrowId = createArrowBetween(editor, a.id, b.id);
              if (arrowId) {
                connectedPairsRef.current.add(key);
              }
            }
          }
        }
      } catch (err) {
        console.warn("[auto-connect] scan failed:", err);
      }
    };

    // Listen to document changes — debounce scans so we don't fire
    // during typing. Filter to user-sourced changes so our own
    // arrow insertions don't trigger re-scans.
    const unsubscribe = editor.store.listen(
      (entry) => {
        // Cheap check: skip non-sticky/arrow changes. Any edit to a
        // sticky's `text` prop OR creation of a new sticky should
        // trigger a scan. Arrow deletions are also relevant (to
        // update dismissedPairs).
        const touched = [
          ...Object.values(entry.changes.added),
          ...Object.values(entry.changes.updated).map((u) =>
            Array.isArray(u) ? u[1] : u,
          ),
          ...Object.values(entry.changes.removed),
        ];

        let relevant = false;
        for (const rec of touched) {
          if (!rec || typeof rec !== "object") continue;
          const typeVal = (rec as { typeName?: unknown }).typeName;
          if (typeVal !== "shape") continue;
          const shapeType = (rec as { type?: unknown }).type;
          if (shapeType === "sticky-note" || shapeType === "arrow") {
            relevant = true;
            break;
          }
        }
        if (!relevant) return;

        // Track arrow removals for dismissal.
        for (const removed of Object.values(entry.changes.removed)) {
          const r = removed as { typeName?: unknown; id?: unknown; type?: unknown };
          if (r.typeName === "shape" && r.type === "arrow" && typeof r.id === "string") {
            handleArrowRemoval(r.id as TLShapeId);
          }
        }

        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(runScan, DEBOUNCE_MS);
      },
      { source: "user", scope: "document" },
    );

    // Kick off an initial scan on mount — catches any stickies that
    // were already present before the toggle was enabled.
    debounceTimerRef.current = setTimeout(runScan, DEBOUNCE_MS);

    return () => {
      unsubscribe();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [editor, enabled]);
}
