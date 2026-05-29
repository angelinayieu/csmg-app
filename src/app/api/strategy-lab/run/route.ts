// ── POST /api/strategy-lab/run ────────────────────────────────────────
//
// Strategy Lab orchestrator. A focused, sequential driver that runs:
//
//   decompose → synthesize → strategy-refresh
//
// against a fresh space, emitting per-stage progress events to a single
// pipeline_run so the live view can render a clean stage-by-stage
// timeline. Bypasses the optional gates (propose-plan, frame-extractor,
// classify-data-presence, analyze-situation, domain-inferrer) that the
// `/api/intake/bootstrap` chain currently strings together — those
// stages produce nice-to-haves but stall the main chain when any one of
// them hangs, and the user never reaches a strategy.
//
// Atomic shape (matches bootstrap):
//   1. Synchronously: create spaces row + pipeline_runs row, attach any
//      pre-uploaded ingested_files, emit intake:enter + asset_added
//      events, return { spaceId, runId, redirectTo } in <500ms.
//   2. via `after()`: fire decompose → synthesize → strategy-refresh in
//      sequence, each wrapped in fetchWithTimeout, each emitting its
//      own stage_boundary{enter|exit} pair to the SAME runId.
//   3. After strategy-refresh: poll for the twin_proposals row and emit
//      a final twin_proposal_ready event so the live view's terminal
//      card lights up.
//
// Soft-fail discipline: each stage's failure is recorded as a
// stage_boundary{phase:'exit', message:'FAILED: …'} so the live view
// shows which stage broke. Run is marked 'failed' on any stage failure;
// 'completed' only when twin_proposals row materializes.

import { NextResponse, after } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import {
  startPipelineRun,
  emitStructuralEvent,
  completePipelineRun,
} from "@/lib/events/structural-event-bus";
import {
  reserveCredits,
  cancelReservation,
  commitReservation,
  getBalance,
} from "@/lib/credits";
import { TIERS, type AnalysisTier } from "@/lib/tiers";
import { CREDIT_PACKS } from "@/lib/stripe";

export const runtime = "nodejs";
export const maxDuration = 300;

type ReasoningDepth = "quick" | "standard" | "deep";

interface StrategyLabRunBody {
  prompt?: string;
  /** Already-uploaded ingested_files IDs (uploaded via /api/ingest before submit). */
  ingestedFileIds?: string[];
  reasoningDepth?: ReasoningDepth;
}

interface StageOutcome {
  ok: boolean;
  durationMs: number;
  error?: string;
}

function deriveName(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (cleaned.length <= 60) return cleaned;
  return `${cleaned.slice(0, 57).trimEnd()}…`;
}

function derivePrefix(text: string): string {
  const firstWord = text.trim().split(/\s+/)[0] ?? "";
  const letters = firstWord.toUpperCase().replace(/[^A-Z]/g, "");
  return (letters.slice(0, 2) || "SL").padEnd(2, "L");
}

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

