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
  type TLShapePartial,
} from "tldraw";
import type { SpecForgeCardShape } from "../shapes/specforge-card-shape";
import {
  SPECFORGE_CHAIN,
  ENGINE_LABEL,
  PHASE_OF_ENGINE,
  PHASE_LABEL,
  PHASE_ORDER,
  type SpecForgeCard,
  type SpecForgeEngineId,
  type SpecForgePhase,
  type PowerUpResult,
  type RecommendationResult,
} from "@/lib/objective-canvas/specforge/types";
import {
  resultToCards,
  summarizeForContext,
} from "@/lib/objective-canvas/specforge/cards";
import {
  depthSelectionToCard,
  selectSpecForgeDepth,
  summarizeDepthForContext,
} from "@/lib/objective-canvas/specforge/depth-selection";
import {
  qualityReportToCard,
  type QualityCriticResult,
} from "@/lib/objective-canvas/specforge/quality-critic";
import {
  type Constraint,
  constraintAccumulationToCard,
  dedupeConstraints,
  extractConstraintsFromEngineResult,
  summarizeConstraintsForContext,
} from "@/lib/objective-canvas/specforge/constraints";
import { outputSummaryFor } from "@/lib/objective-canvas/specforge/operation-cards";
import { reserveSpace } from "./placement";

/** Per-engine status snapshot the Operation Lane consumes. The runner
 *  rebuilds this object after every engine returns, so the lane re-renders
 *  with each tick (status flips → output count appears → shape id wired
 *  for click-to-focus). Spec §7.1 / §14 / §21. */
export interface EngineLaneStatus {
  status: "not_started" | "running" | "passed" | "failed" | "repaired";
  /** tldraw shape id of the produced reasoning card. Click-to-focus reads
   *  this; absent when the engine hasn't placed any card (soft-fail) or
   *  hasn't run yet. */
  shapeId?: string;
  /** Critic issue count (0 = clean). */
  issueCount?: number;
  /** 0..100 — engine's self-reported confidence when reported. */
  confidence?: number;
  /** 1-line output summary from outputSummary() — pre-computed so the
   *  lane stays render-cheap. */
  outputSummary?: string;
}

export interface SpecForgeProgress {
  phase: "running" | "done" | "error";
  /** Engines completed (0…total). */
  done: number;
  total: number;
  /** Human label for the engine currently running (or last finished). */
  label: string;
  /** Which of the 5 acts (frame / interweave / decide / build / validate) the
   *  current engine sits in. `null` while idle, during the final meta cards
   *  (constraints/quality), or after the chain ends. */
  act: SpecForgePhase | null;
  /** 1-indexed act position ("Act 3 of 5"). 0 when no act is active. */
  actIndex: number;
  actTotal: number;
  /** When the chain has finished, the shape id of the recommendation card
   *  (the "first build" hero). Lets the chip offer a "Jump to first build"
   *  action so the user doesn't have to scroll through 20 cards to find it. */
  focusShapeId?: string;
  /** Per-engine status snapshot. Always present (engines start "not_started";
   *  flip to "running" then "passed"/"failed"/"repaired"). Powers the
   *  Operation Lane — clickable per-engine map of the chain. */
  engineStatuses: Partial<Record<SpecForgeEngineId, EngineLaneStatus>>;
}

interface RunOptions {
  onProgress?: (p: SpecForgeProgress) => void;
  /** Space id this forge belongs to. When present, the runner opens a
   *  `pipeline=specforge` pipeline_run via /api/canvas/specforge/run/start
   *  and threads its runId through every per-engine call so the chain's
   *  artifacts persist (specforge_engine_runs + reasoning_artifacts +
   *  constraints). When omitted, the chain runs in-memory only — same
   *  behavior as before persistence shipped. */
  spaceId?: string;
}

const ANCHOR_GAP = 64;
const ROW_GAP = 28;
const SPINE_W = 396;
const MVP_W = 292;
const MVP_GAP = 24;
const HERO_W = 544;
const ENGINE_TIMEOUT_MS = 45_000;
type SpecForgeArtifactId =
  | SpecForgeEngineId
  | "depth_selection"
  | "constraint_accumulation"
  | "quality_critic";

/** Estimate a card's height from its content so the spine packs tightly but
 *  readably — sized so titles + bullets don't truncate at a glance. */
