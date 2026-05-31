// ── SpecForge Runner (tldraw-coupled) ──
//
// Runs the full SpecForge engine chain for one idea shape and unfurls the
// decision cards LIVE below it — the spec "writes itself" down the page as each
// engine returns. Mirrors operation-executor.ts (anchor-below-source + reveal)
// but for a sequenced chain that threads accumulated context forward. Imported
// only by whiteboard-base (the trigger) — the only tldraw consumer.
//
// Layout: a centered vertical SPINE of decision cards (converge), then the MVP
// variations three-across (diverge), then one wide recommendation card (the
// chosen first build). Each engine soft-fails independently: a failed stage just
// drops no card and the chain continues with whatever context exists.

import {
  createShapeId,
  type Editor,
  type TLShapeId,
  type TLArrowShape,
  type TLShapePartial,
} from "tldraw";
import type { SpecForgeCardShape } from "../shapes/specforge-card-shape";
import {
  SPECFORGE_CHAIN,
  ENGINE_LABEL,
  type SpecForgeCard,
  type SpecForgeEngineId,
} from "@/lib/objective-canvas/specforge/types";
import {
  resultToCards,
  summarizeForContext,
} from "@/lib/objective-canvas/specforge/cards";

export interface SpecForgeProgress {
  phase: "running" | "done" | "error";
  /** Engines completed (0…total). */
  done: number;
  total: number;
  /** Human label for the engine currently running (or last finished). */
  label: string;
}

interface RunOptions {
  onProgress?: (p: SpecForgeProgress) => void;
}

const ANCHOR_GAP = 48;
const ROW_GAP = 18;
const SPINE_W = 340;
const MVP_W = 232;
const MVP_GAP = 16;
const HERO_W = 460;
const ENGINE_TIMEOUT_MS = 45_000;

/** Estimate a card's height from its content so the spine packs tightly. */
function cardHeight(card: SpecForgeCard): number {
  if (card.layout === "hero") return 176;
  if (card.layout === "diverge") return 188;
  const lines = card.body
    ? card.body.split("\n").filter((l) => l.trim()).length
    : 0;
  const h = 92 + (card.subtitle ? 30 : 0) + Math.min(lines, 4) * 17;
  return Math.max(104, Math.min(186, h));
}