export async function POST(request: Request) {
  try {
    const { supabase, user, error: authError } = await safeAuth();
    if (authError) return authError;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    const { data: body, error: parseError } =
      await safeJsonParse<StrategyLabRunBody>(request);
    if (parseError) return parseError;

    const promptRaw = body?.prompt;
    if (typeof promptRaw !== "string" || promptRaw.trim().length < 4) {
      return NextResponse.json(
        { error: "prompt required (min 4 chars)" },
        { status: 400 },
      );
    }
    const prompt = promptRaw.trim();

    const reasoningDepth: ReasoningDepth =
      body?.reasoningDepth === "quick" ||
      body?.reasoningDepth === "standard" ||
      body?.reasoningDepth === "deep"
        ? body.reasoningDepth
        : "standard";

    const tier: AnalysisTier =
      reasoningDepth === "quick"
        ? "quick"
        : reasoningDepth === "deep"
          ? "deep"
          : "standard";

    const ingestedFileIds = Array.isArray(body?.ingestedFileIds)
      ? body.ingestedFileIds.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        )
      : [];

    // ── Reserve credits ─────────────────────────────────────────────
    const reservation = await reserveCredits(db, user.id, tier);
    if (!reservation.success) {
      const errMsg = (reservation.error ?? "").toLowerCase();
      const isInsufficient =
        errMsg.includes("insufficient credits") || errMsg.includes("need ");
      if (!isInsufficient) {
        return NextResponse.json(
          {
            isServiceDegradation: true,
            error:
              "Service temporarily unavailable. Please try again in a moment.",
            retryAfterSeconds: 30,
          },
          { status: 503, headers: { "Retry-After": "30" } },
        );
      }
      const balance = await getBalance(db, user.id);
      return NextResponse.json(
        {
          isCredit: true,
          error: reservation.error ?? "Insufficient credits",
          balance,
          required: TIERS[tier].credits,
          tier,
          packs: CREDIT_PACKS,
        },
        { status: 402 },
      );
    }
    const reservationId = reservation.reservationId;
    const refundReservation = async (): Promise<void> => {
      if (!reservationId) return;
      await cancelReservation(db, reservationId).catch(() => {});
    };

    // ── Create space ────────────────────────────────────────────────
    const placeholderName = deriveName(prompt);
    const { data: spaceRow, error: spaceError } = await db
      .from("spaces")
      .insert({
        user_id: user.id,
        name: placeholderName,
        description: null,
        space_prefix: derivePrefix(prompt),
        input_text: prompt,
        entity_count: 0,
        edge_count: 0,
        orphan_count: 0,
        cycle_count: 0,
        maturity: "actionable_now",
        depth_level: 0,
        reasoning_settings: { depth: reasoningDepth },
      })
      .select("id")
      .single();

    if (spaceError || !spaceRow) {
      console.error("[strategy-lab/run] space insert failed:", spaceError);
      await refundReservation();
      return NextResponse.json(
        { error: "Could not create space" },
        { status: 500 },
      );
    }
    const spaceId = (spaceRow as { id: string }).id;

    // ── Attach pre-uploaded papers to this space ────────────────────
    if (ingestedFileIds.length > 0) {
      const { error: linkErr } = await db
        .from("ingested_files")
        .update({ space_id: spaceId })
        .in("id", ingestedFileIds)
        .eq("user_id", user.id);
      if (linkErr) {
        console.warn(
          "[strategy-lab/run] paper attach failed (non-fatal):",
          linkErr,
        );
      }
    }

    // ── Start pipeline run ──────────────────────────────────────────
    // Reuse 'intake_bootstrap' as the pipeline label — no migration
    // needed, and the SSE consumer already understands it. The
    // discriminator for "this is a Strategy Lab run" is the redirect URL,
    // not the pipeline label.
    const runId = await startPipelineRun(db, {
      spaceId,
      userId: user.id,
      pipeline: "intake_bootstrap",
      initialPrompt: prompt.slice(0, 2000),
    });

    if (!runId) {
      await refundReservation();
      return NextResponse.json(
        { spaceId, runId: null, error: "Could not start run" },
        { status: 500 },
      );
    }

    // ── Opening events ──────────────────────────────────────────────
    await emitStructuralEvent(db, runId, {
      type: "stage_boundary",
      stage: "intake",
      phase: "enter",
      message: `Strategy Lab — ${placeholderName}`,
    });

    // asset_added per attached paper so the live view's first card has
    // something concrete to render
    try {
      const { data: assetRows } = await db
        .from("ingested_files")
        .select("id, source_name, asset_class, normalized_chars, created_at")
        .eq("space_id", spaceId)
        .order("created_at", { ascending: true });
      for (const row of (assetRows ?? []) as Array<{
        id: string;
        source_name: string;
        asset_class: string | null;
        normalized_chars: number | null;
        created_at: string;
      }>) {
        await emitStructuralEvent(db, runId, {
          type: "asset_added",
          assetId: row.id,
          spaceId,
          sourceName: row.source_name ?? "untitled",
          assetClass:
            (row.asset_class as
              | "research_pdf"
              | "internal_doc"
              | "dataset"
              | "image_diagram"
              | "prior_analysis"
              | "spec_sheet"
              | "web_article"
              | "pasted_text"
              | null) ?? "research_pdf",
          charCount: row.normalized_chars ?? 0,
          uploadedAt: row.created_at ?? new Date().toISOString(),
        });
      }
    } catch (err) {
      console.warn(
        "[strategy-lab/run] asset emission failed (non-fatal):",
        err,
      );
    }

    await emitStructuralEvent(db, runId, {
      type: "stage_boundary",
      stage: "intake",
      phase: "exit",
      message: `Setup complete — ${ingestedFileIds.length} paper${ingestedFileIds.length === 1 ? "" : "s"} attached`,
    });

    // Capture cookie + origin for the after() block
    const cookieHeader = request.headers.get("cookie") ?? "";
    const origin = new URL(request.url).origin;

    // Respond immediately
    const redirectTo = `/app/strategy-lab/${runId}`;

    after(async () => {
      // ── Liveness heartbeat ──────────────────────────────────────
      // The whole chain runs in this single after() invocation. If the
      // function is killed (Vercel maxDuration in prod) or the process
      // dies, the run is left "running" with no terminal event and the
      // live view would spin forever. We ping a lightweight `thinking`
      // event every 30s so the status endpoint's lastEventAt stays
      // fresh; the live view treats "no events for >2min while running"
      // as stalled and surfaces an escape hatch. phase:"thinking" so the
      // live view ignores these for stage state (liveness only).
      let hbCount = 0;
      const heartbeat = setInterval(() => {
        hbCount += 1;
        void emitStructuralEvent(db, runId, {
          type: "reasoning_chunk",
          stage: "kg",
          textSoFar: `orchestrator alive (${hbCount * 30}s)`,
          tokenBudget: 0,
          charsSoFar: 0,
          phase: "thinking",
        });
      }, 30_000);

      // ── Helper: run one stage with timeout + boundary events ────
      const stageHeaders = {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
      } as const;

      const runStage = async <T>(
        stageName: "kg" | "landscape" | "proposal" | "twin",
        label: string,
        url: string,
        payload: Record<string, unknown>,
        timeoutMs: number,
      ): Promise<{ outcome: StageOutcome; response: Response | null; json: T | null }> => {
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
            {
              method: "POST",
              headers: stageHeaders,
              body: JSON.stringify(payload),
            },
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
      };

      // Helper: read the space's KG counts.
      const readKgCounts = async (): Promise<{
        entities: number;
        edges: number;
        cycles: number;
      }> => {
        const { data } = (await db
          .from("spaces")
          .select("entity_count, edge_count, cycle_count")
          .eq("id", spaceId)
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
      };

      try {
        // ── Stage 1: decompose (KG construction) — connection-resilient ──
        //
        // Decompose can run 5+ min on a fresh, complex prompt (Pass 1 +
        // a quality-retry). Critically, the internal HTTP connection to
        // the decompose route gets severed by an infra/proxy timeout at
        // ~300s EVEN THOUGH decompose keeps running server-side and
        // completes successfully (it logs "200 in 5.1min" and persists
        // entities). So we must NOT treat a dropped fetch as failure —
        // that was reporting "Building knowledge graph FAILED — fetch
        // failed" on a decompose that actually succeeded.
        //
        // Instead: fire decompose, then POLL spaces.entity_count until
        // the KG materializes (or a generous ceiling elapses). The fetch
        // outcome is just one of two success signals; the DB poll is the
        // authoritative one.
        //
        // NOTE: we deliberately do NOT forward existingRunId to the
        // sub-stage routes — they emit their own stage_boundary events
        // for the same stage names, which would corrupt our 4-stage
        // timeline. We own this run exclusively.
        const KG_DEADLINE_MS = 600_000; // 10 min ceiling
        const kgStart = Date.now();
        await emitStructuralEvent(db, runId, {
          type: "stage_boundary",
          stage: "kg",
          phase: "enter",
          message: "Building knowledge graph",
        });

        // ── Fold attached paper content into the decomposition input ──
        // CRITICAL: /api/pipeline/decompose ONLY decomposes its `text`
        // param — it never reads ingested_files. So unless we splice the
        // papers' parsed text into `text`, the uploaded research papers
        // are decorative (asset cards) and have ZERO influence on the
        // knowledge graph, which would be built from the objective prompt
        // alone. We cap per-paper + total length to stay within the
        // decompose LLM's token budget.
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
            (p) =>
              p.normalized_text && p.normalized_text.trim().length > 100,
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
            // Papers were attached but none had usable text — surface it
            // so the user knows the KG was built from the prompt alone.
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
            "[strategy-lab/run] paper-text fold failed (non-fatal):",
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
          // Connection severed mid-flight — EXPECTED for long decompose.
          // Not fatal; the DB poll below is authoritative.
          const name = (err as { name?: string })?.name ?? "";
          decomposeErr =
            name === "AbortError"
              ? `timed out after ${Math.round(KG_DEADLINE_MS / 1000)}s`
              : err instanceof Error
                ? err.message
                : String(err);
        }

        // Poll for the KG to land. Decompose updates spaces.entity_count
        // when it persists entities — so a positive count means success
        // regardless of whether our fetch connection survived.
        let kg = await readKgCounts();
        while (kg.entities === 0 && Date.now() - kgStart < KG_DEADLINE_MS) {
          // If the fetch returned a clean (non-error) response, decompose
          // is definitively done — stop waiting even if it produced 0
          // entities (a degenerate decomposition; let the failure below
          // report it rather than burning the full ceiling).
          if (decomposeFetchOk) break;
          await new Promise((r) => setTimeout(r, 6000));
          kg = await readKgCounts();
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
        } else {
          const why = decomposeErr ?? "decompose produced no entities";
          await emitStructuralEvent(db, runId, {
            type: "stage_boundary",
            stage: "kg",
            phase: "exit",
            message: `Building knowledge graph FAILED — ${why}`,
          });
          await refundReservation();
          await completePipelineRun(db, runId, "failed", `decompose: ${why}`);
          return;
        }

        // Distinguishes a severed connection (decompose/synthesize ran
        // long, infra killed the socket at ~300s) from a real HTTP error
        // (quota 500, gate 409). Connection-death → poll the DB; real
        // error → fail with the message so the UI can surface it.
        const isConnectionDeath = (err?: string): boolean =>
          !!err &&
          /fetch failed|timed out|ECONNRESET|socket hang up|network|aborted|EPIPE/i.test(
            err,
          );

        // Has synthesize produced a strategy yet? synthesize writes
        // synthesis_data.strategic_recommendation via generateMultiStepStrategy.
        const readStrategyPresent = async (): Promise<boolean> => {
          const { data } = (await db
            .from("spaces")
            .select("synthesis_data")
            .eq("id", spaceId)
            .maybeSingle()) as {
            data: { synthesis_data: Record<string, unknown> | null } | null;
          };
          const wrap = data?.synthesis_data?.strategic_recommendation as
            | { recommendation?: unknown }
            | undefined;
          return !!((wrap as { recommendation?: unknown })?.recommendation ?? wrap);
        };
        const pollForStrategy = async (deadlineMs: number): Promise<boolean> => {
          const start = Date.now();
          while (Date.now() - start < deadlineMs) {
            if (await readStrategyPresent()) return true;
            await new Promise((r) => setTimeout(r, 6000));
          }
          return readStrategyPresent();
        };

        // ── Stage 1.5: Refine — critique + augment (standard & deep) ──
        // Quick tier is a fast single-pass graph (decompose+structure
        // only), matching TIERS.quick.agents. Standard & deep add a
        // critique+augment pass that finds orphans/gaps and densifies the
        // graph before synthesis — /api/pipeline/critique does BOTH (it
        // critiques AND persists the new edges/cycles). Best-effort: if it
        // fails, the decomposed graph still stands and we proceed.
        if (reasoningDepth === "standard" || reasoningDepth === "deep") {
          const refine = await runStage(
            "landscape", // → maps to the "refine" card in the live view
            "Refining graph — critique + augment",
            `${origin}/api/pipeline/critique`,
            { spaceId },
            180_000,
          );
          if (!refine.outcome.ok) {
            // Non-fatal — the base graph is still usable for synthesis.
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
          // Quick tier — refine is intentionally skipped.
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

        // ── Stage 1.7: Evidence — extract effect sizes + ground edges ──
        // THE step that makes a research paper actually count. For each
        // attached paper we call /api/ingest/[id]/extract-effect-sizes,
        // which parses the paper's quantitative findings (effect size,
        // CI, p-value, sample size, study design) into evidence_registries,
        // AUTO-ATTACHES them to entities, then REML-pools them into
        // edges.strength. So edge weights reflect MEASURED effects, not
        // LLM guesses, with verbatim source quotes for traceability.
        // We pass the objective as goalContext so extraction focuses on
        // the markers the user cares about. Gated to standard/deep +
        // requires papers. Best-effort — the graph still works ungrounded.
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
            // 1. Extract effect sizes per paper (parallel). Each call
            //    persists evidence rows + auto-attaches to entities.
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
            // 2. Final race-free pool — recompute edge strengths from the
            //    full evidence set (the per-call auto-recompute can race
            //    when papers run in parallel).
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
                "[strategy-lab/run] recompute-edge-strengths failed (non-fatal):",
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

        // ── Stage 2: synthesize (produces the strategy) ──────────────
        // We bypass the measurement/layer quality gates (one-shot flow).
        // synthesize is long and its connection can be severed at ~300s
        // while it keeps running — so on a connection death we poll for
        // the strategy artifact rather than failing. A REAL error (e.g.
        // OpenAI quota 500) is surfaced so the live view shows the
        // quota banner.
        const synthesize = await runStage(
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
          strategyPresent = await readStrategyPresent();
        } else if (isConnectionDeath(synthesize.outcome.error)) {
          // Connection died — synthesize may still be finishing. Poll.
          strategyPresent = await pollForStrategy(300_000);
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
          // Real HTTP error (quota / 5xx / gate). Fail with the message
          // so the live view can render an actionable banner.
          await refundReservation();
          await completePipelineRun(
            db,
            runId,
            "failed",
            `synthesize: ${synthesize.outcome.error ?? "unknown"}`,
          );
          return;
        }

        if (!strategyPresent) {
          await emitStructuralEvent(db, runId, {
            type: "stage_boundary",
            stage: "proposal",
            phase: "exit",
            message: "Synthesizing landscape FAILED — no strategy produced",
          });
          await refundReservation();
          await completePipelineRun(
            db,
            runId,
            "failed",
            "synthesize: completed but produced no strategy",
          );
          return;
        }

        // ── Stage 3: strategy-refresh (refine + wire twin proposal) ──
        // The strategy already exists in synthesis_data after synthesize.
        // strategy-refresh refines it + materializes a twin_proposals row
        // + mechanisms. It's therefore BEST-EFFORT: if it fails (or its
        // connection drops), we do NOT fail the run — the strategy from
        // stage 2 stands. We still surface what happened on the card.
        // NOTE: we do NOT pass reservationId to strategy-refresh. It's a
        // best-effort stage, and letting it commit/cancel the reservation
        // creates an ambiguous ownership (if its connection drops we don't
        // know if it committed). The orchestrator is the SOLE owner of the
        // reservation lifecycle — committed on final success, cancelled on
        // any failure (see the Done block below).
        const strategy = await runStage(
          "twin",
          "Refining strategy + twin proposal",
          `${origin}/api/pipeline/strategy-refresh`,
          {
            spaceId,
            deferApps: true,
          },
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

        // ── Verify a strategy was produced ───────────────────────────
        // Success = a strategy exists, which lands in EITHER of two
        // places:
        //   1. a twin_proposals row (when strategy-refresh wired one), OR
        //   2. spaces.synthesis_data.strategic_recommendation (the path
        //      taken with deferApps=true — strategy-refresh generates +
        //      ranks strategies into synthesis_data but doesn't always
        //      insert a twin_proposals row).
        // Requiring a twin_proposals row alone wrongly reported "failed"
        // on runs that had in fact generated a high-quality strategy.
        let strategyFound = false;
        let detail = "";
        try {
          const { data: tpRow } = (await db
            .from("twin_proposals")
            .select("id")
            .eq("space_id", spaceId)
            .eq("user_id", user.id)
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
            const rec =
              (wrap as { recommendation?: unknown })?.recommendation ?? wrap;
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
          console.warn("[strategy-lab/run] strategy lookup failed:", err);
        }

        // Corrective twin-stage boundary: strategy-refresh is best-effort
        // (the strategy already exists from synthesize), so if its
        // runStage emitted a FAILED exit on a connection drop, override
        // it here with the true outcome. The status endpoint takes the
        // LAST exit event per stage, so this wins.
        await emitStructuralEvent(db, runId, {
          type: "stage_boundary",
          stage: "twin",
          phase: "exit",
          message: strategyFound
            ? "Strategy ready"
            : "Strategy + twin proposal FAILED — no strategy produced",
        });

        // ── Reservation settlement (orchestrator owns it) ───────────
        if (strategyFound) {
          if (reservationId) {
            await commitReservation(db, reservationId, spaceId).catch(
              (e) =>
                console.warn(
                  "[strategy-lab/run] commitReservation threw:",
                  e,
                ),
            );
          }
        } else {
          // Stages passed but no strategy materialized — refund.
          await refundReservation();
        }

        // ── Done ─────────────────────────────────────────────────────
        await completePipelineRun(
          db,
          runId,
          strategyFound ? "completed" : "failed",
          strategyFound
            ? undefined
            : "Chain completed but no strategy was produced",
        );
      } catch (outerErr) {
        console.error(
          "[strategy-lab/run] orchestrator escape:",
          outerErr,
        );
        await refundReservation();
        await completePipelineRun(
          db,
          runId,
          "failed",
          `orchestrator escape: ${outerErr instanceof Error ? outerErr.message : String(outerErr)}`,
        ).catch(() => {});
      } finally {
        // Always stop the heartbeat — on success, every failure return,
        // and the outer-escape catch (finally runs on early `return`s too).
        clearInterval(heartbeat);
      }
    });

    return NextResponse.json({ spaceId, runId, redirectTo });
  } catch (outerErr) {
    console.error("[strategy-lab/run] unhandled error:", outerErr);
    return NextResponse.json(
      {
        error:
          outerErr instanceof Error
            ? outerErr.message
            : "Strategy Lab failed to start — please try again.",
      },
      { status: 500 },
    );
  }
}