function cardHeight(card: SpecForgeCard): number {
  if (card.layout === "hero") return 212;
  if (card.layout === "diverge") return 224;
  const lines = card.body
    ? card.body.split("\n").filter((l) => l.trim()).length
    : 0;
  const h =
    108 +
    (card.subtitle ? 34 : 0) +
    Math.min(lines, 5) * 19 +
    (card.modelJson ? 34 : 0);
  return Math.max(124, Math.min(248, h));
}

async function fetchEngine(
  engine: SpecForgeEngineId,
  idea: string,
  context: string,
  persist: { runId: string; spaceId: string; sequence: number } | null,
): Promise<{
  result: unknown;
  critic?: QualityCriticResult;
  engineRunId?: string;
} | null> {
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
        // Persistence handle — route writes engine_run + artifact rows
        // when all three are present. Soft-fails server-side if not.
        ...(persist
          ? {
              runId: persist.runId,
              spaceId: persist.spaceId,
              sequence: persist.sequence,
            }
          : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      result?: unknown;
      critic?: QualityCriticResult;
      engineRunId?: string;
    };
    if (json.result === undefined || json.result === null) return null;
    return {
      result: json.result,
      critic: json.critic,
      engineRunId: json.engineRunId,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** The chain's accumulated synthesis, returned so the caller can feed it to
 *  the tech-spec stage (the SpecForge → TechSpec hand-off). */
export interface SpecForgeResult {
  idea: string;
  /** Joined per-engine summaries (problem tree, user, thesis, MVP, …). */
  context: string;
  createdAny: boolean;
}

/** Run the chain for `idea` and stream decision cards below `shapeId`. */
export async function runSpecForge(
  editor: Editor,
  target: { text: string; shapeId?: string },
  opts: RunOptions = {},
): Promise<SpecForgeResult> {
  const idea = (target.text ?? "").trim();
  if (!idea) return { idea: "", context: "", createdAny: false };

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

  // Reserve a clear column for the WHOLE spec up front (hybrid push-then-yield):
  // the spine streams in engine-by-engine, so without an up-front reservation a
  // later stage could land on a neighbour that the first stage didn't overlap.
  // The exact height isn't known until cards return, so estimate generously from
  // the chain length + the post-chain cards (depth, constraints, quality, MVP
  // row, hero); over-reserving just leaves extra air below. The source idea is
  // ignored so it's never pushed by its own spec.
  const estH = (SPECFORGE_CHAIN.length + 4) * (200 + ROW_GAP);
  const ignore = new Set<TLShapeId>();
  if (target.shapeId) ignore.add(target.shapeId as TLShapeId);
  const spot = reserveSpace(
    editor,
    { w: HERO_W, h: estH },
    { anchorMidX, preferredTop: cursorY, gap: ANCHOR_GAP, ignore },
  );
  anchorMidX = spot.x + HERO_W / 2;
  cursorY = spot.y;

  const total = SPECFORGE_CHAIN.length;
  const contextParts: string[] = [];
  const stamp = Date.now();
  let createdAny = false;

  // ── KG state-model Phase A: open a SpecForge pipeline_run ─────────
  // Soft-fail: when spaceId is missing, /run/start refuses, or any DB
  // hiccup happens, runId stays null and the chain runs in-memory exactly
  // like before. Per-engine persistence + /run/complete both no-op on
  // null runId, so this is a pure additive surface.
  let runId: string | null = null;
  if (opts.spaceId) {
    try {
      const res = await fetch("/api/canvas/specforge/run/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId: opts.spaceId, idea }),
      });
      if (res.ok) {
        const json = (await res.json()) as { runId?: string | null };
        runId = json.runId ?? null;
      }
    } catch (err) {
      // Persistence-off is a recoverable degradation — log + continue.
      console.warn("[specforge-runner] run/start failed:", err);
    }
  }
  // Map of engine id → engine_run UUID, threaded into the final
  // /run/complete call so each persisted constraint can resolve its
  // origin engine to a real engine_run FK (not just a textual id).
  const engineRunIdByEngine: Partial<Record<SpecForgeEngineId, string>> = {};
  // Every placed card, in causal order — threaded into a connected
  // dependency graph (sequence → fork → converge) once the chain finishes.
  const allPlaced: PlacedCard[] = [];
  const critics: QualityCriticResult[] = [];
  // Constraint Accumulation: extract from each engine result as it returns,
  // thread the rolled-up strip into downstream prompts (Evaluation +
  // Recommendation consume it). One final card before the Quality Gate.
  let constraints: Constraint[] = [];
  let recommendationResult: RecommendationResult | null = null;

  // Track the recommendation card so we can offer a "jump to first build"
  // affordance on completion (the most-asked navigation in user testing).
  let recommendationShapeId: string | undefined;

  // Per-engine status snapshot for the Operation Lane. Seed every engine
  // as `not_started`; the run-loop flips entries to `running` then
  // `passed`/`failed`/`repaired`. Re-emitted on every onProgress tick so
  // the lane re-renders incrementally.
  const engineStatuses: Partial<Record<SpecForgeEngineId, EngineLaneStatus>> = {};
  for (const e of SPECFORGE_CHAIN) {
    engineStatuses[e] = { status: "not_started" };
  }
  // Cloned per emission — React state updates are reference-based, so a
  // mutation on the running map wouldn't trigger a re-render in the lane.
  const snapshotStatuses = () =>
    Object.fromEntries(
      Object.entries(engineStatuses).map(([k, v]) => [k, v ? { ...v } : v]),
    ) as typeof engineStatuses;

  const firstEngine = SPECFORGE_CHAIN[0];
  const firstAct = PHASE_OF_ENGINE[firstEngine];
  opts.onProgress?.({
    phase: "running",
    done: 0,
    total,
    label: ENGINE_LABEL[firstEngine],
    act: firstAct,
    actIndex: PHASE_ORDER.indexOf(firstAct) + 1,
    actTotal: PHASE_ORDER.length,
    engineStatuses: snapshotStatuses(),
  });

  for (let idx = 0; idx < SPECFORGE_CHAIN.length; idx++) {
    const engine = SPECFORGE_CHAIN[idx];
    const act = PHASE_OF_ENGINE[engine];
    // Flip THIS engine to running before the LLM call returns, so the lane
    // shows "in flight" rather than skipping straight from not_started.
    engineStatuses[engine] = { status: "running" };
    opts.onProgress?.({
      phase: "running",
      done: idx,
      total,
      label: ENGINE_LABEL[engine],
      act,
      actIndex: PHASE_ORDER.indexOf(act) + 1,
      actTotal: PHASE_ORDER.length,
      engineStatuses: snapshotStatuses(),
    });

    // Prepend the accumulated constraint strip so this engine sees the
    // criticals + highs in its context. Evaluation + Recommendation prompts
    // are tuned to consume this block.
    const constraintStrip = summarizeConstraintsForContext(constraints);
    const threaded = constraintStrip
      ? [`[constraints]\n${constraintStrip}`, ...contextParts].join("\n\n")
      : contextParts.join("\n\n");
    const persist =
      runId && opts.spaceId
        ? { runId, spaceId: opts.spaceId, sequence: idx }
        : null;
    const response = await fetchEngine(engine, idea, threaded, persist);
    if (response) {
      if (response.critic) critics.push(response.critic);
      // Record the engine_run UUID so the constraint accumulator can
      // resolve each constraint's textual origin to a real FK at
      // /run/complete time.
      if (response.engineRunId) {
        engineRunIdByEngine[engine] = response.engineRunId;
      }
      const summary = summarizeForContext(engine, response.result);
      if (summary) contextParts.push(`[${engine}]\n${summary}`);

      // Shape id of this engine's first reasoning card — captured here
      // so the Operation Lane can click-to-focus it.
      let engineFirstShapeId: string | undefined;
      // Derive the gate status BEFORE placement so it can be written into
      // shape.meta in one pass (no later .updateShape race).
      const placementGateStatus: "passed" | "repaired" | "failed" | undefined =
        response.critic?.repaired
          ? "repaired"
          : response.critic && !response.critic.passed
            ? "failed"
            : response.critic
              ? "passed"
              : undefined;
      const cards = resultToCards(engine, response.result);
      if (cards.length) {
        const batch = placeBatch(
          editor,
          cards,
          engine,
          anchorMidX,
          cursorY,
          stamp,
          response.engineRunId ?? "",
          placementGateStatus,
        );
        cursorY = batch.cursorY;
        allPlaced.push(...batch.placed);
        createdAny = true;
        engineFirstShapeId = batch.placed[0]?.id;
        // Remember the recommendation's hero card as the focus target for the
        // "jump to first build" affordance.
        if (engine === "recommendation" && batch.placed.length > 0) {
          const hero = batch.placed.find((p) => p.layout === "hero") ?? batch.placed[0];
          recommendationShapeId = hero.id;
        }
      }

      // Capture the recommendation for the constraint alignment check.
      if (engine === "recommendation") {
        recommendationResult = response.result as RecommendationResult;
      }

      // Constraint Accumulation — deterministic extraction from this
      // engine's output (no LLM). Dedupes against the running set.
      const newConstraints = extractConstraintsFromEngineResult(
        engine,
        response.result,
      );
      if (newConstraints.length) {
        constraints = dedupeConstraints([...constraints, ...newConstraints]);
      }

      if (engine === "power_up" && response.result && typeof response.result === "object") {
        const depth = selectSpecForgeDepth({
          idea,
          powerUp: response.result as PowerUpResult,
        });
        contextParts.push(`[depth_selection]\n${summarizeDepthForContext(depth)}`);
        const batch = placeBatch(
          editor,
          [depthSelectionToCard(depth)],
          "depth_selection",
          anchorMidX,
          cursorY,
          stamp,
          // depth-selection is deterministic + has no engine_run row.
          "",
        );
        cursorY = batch.cursorY;
        allPlaced.push(...batch.placed);
        createdAny = true;
      }

      // Update the Operation Lane snapshot for THIS engine. Reads from the
      // already-computed critic + placement; no extra work. Order matters:
      // repaired wins over passed (the spec wants repair visible), failed
      // is exclusive.
      const critic = response.critic;
      const status: EngineLaneStatus["status"] = critic?.repaired
        ? "repaired"
        : critic && !critic.passed
          ? "failed"
          : "passed";
      // Pull this engine's own confidence (engines that emit one).
      let confidence: number | undefined;
      if (response.result && typeof response.result === "object") {
        const conf = (response.result as { confidence?: unknown }).confidence;
        if (typeof conf === "number" && Number.isFinite(conf)) {
          confidence = Math.max(0, Math.min(100, Math.round(conf)));
        }
      }
      engineStatuses[engine] = {
        status,
        shapeId: engineFirstShapeId,
        issueCount: critic?.issues.length ?? 0,
        confidence,
        outputSummary: outputSummaryFor(engine, response.result),
      };
    } else {
      // Engine returned null (timeout / error / soft-fail). Mark failed so
      // the lane shows it, downstream engines still run with whatever
      // context exists (legacy behavior preserved).
      engineStatuses[engine] = { status: "failed" };
    }

    // Always emit after the engine resolves — lane re-renders with new
    // status, output summary, or failure marker.
    opts.onProgress?.({
      phase: "running",
      done: idx + 1,
      total,
      label: ENGINE_LABEL[engine],
      act,
      actIndex: PHASE_ORDER.indexOf(act) + 1,
      actTotal: PHASE_ORDER.length,
      engineStatuses: snapshotStatuses(),
    });
  }

  const constraintCard = constraintAccumulationToCard(
    constraints,
    recommendationResult,
  );
  if (constraintCard) {
    const batch = placeBatch(
      editor,
      [constraintCard],
      "constraint_accumulation",
      anchorMidX,
      cursorY,
      stamp,
      // Constraint accumulator is deterministic — no engine_run row.
      // The persisted constraint rows themselves carry origin_engine_run_id.
      "",
    );
    cursorY = batch.cursorY;
    allPlaced.push(...batch.placed);
    createdAny = true;
  }

  const qualityCard = qualityReportToCard(critics);
  if (qualityCard) {
    const batch = placeBatch(
      editor,
      [qualityCard],
      "quality_critic",
      anchorMidX,
      cursorY,
      stamp,
      // Quality critic card aggregates per-engine critic verdicts —
      // each engine_run row carries its own critic_pass + critic_score.
      "",
    );
    cursorY = batch.cursorY;
    allPlaced.push(...batch.placed);
    createdAny = true;
  }

  // Thread the spec into a connected dependency graph: branch from the
  // source idea into the clean summary, run a black node-line down the spine,
  // fork out to the MVP variations, then converge on the recommended first
  // build. Connectors sit beneath the cards.
  if (allPlaced.length > 0) {
    connectSpecCards(
      editor,
      allPlaced,
      target.shapeId ? (target.shapeId as TLShapeId) : null,
    );
  }

  // ── KG state-model: close the pipeline_run + persist constraints ──
  // Fire-and-forget — the chain is finished, the cards are on the board,
  // and persistence completion is a background fact for the user. Doing
  // this AFTER connectSpecCards keeps the visible progress chip alive
  // until the user can see the connected graph.
  if (runId && opts.spaceId) {
    void (async () => {
      try {
        await fetch("/api/canvas/specforge/run/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            runId,
            spaceId: opts.spaceId,
            status: createdAny ? "completed" : "failed",
            constraints,
            engineRunIdByEngine,
          }),
        });
      } catch (err) {
        console.warn("[specforge-runner] run/complete failed:", err);
      }
    })();
  }

  opts.onProgress?.({
    phase: "done",
    done: total,
    total,
    label: "Spec complete",
    // No active act once the chain finishes — the chip flips to "done" copy.
    act: null,
    actIndex: 0,
    actTotal: PHASE_ORDER.length,
    focusShapeId: recommendationShapeId,
    engineStatuses: snapshotStatuses(),
  });

  // Reveal the whole unfurl without yanking the zoom too hard.
  if (createdAny && bounds) {
    editor.centerOnPoint(
      { x: anchorMidX, y: (bounds.maxY + cursorY) / 2 },
      { animation: { duration: 360 } },
    );
  }

  return { idea, context: contextParts.join("\n\n"), createdAny };
}