async function fetchEngine(
  engine: SpecForgeEngineId,
  idea: string,
  context: string,
): Promise<unknown | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
  try {
    const res = await fetch("/api/canvas/specforge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        engine,
        idea: idea.slice(0, 6000),
        context: context.slice(0, 8000),
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: unknown };
    return json.result ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Run the chain for `idea` and stream decision cards below `shapeId`. */
export async function runSpecForge(
  editor: Editor,
  target: { text: string; shapeId?: string },
  opts: RunOptions = {},
): Promise<void> {
  const idea = (target.text ?? "").trim();
  if (!idea) return;

  // Anchor the spine just below the source idea (fallback: viewport center).
  let anchorMidX: number;
  let cursorY: number;
  const bounds = target.shapeId
    ? editor.getShapePageBounds(target.shapeId as TLShapeId)
    : undefined;
  if (bounds) {
    anchorMidX = bounds.midX;
    cursorY = bounds.maxY + ANCHOR_GAP;
  } else {
    const vp = editor.getViewportPageBounds();
    anchorMidX = vp.center.x;
    cursorY = vp.center.y;
  }

  const total = SPECFORGE_CHAIN.length;
  const contextParts: string[] = [];
  const stamp = Date.now();
  let createdAny = false;
  // Every placed card, in causal order — threaded into a connected
  // dependency graph (sequence → fork → converge) once the chain finishes.
  const allPlaced: PlacedCard[] = [];

  opts.onProgress?.({
    phase: "running",
    done: 0,
    total,
    label: ENGINE_LABEL[SPECFORGE_CHAIN[0]],
  });

  for (let idx = 0; idx < SPECFORGE_CHAIN.length; idx++) {
    const engine = SPECFORGE_CHAIN[idx];
    opts.onProgress?.({
      phase: "running",
      done: idx,
      total,
      label: ENGINE_LABEL[engine],
    });

    const result = await fetchEngine(engine, idea, contextParts.join("\n\n"));
    if (result) {
      const summary = summarizeForContext(engine, result);
      if (summary) contextParts.push(`[${engine}]\n${summary}`);

      const cards = resultToCards(engine, result);
      if (cards.length) {
        const batch = placeBatch(editor, cards, engine, anchorMidX, cursorY, stamp);
        cursorY = batch.cursorY;
        allPlaced.push(...batch.placed);
        createdAny = true;
      }
    }
  }

  // Thread the spec into a connected dependency graph: a black node-line
  // down the spine, forking out to the MVP variations, then converging on
  // the recommended first build. Connectors sit beneath the cards.
  if (allPlaced.length > 1) connectSpecCards(editor, allPlaced);

  opts.onProgress?.({
    phase: "done",
    done: total,
    total,
    label: "Spec complete",
  });

  // Reveal the whole unfurl without yanking the zoom too hard.
  if (createdAny && bounds) {
    editor.centerOnPoint(
      { x: anchorMidX, y: (bounds.maxY + cursorY) / 2 },
      { animation: { duration: 360 } },
    );
  }
}

/** Place one engine's cards and return the new Y cursor. Diverge batches lay
 *  out three-across; spine + hero stack centered. */
function placeBatch(
  editor: Editor,
  cards: SpecForgeCard[],
  engine: SpecForgeEngineId,
  anchorMidX: number,
  startY: number,
  stamp: number,
): { cursorY: number; placed: PlacedCard[] } {
  let cursorY = startY;
  const placed: PlacedCard[] = [];
  const diverge = cards.filter((c) => c.layout === "diverge");
  const stacked = cards.filter((c) => c.layout !== "diverge");

  // Stacked (spine / hero) — one per row, centered.
  for (let i = 0; i < stacked.length; i++) {
    const card = stacked[i];
    const w = card.layout === "hero" ? HERO_W : SPINE_W;
    const h = cardHeight(card);
    const id = create(editor, card, engine, anchorMidX - w / 2, cursorY, w, h, stamp, i);
    if (id) placed.push({ id, layout: card.layout });
    cursorY += h + ROW_GAP;
  }

  // Diverge (MVPs) — a single centered row, up to three across.
  if (diverge.length) {
    const n = diverge.length;
    const rowWidth = n * MVP_W + (n - 1) * MVP_GAP;
    const rowH = Math.max(...diverge.map(cardHeight));
    const left = anchorMidX - rowWidth / 2;
    diverge.forEach((card, i) => {
      const x = left + i * (MVP_W + MVP_GAP);
      const id = create(editor, card, engine, x, cursorY, MVP_W, rowH, stamp, i);
      if (id) placed.push({ id, layout: card.layout });
    });
    cursorY += rowH + ROW_GAP;
  }

  return { cursorY, placed };
}

function create(
  editor: Editor,
  card: SpecForgeCard,
  engine: SpecForgeEngineId,
  x: number,
  y: number,
  w: number,
  h: number,
  stamp: number,
  i: number,
): TLShapeId | null {
  try {
    const id = createShapeId();
    editor.createShape<SpecForgeCardShape>({
      id,
      type: "specforge-card",
      x,
      y,
      props: {
        w,
        h,
        stage: card.stage,
        eyebrow: card.eyebrow ?? "",
        title: card.title || "Decision",
        subtitle: card.subtitle ?? "",
        body: card.body ?? "",
        entityId: `specforge-${engine}-${stamp}-${i}`,
      },
      meta: { specforge: true, engine, stage: card.stage },
    });
    return id;
  } catch {
    /* best-effort — a single bad card never breaks the chain */
    return null;
  }
}

// ── Connectors — the dependency graph threading the placed cards ──────
interface PlacedCard {
  id: TLShapeId;
  layout: SpecForgeCard["layout"];
}

/** Walk the placed cards in causal order and draw black node-connectors: a
 *  spine link between consecutive stacked cards, a FORK from the card above
 *  the MVP row to each MVP, and a CONVERGE from each MVP to the recommendation
 *  that follows. Same connector grammar used across the canvas graphs. */
function connectSpecCards(editor: Editor, placed: PlacedCard[]): void {
  let prevStacked: TLShapeId | null = null;
  let pendingDiverge: TLShapeId[] = [];
  const arrowIds: TLShapeId[] = [];
  const link = (from: TLShapeId, to: TLShapeId) => {
    const a = connectCards(editor, from, to);
    if (a) arrowIds.push(a);
  };

  for (const c of placed) {
    if (c.layout === "diverge") {
      if (prevStacked) link(prevStacked, c.id); // fork out
      pendingDiverge.push(c.id);
    } else {
      if (pendingDiverge.length > 0) {
        for (const d of pendingDiverge) link(d, c.id); // converge in
        pendingDiverge = [];
      } else if (prevStacked) {
        link(prevStacked, c.id); // spine sequence
      }
      prevStacked = c.id;
    }
  }

  // Keep connectors beneath the cards so they never cover content.
  if (arrowIds.length > 0) {
    try {
      editor.sendToBack(arrowIds);
    } catch {
      /* z-order is cosmetic — never break on it */
    }
  }
}

/** One black, arrowhead-less connector bound bottom-of-`from` → top-of-`to`. */
function connectCards(
  editor: Editor,
  fromId: TLShapeId,
  toId: TLShapeId,
): TLShapeId | null {
  try {
    const arrowId = createShapeId();
    const arrow: TLShapePartial<TLArrowShape> = {
      id: arrowId,
      type: "arrow",
      props: {
        color: "black",
        size: "s",
        dash: "solid",
        arrowheadStart: "none",
        arrowheadEnd: "none",
      },
      meta: { specforge: true, connector: true },
    };
    editor.createShapes([arrow]);
    editor.createBindings([
      {
        fromId: arrowId,
        toId: fromId,
        type: "arrow",
        props: {
          terminal: "start",
          normalizedAnchor: { x: 0.5, y: 1 },
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
          normalizedAnchor: { x: 0.5, y: 0 },
          isExact: false,
          isPrecise: false,
        },
        meta: {},
      },
    ]);
    return arrowId;
  } catch {
    return null;
  }
}
