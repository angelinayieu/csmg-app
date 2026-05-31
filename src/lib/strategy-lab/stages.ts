// ── Strategy Lab stage runners ───────────────────────────────────────
//
// The Strategy Lab pipeline used to run its whole chain
// (kg → refine → evidence → synthesize → twin) inside ONE serverless
// `after()` invocation in /api/strategy-lab/run. On Vercel that function
// is capped at maxDuration=300s, so a realistic run (KG ~180s + refine +
// evidence + synthesize) blew past the wall and the function was killed
// mid-synthesis — the live view then sat "stalled" forever because no
// terminal event was ever emitted.
//
// Fix (decoupled stage machine): each heavy stage now runs in its OWN
// invocation with a fresh 300s budget, chained hop-to-hop via the same
// short-abort internal-POST handoff the intake/bootstrap → decompose
// path already uses in production. This module holds the per-stage
// logic, moved VERBATIM out of the orchestrator's after() block so the
// emitted events (and therefore the status route + live view) are
// byte-for-byte identical — only WHICH function emits them changed.
//
// The hop driver is /api/strategy-lab/advance; the entry point that does
// setup + reservation + fires the first hop is /api/strategy-lab/run.
//
// Reservation discipline: the orchestrator is the SOLE owner of the
// credit-reservation lifecycle. We thread `reservationId` through every
// hop's body but settle it EXACTLY ONCE — committed by the terminal
// (twin) hop on success, cancelled by whichever hop fails fatally. A
// mid-chain function death settles nothing, leaving the reservation in
// 'reserved' (no charge) until the pipeline-watchdog marks the run
// failed — the user-favorable failure mode, identical to bootstrap.

import { emitStructuralEvent } from "@/lib/events/structural-event-bus";

/** The four chained hops. NOT the same as the EVENT stage names the
 *  status route maps to live-view cards — those stay "kg" | "landscape"
 *  | "lab" | "proposal" | "twin". This discriminator only routes hops. */
export type StrategyLabStage =
  | "kg"
  | "refine_evidence"
  | "synthesize"
  | "twin";

export const STRATEGY_LAB_STAGE_ORDER: StrategyLabStage[] = [
  "kg",
  "refine_evidence",
  "synthesize",
  "twin",
];

export function isStrategyLabStage(v: unknown): v is StrategyLabStage {
  return (
    v === "kg" ||
    v === "refine_evidence" ||
    v === "synthesize" ||
    v === "twin"
  );
}

/** Next hop in the chain, or null when `stage` is terminal (twin). */
export function nextStageOf(stage: StrategyLabStage): StrategyLabStage | null {
  const i = STRATEGY_LAB_STAGE_ORDER.indexOf(stage);
  if (i < 0 || i >= STRATEGY_LAB_STAGE_ORDER.length - 1) return null;
  return STRATEGY_LAB_STAGE_ORDER[i + 1];
}

export type ReasoningDepth = "quick" | "standard" | "deep";

/** Everything a stage needs. Threaded through the hop chain via the
 *  advance route's POST body (run-specific fields) + the request itself
 *  (origin, cookie, authed db/user). */
export interface StageContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  runId: string;
  spaceId: string;
  userId: string;
  prompt: string;
  reasoningDepth: ReasoningDepth;
  ingestedFileIds: string[];
  origin: string;
  cookieHeader: string;
}

export interface StageResult {
  /** The stage produced its artifact / completed acceptably. For the
   *  terminal (twin) hop this is "a strategy was found" and drives
   *  commit-vs-refund. */
  ok: boolean;
  /** When true the whole run must terminate as failed (refund + mark
   *  failed, do NOT advance). When false but ok=false the stage merely
   *  degraded and the chain continues (best-effort stages). */
  fatal: boolean;
  /** Human-readable reason, surfaced on completePipelineRun. */
  failReason?: string;
}

// ── Shared helpers (moved verbatim from the orchestrator) ─────────────

function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() =>
    clearTimeout(t),
  );
}

interface SubStageOutcome {
  ok: boolean;
  durationMs: number;
  error?: string;
}

/** Run one sub-stage HTTP call with timeout + enter/exit boundary
 *  events. EVENT stage name (not the hop name) — "landscape" for refine,
 *  "proposal" for synthesize, "twin" for strategy-refresh. */