/** Place one engine's cards and return the new Y cursor. Diverge batches lay
 *  out three-across; spine + hero stack centered. `engineRunId` (when present)
 *  is written onto every placed card as the durable pointer back to the
 *  specforge_engine_runs row that produced them. `gateStatus` (when present)
 *  is written into shape.meta so the renderer can show a subtle pass/repair/
 *  fail badge — surfaces Phase A's critic data without a new tldraw prop. */
function placeBatch(
  editor: Editor,
  cards: SpecForgeCard[],
  engine: SpecForgeArtifactId,
  anchorMidX: number,
  startY: number,
  stamp: number,
  engineRunId: string,
  gateStatus?: "passed" | "repaired" | "failed",
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
    const id = create(editor, card, engine, anchorMidX - w / 2, cursorY, w, h, stamp, i, engineRunId, gateStatus);
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
      const id = create(editor, card, engine, x, cursorY, MVP_W, rowH, stamp, i, engineRunId, gateStatus);
      if (id) placed.push({ id, layout: card.layout });
    });
    cursorY += rowH + ROW_GAP;
  }

  return { cursorY, placed };
}

function create(
  editor: Editor,
  card: SpecForgeCard,
  engine: SpecForgeArtifactId,
  x: number,
  y: number,
  w: number,
  h: number,
  stamp: number,
  i: number,
  engineRunId: string,
  gateStatus?: "passed" | "repaired" | "failed",
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
        modelJson: card.modelJson ?? "",
        entityId: `specforge-${engine}-${stamp}-${i}`,
        engineRunId,
      },
      meta: {
        specforge: true,
        engine,
        stage: card.stage,
        // Surfaces Phase A's critic data on the card itself (no new prop).
        // Omitted when unknown so the renderer falls back to clean styling.
        ...(gateStatus ? { gateStatus } : {}),
      },
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

