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

import { createShapeId, type Editor, type TLShapeId } from "tldraw";
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
        cursorY = placeBatch(editor, cards, engine, anchorMidX, cursorY, stamp);
        createdAny = true;
      }
    }
  }

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
): number {
  let cursorY = startY;
  const diverge = cards.filter((c) => c.layout === "diverge");
  const stacked = cards.filter((c) => c.layout !== "diverge");

  // Stacked (spine / hero) — one per row, centered.
  for (let i = 0; i < stacked.length; i++) {
    const card = stacked[i];
    const w = card.layout === "hero" ? HERO_W : SPINE_W;
    const h = cardHeight(card);
    create(editor, card, engine, anchorMidX - w / 2, cursorY, w, h, stamp, i);
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
      create(editor, card, engine, x, cursorY, MVP_W, rowH, stamp, i);
    });
    cursorY += rowH + ROW_GAP;
  }

  return cursorY;
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
): void {
  try {
    editor.createShape<SpecForgeCardShape>({
      id: createShapeId(),
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
  } catch {
    /* best-effort — a single bad card never breaks the chain */
  }
}