async function runSubStage<T>(
  ctx: StageContext,
  stageName: "kg" | "landscape" | "proposal" | "twin",
  label: string,
  url: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ outcome: SubStageOutcome; response: Response | null; json: T | null }> {
  const { db, runId, cookieHeader } = ctx;
  const stageHeaders = {
    "Content-Type": "application/json",
    Cookie: cookieHeader,
  } as const;

  const startedAt = Date.now();
  await emitStructuralEvent(db, runId, {
    type: "stage_boundary",
    stage: stageName,
    phase: "enter",
    message: label,
  });

  let response: Response | null = null;
  let parsed: T | null = null;
  let error: string | undefined;
  try {
    response = await fetchWithTimeout(
      url,
      { method: "POST", headers: stageHeaders, body: JSON.stringify(payload) },
      timeoutMs,
    );
    if (response.ok) {
      try {
        parsed = (await response.json()) as T;
      } catch {
        // Some routes return empty body on success — fine.
        parsed = null;
      }
    } else {
      error = `${response.status} ${response.statusText}`;
      try {
        const body = await response.text();
        if (body) error = `${error}: ${body.slice(0, 300)}`;
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    const name = (err as { name?: string })?.name ?? "";
    error =
      name === "AbortError"
        ? `timed out after ${Math.round(timeoutMs / 1000)}s`
        : err instanceof Error
          ? err.message
          : String(err);
  }

  const durationMs = Date.now() - startedAt;
  const ok = !error;
  await emitStructuralEvent(db, runId, {
    type: "stage_boundary",
    stage: stageName,
    phase: "exit",
    message: ok
      ? `${label} complete (${Math.round(durationMs / 1000)}s)`
      : `${label} FAILED — ${error}`,
  });
  return { outcome: { ok, durationMs, error }, response, json: parsed };
}

/** Read the space's KG counts. */
async function readKgCounts(
  ctx: StageContext,
): Promise<{ entities: number; edges: number; cycles: number }> {
  const { data } = (await ctx.db
    .from("spaces")
    .select("entity_count, edge_count, cycle_count")
    .eq("id", ctx.spaceId)
    .maybeSingle()) as {
    data: {
      entity_count: number | null;
      edge_count: number | null;
      cycle_count: number | null;
    } | null;
  };
  return {
    entities: data?.entity_count ?? 0,
    edges: data?.edge_count ?? 0,
    cycles: data?.cycle_count ?? 0,
  };
}

/** Distinguishes a severed/abandoned sub-stage (which may still be working
 *  — or have already finished — server-side) from a real HTTP error
 *  (quota 500, gate 409) that should fail the run. "Connection-death" →
 *  poll the DB for the artifact; real error → fail with the message so the
 *  UI can surface it.
 *
 *  We also classify Vercel's 508 (INFINITE_LOOP_DETECTED) here. The
 *  decoupled hop chain (run → advance ×4 → strategy-refresh, each firing
 *  its own internal sub-requests) can exceed Vercel's nested-subrequest
 *  DEPTH limit, returning 508 to the calling hop even though the strategy
 *  artifact is already persisted (synthesize wrote it the prior hop) or the
 *  callee finishes anyway. Treating 508 as a hard error wrongly failed the
 *  run; treating it as connection-death makes the stage poll for the
 *  artifact — which is exactly the graceful recovery the twin hop already
 *  relied on, now extended to synthesize too. */
function isConnectionDeath(err?: string): boolean {
  return (
    !!err &&
    /fetch failed|timed out|ECONNRESET|socket hang up|network|aborted|EPIPE|\b508\b|loop detected|INFINITE_LOOP/i.test(
      err,
    )
  );
}

/** Has synthesize produced a strategy yet? synthesize writes
 *  synthesis_data.strategic_recommendation via generateMultiStepStrategy. */
async function readStrategyPresent(ctx: StageContext): Promise<boolean> {
  const { data } = (await ctx.db
    .from("spaces")
    .select("synthesis_data")
    .eq("id", ctx.spaceId)
    .maybeSingle()) as {
    data: { synthesis_data: Record<string, unknown> | null } | null;
  };
  const wrap = data?.synthesis_data?.strategic_recommendation as
    | { recommendation?: unknown }
    | undefined;
  return !!((wrap as { recommendation?: unknown })?.recommendation ?? wrap);
}

async function pollForStrategy(
  ctx: StageContext,
  deadlineMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (await readStrategyPresent(ctx)) return true;
    await new Promise((r) => setTimeout(r, 6000));
  }
  return readStrategyPresent(ctx);
}

// ── Stage 1: KG construction (decompose + poll) ───────────────────────

async function runKgStage(ctx: StageContext): Promise<StageResult> {
  const { db, runId, spaceId, prompt, reasoningDepth, origin, cookieHeader } =
    ctx;
  const stageHeaders = {
    "Content-Type": "application/json",
    Cookie: cookieHeader,
  } as const;

  // Decompose can run 5+ min on a fresh, complex prompt (Pass 1 + a
  // quality-retry). Critically, the internal HTTP connection to the
  // decompose route gets severed by an infra/proxy timeout at ~300s EVEN
  // THOUGH decompose keeps running server-side and completes (it logs
  // "200 in 5.1min" and persists entities). So we must NOT treat a
  // dropped fetch as failure. Instead: fire decompose, then POLL
  // spaces.entity_count until the KG materializes. The fetch outcome is
  // one of two success signals; the DB poll is the authoritative one.
  const KG_DEADLINE_MS = 600_000; // 10 min logical ceiling
  const kgStart = Date.now();
  await emitStructuralEvent(db, runId, {
    type: "stage_boundary",
    stage: "kg",
    phase: "enter",
    message: "Building knowledge graph",
  });

  // ── Fold attached paper content into the decomposition input ────────
  // CRITICAL: /api/pipeline/decompose ONLY decomposes its `text` param —
  // it never reads ingested_files. So unless we splice the papers'
  // parsed text into `text`, the uploaded research papers are decorative
  // (asset cards) and have ZERO influence on the knowledge graph. Cap
  // per-paper + total length to stay within the decompose LLM budget.
  let decomposeText = prompt;
  try {
    const { data: paperRows } = (await db
      .from("ingested_files")
      .select("source_name, normalized_text, parse_status")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: true })
      .limit(8)) as {
      data: Array<{
        source_name: string | null;
        normalized_text: string | null;
        parse_status: string | null;
      }> | null;
    };
    const usable = (paperRows ?? []).filter(
      (p) => p.normalized_text && p.normalized_text.trim().length > 100,
    );
    const pending = (paperRows ?? []).filter(
      (p) =>
        p.parse_status === "pending" &&
        (!p.normalized_text || p.normalized_text.trim().length <= 100),
    );
    if (usable.length > 0) {
      const PER_PAPER = 6000; // ~1.5k tokens each
      const TOTAL_CAP = 36000; // ~9k tokens of paper context
      let budget = TOTAL_CAP;
      const blocks: string[] = [];
      usable.forEach((p, i) => {
        if (budget <= 0) return;
        const slice = (p.normalized_text ?? "").slice(
          0,
          Math.min(PER_PAPER, budget),
        );
        budget -= slice.length;
        blocks.push(
          `### Paper ${i + 1}: ${p.source_name ?? "Untitled"}\n${slice}`,
        );
      });
      decomposeText = `${prompt}\n\n=== ATTACHED RESEARCH PAPERS ===\nExtract entities, causal relationships, mechanisms, and quantitative evidence from these sources and integrate them with the objective above.\n\n${blocks.join("\n\n")}`;
      const summary =
        `Folded ${blocks.length} paper${blocks.length === 1 ? "" : "s"} into decomposition input` +
        (pending.length > 0
          ? ` (⚠ ${pending.length} still parsing — excluded)`
          : "");
      await emitStructuralEvent(db, runId, {
        type: "reasoning_chunk",
        stage: "kg",
        textSoFar: summary,
        tokenBudget: 0,
        charsSoFar: summary.length,
        phase: "complete",
      });
    } else if ((paperRows ?? []).length > 0) {
      const warn = `⚠ ${(paperRows ?? []).length} paper(s) attached but no parsed text available — KG built from objective only`;
      await emitStructuralEvent(db, runId, {
        type: "reasoning_chunk",
        stage: "kg",
        textSoFar: warn,
        tokenBudget: 0,
        charsSoFar: warn.length,
        phase: "complete",
      });
    }
  } catch (err) {
    console.warn(
      "[strategy-lab/stages] paper-text fold failed (non-fatal):",
      err,
    );
  }

  let decomposeFetchOk = false;
  let decomposeErr: string | undefined;
  try {
    const resp = await fetchWithTimeout(
      `${origin}/api/pipeline/decompose`,
      {
        method: "POST",
        headers: stageHeaders,
        body: JSON.stringify({
          text: decomposeText,
          existingSpaceId: spaceId,
          autoAdvance: false,
          reasoningDepth,
        }),
      },
      KG_DEADLINE_MS,
    );
    decomposeFetchOk = resp.ok;
    if (!resp.ok) {
      decomposeErr = `${resp.status} ${resp.statusText}`;
      try {
        const b = await resp.text();
        if (b) decomposeErr = `${decomposeErr}: ${b.slice(0, 200)}`;
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    // Connection severed mid-flight — EXPECTED for long decompose. Not
    // fatal; the DB poll below is authoritative.
    const name = (err as { name?: string })?.name ?? "";
    decomposeErr =
      name === "AbortError"
        ? `timed out after ${Math.round(KG_DEADLINE_MS / 1000)}s`
        : err instanceof Error
          ? err.message
          : String(err);
  }

  // Poll for the KG to land. Decompose updates spaces.entity_count when
  // it persists entities — a positive count means success regardless of
  // whether our fetch connection survived.
  let kg = await readKgCounts(ctx);
  while (kg.entities === 0 && Date.now() - kgStart < KG_DEADLINE_MS) {
    // Clean (non-error) response → decompose is definitively done; stop
    // waiting even at 0 entities (degenerate decomposition; let the
    // failure below report it rather than burning the ceiling).
    if (decomposeFetchOk) break;
    await new Promise((r) => setTimeout(r, 6000));
    kg = await readKgCounts(ctx);
  }

  const kgDur = Math.round((Date.now() - kgStart) / 1000);
  if (kg.entities > 0) {
    const kgSummary = `Knowledge graph: ${kg.entities} entities · ${kg.edges} edges · ${kg.cycles} cycles`;
    await emitStructuralEvent(db, runId, {
      type: "reasoning_chunk",
      stage: "kg",
      textSoFar: kgSummary,
      tokenBudget: 0,
      charsSoFar: kgSummary.length,
      phase: "complete",
    });
    await emitStructuralEvent(db, runId, {
      type: "stage_boundary",
      stage: "kg",
      phase: "exit",
      message: `Building knowledge graph complete (${kgDur}s)`,
    });
    return { ok: true, fatal: false };
  }

  const why = decomposeErr ?? "decompose produced no entities";
  await emitStructuralEvent(db, runId, {
    type: "stage_boundary",
    stage: "kg",
    phase: "exit",
    message: `Building knowledge graph FAILED — ${why}`,
  });
  return { ok: false, fatal: true, failReason: `decompose: ${why}` };
}

// ── Stage 2: Refine (critique) + Evidence (effect sizes) ──────────────
// Both best-effort — neither can fail the run. Grouped into one hop
// because both are short (refine ~17s, evidence ~7s observed) and the
// base graph from stage 1 is already usable for synthesis.

async function runRefineEvidenceStage(ctx: StageContext): Promise<StageResult> {
  const { db, runId, spaceId, prompt, reasoningDepth, ingestedFileIds, origin, cookieHeader } =
    ctx;
  const stageHeaders = {
    "Content-Type": "application/json",
    Cookie: cookieHeader,
  } as const;

  // ── Refine — critique + augment (standard & deep) ──
  // Quick tier is a fast single-pass graph (decompose+structure only),
  // matching TIERS.quick.agents. Standard & deep add a critique+augment
  // pass that finds orphans/gaps and densifies the graph before
  // synthesis — /api/pipeline/critique does BOTH (critiques AND persists
  // new edges/cycles). Best-effort: on failure the decomposed graph
  // still stands and we proceed.
  if (reasoningDepth === "standard" || reasoningDepth === "deep") {
    const refine = await runSubStage(
      ctx,
      "landscape", // → maps to the "refine" card in the live view
      "Refining graph — critique + augment",
      `${origin}/api/pipeline/critique`,
      { spaceId },
      180_000,
    );
    if (!refine.outcome.ok) {
      await emitStructuralEvent(db, runId, {
        type: "reasoning_chunk",
        stage: "landscape",
        textSoFar: `Refine degraded (${refine.outcome.error ?? "unknown"}) — proceeding with base graph`,
        tokenBudget: 0,
        charsSoFar: 0,
        phase: "complete",
      });
    }
  } else {
    await emitStructuralEvent(db, runId, {
      type: "stage_boundary",
      stage: "landscape",
      phase: "enter",
      message: "Refine — critique + augment",
    });
    await emitStructuralEvent(db, runId, {
      type: "stage_boundary",
      stage: "landscape",
      phase: "exit",
      message: "Skipped — Quick tier runs decompose only",
    });
  }

  // ── Evidence — extract effect sizes + ground edges ──
  // THE step that makes a research paper count. For each attached paper
  // we call /api/ingest/[id]/extract-effect-sizes, which parses the
  // paper's quantitative findings (effect size, CI, p-value, sample
  // size, study design) into evidence_registries, AUTO-ATTACHES them to
  // entities, then REML-pools them into edges.strength. So edge weights
  // reflect MEASURED effects, not LLM guesses, with verbatim source
  // quotes for traceability. Gated to standard/deep + requires papers.
  // Best-effort — the graph still works ungrounded.
  if (reasoningDepth === "standard" || reasoningDepth === "deep") {
    await emitStructuralEvent(db, runId, {
      type: "stage_boundary",
      stage: "lab",
      phase: "enter",
      message: "Grounding in paper evidence",
    });
    if (ingestedFileIds.length === 0) {
      await emitStructuralEvent(db, runId, {
        type: "stage_boundary",
        stage: "lab",
        phase: "exit",
        message: "Skipped — no papers attached",
      });
    } else {
      const evStart = Date.now();
      // 1. Extract effect sizes per paper (parallel). Each call persists
      //    evidence rows + auto-attaches to entities.
      const evResults = await Promise.allSettled(
        ingestedFileIds.map((id) =>
          fetchWithTimeout(
            `${origin}/api/ingest/${id}/extract-effect-sizes`,
            {
              method: "POST",
              headers: stageHeaders,
              body: JSON.stringify({ goalContext: prompt.slice(0, 4000) }),
            },
            180_000,
          ),
        ),
      );
      const okPapers = evResults.filter(
        (r) => r.status === "fulfilled" && r.value.ok,
      ).length;
      // 2. Final race-free pool — recompute edge strengths from the full
      //    evidence set (the per-call auto-recompute can race when papers
      //    run in parallel).
      let edgesGrounded = 0;
      let evidenceRows = 0;
      try {
        const { recomputeEdgeStrengthsForSpace } = await import(
          "@/lib/evidence/recompute-edge-strengths"
        );
        const summary = await recomputeEdgeStrengthsForSpace(db, spaceId);
        edgesGrounded = summary.edges_updated;
        evidenceRows = summary.evidence_rows_loaded;
      } catch (err) {
        console.warn(
          "[strategy-lab/stages] recompute-edge-strengths failed (non-fatal):",
          err,
        );
      }
      const evMsg = `Grounded ${edgesGrounded} edge${edgesGrounded === 1 ? "" : "s"} from ${evidenceRows} evidence row${evidenceRows === 1 ? "" : "s"} · ${okPapers}/${ingestedFileIds.length} paper${ingestedFileIds.length === 1 ? "" : "s"}`;
      await emitStructuralEvent(db, runId, {
        type: "reasoning_chunk",
        stage: "lab",
        textSoFar: evMsg,
        tokenBudget: 0,
        charsSoFar: evMsg.length,
        phase: "complete",
      });
      await emitStructuralEvent(db, runId, {
        type: "stage_boundary",
        stage: "lab",
        phase: "exit",
        message: `Evidence grounding complete (${Math.round((Date.now() - evStart) / 1000)}s)`,
      });
    }
  } else {
    await emitStructuralEvent(db, runId, {
      type: "stage_boundary",
      stage: "lab",
      phase: "enter",
      message: "Evidence grounding",
    });
    await emitStructuralEvent(db, runId, {
      type: "stage_boundary",
      stage: "lab",
      phase: "exit",
      message: "Skipped — Quick tier",
    });
  }

  return { ok: true, fatal: false };
}

// ── Stage 3: Synthesize (produces the strategy) ───────────────────────

async function runSynthesizeStage(ctx: StageContext): Promise<StageResult> {
  const { db, runId, spaceId, reasoningDepth, origin } = ctx;

  // We bypass the measurement/layer quality gates (one-shot flow).
  // synthesize is long and its connection can be severed at ~300s while
  // it keeps running — so on a connection death we poll for the strategy
  // artifact rather than failing. A REAL error (e.g. OpenAI quota 500)
  // is surfaced so the live view shows the quota banner.
  const synthesize = await runSubStage(
    ctx,
    "proposal",
    "Synthesizing landscape",
    `${origin}/api/pipeline/synthesize`,
    {
      spaceIds: [spaceId],
      force: true,
      useLazyGuard: false,
      tier: reasoningDepth,
      bypassMeasurementGate: true,
      bypassLayerGate: true,
    },
    360_000,
  );

  let strategyPresent = false;
  if (synthesize.outcome.ok) {
    strategyPresent = await readStrategyPresent(ctx);
  } else if (isConnectionDeath(synthesize.outcome.error)) {
    // Connection died — synthesize may still be finishing. Poll.
    strategyPresent = await pollForStrategy(ctx, 300_000);
    if (strategyPresent) {
      await emitStructuralEvent(db, runId, {
        type: "stage_boundary",
        stage: "proposal",
        phase: "exit",
        message:
          "Synthesizing landscape complete (recovered after connection drop)",
      });
    }
  } else {
    // Real HTTP error (quota / 5xx / gate). Fail with the message so the
    // live view can render an actionable banner. runSubStage already
    // emitted the FAILED exit boundary.
    return {
      ok: false,
      fatal: true,
      failReason: `synthesize: ${synthesize.outcome.error ?? "unknown"}`,
    };
  }

  if (!strategyPresent) {
    await emitStructuralEvent(db, runId, {
      type: "stage_boundary",
      stage: "proposal",
      phase: "exit",
      message: "Synthesizing landscape FAILED — no strategy produced",
    });
    return {
      ok: false,
      fatal: true,
      failReason: "synthesize: completed but produced no strategy",
    };
  }

  return { ok: true, fatal: false };
}

// ── Stage 4: strategy-refresh (refine + wire twin proposal) ───────────
// Terminal hop. The strategy already exists in synthesis_data after
// synthesize, so strategy-refresh is BEST-EFFORT: if it fails (or its
// connection drops) we do NOT fail the run — the strategy from stage 3
// stands. We still surface what happened on the card. ok = strategyFound
// drives the advance route's commit-vs-refund decision.

async function runTwinStage(ctx: StageContext): Promise<StageResult> {
  const { db, runId, spaceId, userId, origin } = ctx;

  // NOTE: we do NOT pass reservationId to strategy-refresh. Letting it
  // commit/cancel the reservation creates an ambiguous ownership (if its
  // connection drops we don't know if it committed). The orchestrator is
  // the SOLE owner of the reservation lifecycle — settled by the advance
  // route based on the result below.
  const strategy = await runSubStage(
    ctx,
    "twin",
    "Refining strategy + twin proposal",
    `${origin}/api/pipeline/strategy-refresh`,
    { spaceId, deferApps: true },
    300_000,
  );
  if (!strategy.outcome.ok && !isConnectionDeath(strategy.outcome.error)) {
    // Real error, but strategy already exists — log it on the card
    // without failing the run.
    await emitStructuralEvent(db, runId, {
      type: "reasoning_chunk",
      stage: "twin",
      textSoFar: `strategy-refresh degraded (${strategy.outcome.error}); using strategy from synthesis`,
      tokenBudget: 0,
      charsSoFar: 80,
      phase: "complete",
    });
  }

  // ── Verify a strategy was produced ──
  // Success = a strategy exists, which lands in EITHER place:
  //   1. a twin_proposals row (when strategy-refresh wired one), OR
  //   2. spaces.synthesis_data.strategic_recommendation (the deferApps
  //      path — strategy-refresh generates + ranks strategies into
  //      synthesis_data but doesn't always insert a twin_proposals row).
  // Requiring a twin_proposals row alone wrongly reported "failed" on
  // runs that had in fact generated a high-quality strategy.
  let strategyFound = false;
  let detail = "";
  try {
    const { data: tpRow } = (await db
      .from("twin_proposals")
      .select("id")
      .eq("space_id", spaceId)
      .eq("user_id", userId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle()) as { data: { id: string } | null };
    if (tpRow) {
      strategyFound = true;
      detail = `Twin proposal materialized — id=${tpRow.id}`;
    } else {
      const { data: spaceRow } = (await db
        .from("spaces")
        .select("synthesis_data")
        .eq("id", spaceId)
        .maybeSingle()) as {
        data: { synthesis_data: Record<string, unknown> | null } | null;
      };
      const wrap = spaceRow?.synthesis_data?.strategic_recommendation as
        | { recommendation?: unknown }
        | undefined;
      const rec = (wrap as { recommendation?: unknown })?.recommendation ?? wrap;
      if (rec) {
        strategyFound = true;
        detail = `Strategy generated (synthesis_data.strategic_recommendation)`;
      } else {
        detail = `No strategy found in twin_proposals or synthesis_data`;
      }
    }
    await emitStructuralEvent(db, runId, {
      type: "reasoning_chunk",
      stage: "twin",
      textSoFar: detail,
      tokenBudget: 0,
      charsSoFar: detail.length,
      phase: "complete",
    });
  } catch (err) {
    console.warn("[strategy-lab/stages] strategy lookup failed:", err);
  }

  // Corrective twin-stage boundary: strategy-refresh is best-effort (the
  // strategy already exists from synthesize), so if its runSubStage
  // emitted a FAILED exit on a connection drop, override it here with the
  // true outcome. The status endpoint takes the LAST exit event per
  // stage, so this wins.
  await emitStructuralEvent(db, runId, {
    type: "stage_boundary",
    stage: "twin",
    phase: "exit",
    message: strategyFound
      ? "Strategy ready"
      : "Strategy + twin proposal FAILED — no strategy produced",
  });

  return {
    ok: strategyFound,
    fatal: false,
    failReason: strategyFound
      ? undefined
      : "Chain completed but no strategy was produced",
  };
}

/** Dispatch one hop to its stage runner. */
export async function runStrategyLabStage(
  stage: StrategyLabStage,
  ctx: StageContext,
): Promise<StageResult> {
  switch (stage) {
    case "kg":
      return runKgStage(ctx);
    case "refine_evidence":
      return runRefineEvidenceStage(ctx);
    case "synthesize":
      return runSynthesizeStage(ctx);
    case "twin":
      return runTwinStage(ctx);
  }
}

// ── Hop handoff ───────────────────────────────────────────────────────

/** Run-specific context threaded through the hop chain via the advance
 *  route's POST body. origin / cookie / authed db+user come from the
 *  receiving request itself. */
export interface AdvanceHopInput {
  runId: string;
  spaceId: string;
  /** "", "bypass", or a uuid. Settled (commit/cancel) exactly once at
   *  the terminal hop / on fatal failure. */
  reservationId: string;
  stage: StrategyLabStage;
  prompt: string;
  reasoningDepth: ReasoningDepth;
  ingestedFileIds: string[];
}

/** Fire a hop (the first, from /run; or the next, from /advance).
 *  Short-abort fire-and-forget: once the request lands on the next
 *  Lambda we hang up so the current one can die — the next hop runs its
 *  work in its own `after()`. Mirrors the production bootstrap →
 *  decompose handoff. Throws on a REAL network failure (not the expected
 *  abort) so the caller can refund + fail. */
export async function handoffToAdvance(
  origin: string,
  cookieHeader: string,
  body: AdvanceHopInput,
): Promise<void> {
  const ctrl = new AbortController();
  // 10s handoff window — enough for a Vercel cold-start (~8s worst case)
  // + TLS + request-body POST. Matches the bootstrap → decompose window.
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    await fetch(`${origin}/api/strategy-lab/advance`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch (err) {
    clearTimeout(t);
    // AbortError is EXPECTED — the request landed and we hung up so this
    // Lambda releases. The next hop owns the chain from here.
    const name = (err as { name?: string })?.name;
    if (name === "AbortError") return;
    throw err;
  }
}