/** Walk the placed cards in causal order, compute the edges (spine,
 *  fork-to-MVPs, converge-from-MVPs), and PERSIST each child's parent IDs
 *  in shape meta. The bezier overlay (specforge-connectors.tsx) reads
 *  meta.specforgeParents and renders smooth cubic-bezier curves through
 *  the vertical gap between cards — replacing the old tldraw straight-
 *  line arrows that cut diagonally through neighbor cards. Same connector
 *  grammar as the sharpening graph. */
function connectSpecCards(
  editor: Editor,
  placed: PlacedCard[],
  sourceId: TLShapeId | null,
): void {
  let prevStacked: TLShapeId | null = null;
  let pendingDiverge: TLShapeId[] = [];
  const parentsByChild = new Map<TLShapeId, TLShapeId[]>();
  const link = (from: TLShapeId, to: TLShapeId) => {
    const list = parentsByChild.get(to) ?? [];
    list.push(from);
    parentsByChild.set(to, list);
  };

  // Branch the whole spec from the originating idea (the post-it the user
  // typed into) → the clean-summary card, so the tree grows from it.
  if (sourceId && placed[0]) link(sourceId, placed[0].id);

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

  // Persist parent IDs in meta so the SVG overlay can read them live and
  // re-render whenever a card moves. Soft-fail on a per-card basis.
  try {
    const updates: TLShapePartial<SpecForgeCardShape>[] = [];
    for (const [to, fromIds] of parentsByChild) {
      const shape = editor.getShape(to);
      if (!shape || shape.type !== "specforge-card") continue;
      updates.push({
        id: to,
        type: "specforge-card",
        meta: {
          ...shape.meta,
          specforgeParents: fromIds.map((id) => String(id)),
        },
      });
    }
    if (updates.length) editor.updateShapes(updates);
  } catch {
    /* best-effort — connectors are cosmetic, never break the chain */
  }
}
