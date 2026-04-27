import { NextResponse, after } from "next/server";
import { llmGenerate, llmJSON, llmStream } from "@/lib/llm";
import { getDecompositionPrompt, getStructuringPrompt } from "@/lib/prompts/tier-prompts";
import { safeAuth, sanitizeErrorMessage } from "@/lib/api-helpers";
import { buildDecompIntentBlock, buildDomainDecompBlock } from "@/lib/prompts/intent-context";
import { buildFrameworkDecompBlock } from "@/lib/pipeline/decomposition-router";
import type { UserIntent } from "@/types/analysis";
import type { EpistemicClassification } from "@/types/epistemic";
import type { StructuredDecomposition } from "@/types/analysis";
import {
  sanitizeEntity,
  sanitizeEdge,
  sanitizeCycle,
  deduplicateEntities,
  mergeByTopologyEqual,
  resilientInsert,
  filterLowConfidenceEdges,
  extractEvidenceBasis,
  materializeFault,
  MATURITY_LEVELS,
} from "@/lib/sanitize";
import { computeDegreeCentrality } from "@/lib/whiteboard/centrality";
import { computeCascades } from "@/lib/graph/cascade-detection";
import { scoreDecompositionQuality, buildStructuringGuidance } from "@/lib/decomposition-quality";
import { parseAxioms } from "@/lib/decomposition/parse-axioms";
import { verifyCyclesAgainstEdges } from "@/lib/decomposition/verify-cycles";
import { enrichCyclesWithTier3 } from "@/lib/decomposition/enrich-cycles";
import { extractTier3Annotations, formatAnnotationsForStructuring } from "@/lib/decomposition/extract-annotations";
import {
  extractCandidateEntityNames,
  extractCandidateEdges,
} from "@/lib/decomposition/extract-candidate-names";
import { randomUUID } from "crypto";
import { computeDecompFingerprint } from "@/lib/pipeline/cache";
import { appendRun, makeRunId } from "@/lib/pipeline/analysis-runs";
import type { AnalysisRun } from "@/types/analysis-runs";
import type { DecompositionQualityReport } from "@/lib/decomposition-quality";
import { validateStructuredDecomposition } from "@/lib/validation/llm-validators";
import { createFallbackDecomposition } from "@/lib/validation/error-recovery";
import {
  startPipelineRun,
  emitStructuralEvent,
  emitBatchEvents,
  completePipelineRun,
} from "@/lib/events/structural-event-bus";
import { materializeAndEmitSignatures } from "@/lib/pipeline/materialize-signatures";
import type { StructuralEvent } from "@/types/pipeline-events";

export const maxDuration = 300; // Deep tier: 2 large LLM passes, up to 50 entities + full manifold

// ── Pass 2 fallback-used signal (2026-04-24 stall fix) ─────────────
//
// `structureDecompositionJSON` can silently return the pre-built
// fallback when both LLM retries throw (line ~111). Without a signal,
// the caller can't distinguish "LLM worked, 0 entities validly
// extracted" from "LLM blew up twice, we gave up". That distinction
// matters for the HUD — the silent-fallback case should surface a
// "⚠ structuring failed" heartbeat just like Pass 1 does on throw.
//
// We thread a mutable signal object through instead of adding a
// second return value, so the existing 30+ call-site expression
// (`parsed = pass1Failed ? ... : await structureDecompositionJSON(...)`)
// keeps working as a single expression.
interface Pass2Signal { fellBack: boolean }

async function structureDecompositionJSON(opts: {
  decompositionText: string;
  reasoningDepth: "quick" | "standard" | "deep";
  maxTokens: number;
  fallbackPrefix?: string;
  fallbackName?: string;
  fallbackDescription?: string;
  extraGuidance?: string;
  signal?: Pass2Signal;
}): Promise<StructuredDecomposition> {
  // Extract Tier 3 annotations (topology / dynamics / conditions / strength) from
  // the Pass 1 prose via regex scan, then inject them as a preservation hint.
  // This is the counter to the known failure where Pass 2 re-infers edge metadata
  // from scratch and loses the precise annotations the LLM already emitted.
  const tier3Annotations = extractTier3Annotations(opts.decompositionText);
  const annotationBlock = formatAnnotationsForStructuring(tier3Annotations);
  if (tier3Annotations.length > 0) {
    const withTopology = tier3Annotations.filter((a) => a.topology).length;
    const withDynamics = tier3Annotations.filter((a) => a.dynamics).length;
    console.log(`[structure] Tier 3 extracted: ${tier3Annotations.length} edge annotations (${withTopology} with topology, ${withDynamics} with non-default dynamics)`);
  }

  const userPrompt = `Convert this decomposition to JSON:\n\n${opts.decompositionText}${annotationBlock ? `\n\n${annotationBlock}` : ""}${opts.extraGuidance ? `\n\n--- QUALITY GUIDANCE ---\n${opts.extraGuidance}` : ""}`;
  const fallback = createFallbackDecomposition(
    opts.fallbackPrefix ?? "space",
    opts.fallbackName ?? "Analysis",
    opts.fallbackDescription ?? "Failed to parse decomposition"
  );

  try {
    return await llmJSON<StructuredDecomposition>({
      system: getStructuringPrompt(opts.reasoningDepth),
      user: userPrompt,
      maxTokens: opts.maxTokens,
      temperature: 0.1,
      validator: validateStructuredDecomposition,
      fallback,
    });
  } catch (firstErr) {
    console.warn("[decompose] Structuring JSON parse failed, retrying with strict formatting guidance:", firstErr);
    try {
      return await llmJSON<StructuredDecomposition>({
        system: getStructuringPrompt(opts.reasoningDepth),
        user: `${userPrompt}\n\nIMPORTANT: Return strictly valid JSON only. No trailing commas, no comments, no markdown fences, no explanatory prose.`,
        maxTokens: opts.maxTokens,
        temperature: 0.0,
        validator: validateStructuredDecomposition,
        fallback,
      });
    } catch (strictErr) {
      // Both attempts exhausted (network + parse + validator retries).
      // `llmJSON`'s `fallback` is only consulted on validator failures,
      // not parse/network exhaustion — so without this catch, the
      // whole decompose run dies when the LLM provider is flaky.
      // Return the pre-built fallback decomposition: an empty-shell
      // graph that lets the pipeline close cleanly, the canvas
      // render an intelligible "empty run" state, and the user retry.
      console.error(
        "[decompose] Structuring exhausted both retries; using fallback decomposition:",
        strictErr,
      );
      if (opts.signal) opts.signal.fellBack = true;
      return fallback;
    }
  }
}

export async function POST(request: Request) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Structural event bus — runId scoped outside the main try so the
  // catch block can complete the run as failed on throw. Initialized
  // after space creation (runs are space-scoped).
  let runId: string | null = null;

  let text: string;
  let spaceConfig: {
    name?: string;
    prefix?: string;
    description?: string;
    key_concepts?: string[];
    parent_space_id?: string;
    originated_from_entity_id?: string;
    depth_level?: number;
  } | undefined;
  let siblingContext: string | undefined;
  let reasoningDepth: "quick" | "standard" | "deep" = "standard";
  let intent: UserIntent | undefined;
  let epistemicClassification: EpistemicClassification | null = null;
  let comprehensiveMode = false;
  // Phase 1 Step 4 — when /api/intake/bootstrap has already created a
  // placeholder space + pipeline_run row, it forwards both IDs here so
  // decompose rehydrates onto them instead of creating duplicates. All
  // emissions (entity_added, edge_added, cycle_detected) land on the
  // existing run, which the client's SSE stream is already subscribed
  // to — that's what turns "wait 60s then land" into "land instantly,
  // watch it unfurl".
  let existingSpaceId: string | undefined;
  let existingRunId: string | undefined;
  // Auto-advance opt-in (Phase 1 Step 13): when bootstrap forwards
  // autoAdvance=true we continue the chain to research on completion.
  // Manual callers (button clicks from the dashboard) omit this and
  // stay unchained.
  let autoAdvance = false;
  // Credit reservation id threaded from bootstrap. Chain commits on
  // terminal success (strategy-refresh), any mid-chain catch cancels
  // and refunds. Undefined = manual caller that bypassed bootstrap
  // (e.g., dashboard retry button) — no reservation to manage.
  let reservationId: string | undefined;
  // Memory settings — optional. When present and enabled, a semantic
  // search against the user's memory_items runs before Pass 1 and the
  // top-k hits are injected into the system prompt as prior context.
  let memorySettings: import("@/lib/brainstorm/brainstorm-settings").MemorySettings | undefined;

  try {
    const body = await request.json();
    text = body.text;
    spaceConfig = body.spaceConfig;
    siblingContext = body.siblingContext;
    intent = body.intent;
    epistemicClassification = body.epistemicClassification ?? null;
    if (body.reasoningDepth === "quick" || body.reasoningDepth === "standard" || body.reasoningDepth === "deep") {
      reasoningDepth = body.reasoningDepth;
    }
    comprehensiveMode = body.comprehensiveMode === true;
    // Comprehensive mode always uses deep depth so the LLM has the full context
    // window + retry budget for maximum rigor.
    if (comprehensiveMode) reasoningDepth = "deep";
    if (typeof body.existingSpaceId === "string") existingSpaceId = body.existingSpaceId;
    if (typeof body.existingRunId === "string") existingRunId = body.existingRunId;
    if (body.autoAdvance === true) autoAdvance = true;
    if (typeof body.reservationId === "string") reservationId = body.reservationId;
    // Memory settings — optional, sent by the canvas UI when the user
    // has opted in. Absent = memory disabled for this run.
    if (body.memorySettings && typeof body.memorySettings === "object") {
      memorySettings = body.memorySettings as import("@/lib/brainstorm/brainstorm-settings").MemorySettings;
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!text) {
    return NextResponse.json({ error: "Text required" }, { status: 400 });
  }

  try {
    // Build prompt with sibling context if available
    let userPrompt = text;
    if (spaceConfig && siblingContext) {
      userPrompt = `You are analyzing ONE specific area of a larger situation. Focus ONLY on this area.

Area: ${spaceConfig.name}
Description: ${spaceConfig.description}
Key concepts: ${(spaceConfig.key_concepts ?? []).join(", ")}

${siblingContext ? `Other areas being analyzed separately (for boundary awareness):\n${siblingContext}\n` : ""}

The input to analyze:
${text}`;
    }

    // Prepend intent context + domain-specific extraction guidance + framework routing
    const intentPrefix = buildDecompIntentBlock(intent);
    const domainPrefix = buildDomainDecompBlock(intent?.context_type);
    const frameworkPrefix = buildFrameworkDecompBlock(epistemicClassification);
    const combinedPrefix = [intentPrefix, domainPrefix, frameworkPrefix].filter(Boolean).join("\n");
    const enrichedPrompt = combinedPrefix ? combinedPrefix + "\n\n" + userPrompt : userPrompt;

    // Token budgets scale with depth — deep mode needs much more space
    // for 25-50 entities with manifold assessments, cycle tracing, etc.
    // GPT-4o max output is 16384 tokens — use the full budget for standard+deep
    const decompTokens = reasoningDepth === "deep" ? 16384
      : reasoningDepth === "standard" ? 16384
      : 12000;
    const structTokens = 16384; // Always max for structured JSON output

    // ── Memory pre-retrieval ──────────────────────────────────────────
    // When the user has opted into "memory from past work", query their
    // memory_items table for semantically similar prior context and
    // prepend it to the Pass 1 system prompt. Soft-fail — a retrieval
    // hiccup must never block the decomposition.
    let memoryPromptBlock: string | null = null;
    let memoryItemCount = 0;
    let memoryTokenEstimate = 0;
    if (memorySettings?.enabled) {
      try {
        const { queryMemoryForDecomposition } = await import("@/lib/memory/retrieve");
        const memCtx = await queryMemoryForDecomposition(
          db,
          text,
          user.id,
          memorySettings,
          existingSpaceId,
        );
        if (memCtx) {
          memoryPromptBlock = memCtx.promptBlock;
          memoryItemCount = memCtx.itemCount;
          memoryTokenEstimate = memCtx.tokenEstimate;
        }
      } catch (memErr) {
        console.warn("[decompose] memory pre-retrieval failed:", memErr);
      }
    }

    // Audit-trail timestamps (run_id assigned at completion after we know final metrics)
    const decomposeStartedAt = new Date().toISOString();

    // Phase 1 Step 17 — progress heartbeat. Decompose's two LLM passes
    // can take 30-120s combined; the user stares at "Intake…" with
    // no visible activity. Emit lightweight stage_boundary messages
    // at each checkpoint so the HUD can surface the current phase.
    // Same stage id ("intake") + phase "enter" so downstream digest
    // logic doesn't double-count, but message updates let the UI
    // render "Decomposing prompt…" → "Extracting entities…" → etc.
    if (existingRunId) {
      await emitStructuralEvent(db, existingRunId, {
        type: "stage_boundary",
        stage: "intake",
        phase: "enter",
        message: `Decomposing prompt (${reasoningDepth} reasoning)…`,
      });
      // Emit memory context signal to the canvas HUD so the user can
      // see "Drawing on N memories" while the LLM is reasoning.
      if (memoryItemCount > 0) {
        await emitStructuralEvent(db, existingRunId, {
          type: "memory_context_loaded",
          itemCount: memoryItemCount,
          tokenEstimate: memoryTokenEstimate,
        });
      }
    }

    // Build Pass 1 system prompt — base decomposition prompt optionally
    // extended with the memory context block when memory is enabled.
    const pass1SystemPrompt = memoryPromptBlock
      ? `${getDecompositionPrompt(reasoningDepth)}\n\n${memoryPromptBlock}`
      : getDecompositionPrompt(reasoningDepth);

    // Pass 1: Decomposition (free-form reasoning). STREAMED so the
    // user sees the AI's reasoning as it arrives instead of a 45-90s
    // silent spinner. We accumulate tokens and emit `reasoning_chunk`
    // events at ~1s cadence — not per-token (too chatty, DB spam) and
    // not just at the end (defeats the purpose). The reasoning-trace
    // panel on the canvas renders these with a typewriter feel plus a
    // token progress bar driven by charsSoFar / (tokenBudget * 4).
    //
    // Wrapped so LLM provider outages (ConnectTimeout, 429 exhaustion,
    // etc.) don't hard-fail the whole run. On exhaustion we fall
    // through to an empty-shell StructuredDecomposition — the user
    // lands on a valid (if minimal) space with a retry-ready state
    // and a visible "⚠ LLM unreachable" heartbeat in the HUD subtitle.
    let rawDecomposition: string;
    let pass1Failed = false;
    try {
      let accumulated = "";
      let lastEmitMs = 0;
      let lastPreviewScanMs = 0;
      const EMIT_EVERY_MS = 1000;
      // Preview-entity extraction scan cadence. 1500ms is frequent
      // enough that the canvas paints entities live as the LLM writes
      // them, but not so frequent that we re-regex a huge buffer every
      // token.
      const PREVIEW_SCAN_EVERY_MS = 1500;
      // ── Pass 1 timeouts (2026-04-24 stall fix) ──────────────────────
      //
      // Previously Pass 1 had NO upper bound. When the LLM provider
      // hung (not errored — hung), the streaming for-await would sit
      // indefinitely waiting for the first token. The UI froze on
      // "Decomposing prompt (standard reasoning)…" with no way to
      // surface the hang to the user. Two bounds protect against this:
      //
      //   • PASS1_HARD_CAP_MS (150s): absolute ceiling on Pass 1 wall
      //     time. Anthropic's reasoning-depth=deep tier occasionally
      //     takes 90-120s on legitimate reasoning; 150s leaves
      //     headroom without becoming a latent forever-hang.
      //   • PASS1_IDLE_MS (45s): max gap between tokens. The stream
      //     typically yields sub-second cadence once underway; a 45s
      //     silence means the connection stalled.
      //
      // Either breach throws → caught by the existing pass1Err handler
      // → emits "⚠ LLM unreachable — showing empty analysis" heartbeat
      // → falls through to createFallbackDecomposition. The user sees
      // a visible failure state instead of an invisible infinite spin.
      const PASS1_HARD_CAP_MS = 150_000;
      const PASS1_IDLE_MS = 45_000;
      const pass1Deadline = Date.now() + PASS1_HARD_CAP_MS;
      let lastTokenAt = Date.now();
      // Preview entities let the main canvas populate DURING Pass 1
      // instead of waiting for Pass 2's batch. We regex candidate names
      // out of the accumulated markdown and emit synthetic entity_added
      // events with a `preview-` UUID prefix so the painter can sweep
      // them when Pass 2's authoritative rows land (see pipeline-event
      // -painter's previewsByName map). Names seen is a Set so we never
      // double-emit the same name.
      const previewNamesSeen = new Set<string>();
      // Entity code (C1/C2/…) → preview UUID. Built as we emit preview
      // entities so the edge extractor can resolve arrow patterns like
      // "C1 → C3" to real preview UUIDs the painter already has ghosts
      // for. Edges referencing unknown codes are silently dropped.
      const previewCodeToUuid = new Map<string, string>();
      const previewEdgePairsSeen = new Set<string>();

      // Iterate the stream manually so we can race each `.next()`
      // against a timeout. `for await` has no natural timeout hook;
      // manual iteration + Promise.race is the standard workaround.
      // On timeout we call iter.return?.() to signal the underlying
      // stream to stop (SDK implementations of Anthropic + OpenAI both
      // honor this by closing the HTTP connection), then re-throw to
      // hit the pass1Err handler.
      const pass1Stream = llmStream({
        system: pass1SystemPrompt,
        user: enrichedPrompt,
        maxTokens: decompTokens,
        temperature: 0.3,
      });
      const iter = pass1Stream[Symbol.asyncIterator]();

      while (true) {
        const nowForBudget = Date.now();
        const hardRemaining = pass1Deadline - nowForBudget;
        const idleRemaining = PASS1_IDLE_MS - (nowForBudget - lastTokenAt);
        if (hardRemaining <= 0) {
          await iter.return?.(undefined).catch(() => {});
          throw new Error(
            `Pass 1 exceeded hard cap (${PASS1_HARD_CAP_MS}ms) — LLM stream likely hung.`,
          );
        }
        if (idleRemaining <= 0) {
          await iter.return?.(undefined).catch(() => {});
          throw new Error(
            `Pass 1 idle timeout (${PASS1_IDLE_MS}ms since last token) — LLM stream stalled.`,
          );
        }
        const timeoutMs = Math.min(hardRemaining, idleRemaining);

        let timer: ReturnType<typeof setTimeout> | null = null;
        const timeoutPromise = new Promise<IteratorResult<string>>(
          (_, reject) => {
            timer = setTimeout(
              () => reject(new Error("__pass1_timeout__")),
              timeoutMs,
            );
          },
        );

        let result: IteratorResult<string>;
        try {
          result = await Promise.race([iter.next(), timeoutPromise]);
        } catch (err) {
          if (timer) clearTimeout(timer);
          // Timeout fired — ensure the underlying stream is cleaned
          // up before re-throwing into the pass1Err handler.
          await iter.return?.(undefined).catch(() => {});
          if (err instanceof Error && err.message === "__pass1_timeout__") {
            throw new Error(
              `Pass 1 timed out after ${timeoutMs}ms of inactivity — LLM stream stalled.`,
            );
          }
          throw err;
        }
        if (timer) clearTimeout(timer);

        if (result.done) break;
        const tokenChunk = result.value;
        lastTokenAt = Date.now();
        accumulated += tokenChunk;
        const now = Date.now();
        if (runId && now - lastEmitMs >= EMIT_EVERY_MS) {
          lastEmitMs = now;
          await emitStructuralEvent(db, runId, {
            type: "reasoning_chunk",
            stage: "intake",
            textSoFar: accumulated,
            tokenBudget: decompTokens,
            charsSoFar: accumulated.length,
            phase: "thinking",
          });
        }
        if (runId && now - lastPreviewScanMs >= PREVIEW_SCAN_EVERY_MS) {
          lastPreviewScanMs = now;
          const newEntities = extractCandidateEntityNames(accumulated, previewNamesSeen);
          const previewEvents: StructuralEvent[] = [];
          for (const ent of newEntities) {
            const previewUuid = `preview-${randomUUID()}`;
            if (ent.code) previewCodeToUuid.set(ent.code, previewUuid);
            previewEvents.push({
              type: "entity_added",
              entityId: previewUuid,
              entityCode: ent.code,
              name: ent.name,
              entityCategory: null,
              importance: "moderate",
              parentEntityId: null,
            });
          }
          // Preview edges: resolve code-pair arrows (C1 → C3) to preview
          // UUIDs we've already emitted. Painter binds arrows to shape
          // ids, so when the Pass 2 rebind swaps a preview entity's
          // entityId to its real UUID, the arrow stays visually attached.
          const newEdges = extractCandidateEdges(
            accumulated,
            previewCodeToUuid,
            previewEdgePairsSeen,
          );
          for (const e of newEdges) {
            previewEvents.push({
              type: "edge_added",
              edgeId: `preview-${randomUUID()}`,
              sourceEntityId: e.sourcePreviewId,
              targetEntityId: e.targetPreviewId,
              relationshipType: "influences",
              dimension: "causal",
              polarity: null,
              confidence: 0.5,
            });
          }
          if (previewEvents.length > 0) {
            await emitBatchEvents(db, runId, previewEvents);
          }
        }
      }
      // Final emit marks the stream complete so the panel knows to
      // stop its pulsing cursor.
      if (runId) {
        await emitStructuralEvent(db, runId, {
          type: "reasoning_chunk",
          stage: "intake",
          textSoFar: accumulated,
          tokenBudget: decompTokens,
          charsSoFar: accumulated.length,
          phase: "complete",
        });
      }
      rawDecomposition = accumulated;
      console.log(`[decompose] Pass 1 complete: ${rawDecomposition.length} chars, depth=${reasoningDepth}, budget=${decompTokens} tokens`);
    } catch (pass1Err) {
      pass1Failed = true;
      rawDecomposition = "";
      console.error(
        "[decompose] Pass 1 LLM exhausted — falling through to empty-shell decomposition:",
        pass1Err,
      );
      if (runId) {
        await emitStructuralEvent(db, runId, {
          type: "stage_boundary",
          stage: "intake",
          phase: "enter",
          message:
            "⚠ LLM unreachable — showing empty analysis. Retry when the provider recovers.",
        });
      }
    }

    // ── Pass 1 empty-success guard (2026-04-24 stall fix) ───────────
    //
    // Observed failure mode in run c13f5bbf…: the LLM stream sat
    // silent for 6 minutes then closed cleanly with `done:true` on
    // the very first `iter.next()` — zero tokens yielded, zero
    // throws. Pass 1 "completed" with rawDecomposition = "". pass1Err
    // never fired so pass1Failed stayed false, the "⚠ LLM unreachable"
    // heartbeat never emitted, and we silently marched to Pass 2 with
    // empty input.
    //
    // Promote this to pass1Failed so downstream paths treat it like
    // any other LLM outage: visible heartbeat, fallback decomposition,
    // no wasted structuring LLM call. The new 150s hard cap + 45s
    // idle timeout should make this case rarer (the stream is now
    // aborted instead of being allowed to run silent indefinitely),
    // but belt-and-suspenders: even if those timeouts DON'T fire and
    // the stream legitimately returns empty, we catch the shape here.
    if (!pass1Failed && rawDecomposition.length === 0) {
      pass1Failed = true;
      console.warn(
        "[decompose] Pass 1 stream returned zero tokens without throwing — promoting to pass1Failed for fallback path.",
      );
      if (runId) {
        await emitStructuralEvent(db, runId, {
          type: "stage_boundary",
          stage: "intake",
          phase: "enter",
          message:
            "⚠ LLM returned empty response — showing empty analysis. Retry when the provider recovers.",
        });
      }
    }

    if (runId && !pass1Failed) {
      await emitStructuralEvent(db, runId, {
        type: "stage_boundary",
        stage: "intake",
        phase: "enter",
        message: "Extracting entities and relationships…",
      });
    }

    // ── Quality-aware structuring + retry ──
    // Pass 2 is a non-streaming LLM call that can take 45-90s on
    // standard tier (longer on deep). Without heartbeats the HUD
    // subtitle freezes on "Extracting entities…" for a minute with
    // no visible progress — the single biggest dead zone in the
    // pipeline per the UX movie. We kick a 5s-cadence heartbeat
    // timer that updates the subtitle with elapsed time vs. the
    // tier's typical range, then cancel it the moment Pass 2
    // returns (or throws). The heartbeats DON'T advance the stage
    // strip; they only update the subtitle so the user knows the
    // pipeline is alive and roughly how much longer to expect.
    const pass2TypicalSec = reasoningDepth === "deep" ? 75 : reasoningDepth === "standard" ? 55 : 30;
    const pass2StartMs = Date.now();
    let pass2HeartbeatTimer: ReturnType<typeof setInterval> | null = null;
    if (runId && !pass1Failed) {
      pass2HeartbeatTimer = setInterval(() => {
        const elapsedSec = Math.round((Date.now() - pass2StartMs) / 1000);
        // Soft-fail on emit — never throw out of a heartbeat into
        // the main pipeline. The emit itself is soft-fail by design.
        void emitStructuralEvent(db, runId, {
          type: "stage_boundary",
          stage: "intake",
          phase: "enter",
          message: `Structuring into entities + relationships… ${elapsedSec}s elapsed (typical ~${pass2TypicalSec}s)`,
        });
      }, 5000);
    }

    let parsed: StructuredDecomposition;
    const pass2Signal: Pass2Signal = { fellBack: false };
    try {
      parsed = pass1Failed
        ? createFallbackDecomposition(
            spaceConfig?.prefix ?? "space",
            spaceConfig?.name ?? "Analysis",
            spaceConfig?.description ??
              "LLM provider was unreachable during decomposition. Retry to populate.",
          )
        : await structureDecompositionJSON({
            decompositionText: rawDecomposition,
            reasoningDepth,
            maxTokens: structTokens,
            fallbackPrefix: spaceConfig?.prefix,
            fallbackName: spaceConfig?.name,
            fallbackDescription: spaceConfig?.description,
            signal: pass2Signal,
          });
    } finally {
      if (pass2HeartbeatTimer) clearInterval(pass2HeartbeatTimer);
    }

    // ── Pass 2 silent-fallback heartbeat (2026-04-24 stall fix) ──
    //
    // Observed failure mode in run 68274c8f…: Pass 1 returned garbage
    // tokens (non-empty so the empty-success guard skipped), Pass 2
    // threw twice trying to parse them to JSON, and
    // `structureDecompositionJSON` silently returned the pre-built
    // fallback. The run then emitted "Decomposing: Analysis" → "
    // Persisting 0 entities…" → kg:exit and the HUD froze mid-intake
    // with no visible signal of what went wrong.
    //
    // When the signal fires, surface the same "⚠ structuring failed"
    // heartbeat shape as the Pass 1 throw path so the user sees a
    // concrete retry prompt instead of a soundless stall.
    if (pass2Signal.fellBack && runId) {
      await emitStructuralEvent(db, runId, {
        type: "stage_boundary",
        stage: "intake",
        phase: "enter",
        message:
          "⚠ Structuring failed (LLM returned unparseable output) — showing empty analysis. Retry when the provider recovers.",
      });
    }

    // Filter low-confidence edges + deduplicate entities
    const rawEntityCount = (parsed.entities ?? []).length;
    const rawEdgeCount = (parsed.edges ?? []).length;
    const confFilteredEdges = filterLowConfidenceEdges(parsed.edges ?? [], 0.2, (parsed.entities ?? []).length);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nameDeduped = deduplicateEntities(
      (parsed.entities ?? []) as any,
      confFilteredEdges as any
    );

    // Second dedup pass: merge entities the LLM explicitly marked as equal via
    // edge topology. Catches same-concept duplicates the name normalizer missed
    // (e.g. "ML pipeline" vs "inference stack"). Runs on arrays so downstream
    // code can keep mutating via .length=0/push as it already does.
    const topoMerged = mergeByTopologyEqual(nameDeduped.entities, nameDeduped.edges);
    const dedupedEntities = topoMerged.entities;
    const dedupedEdges = topoMerged.edges;

    console.log(`[decompose] Pipeline: ${rawEntityCount} raw → ${nameDeduped.entities.length} after name-dedup → ${dedupedEntities.length} after topology-merge (${topoMerged.mergesApplied} topo merges), ${rawEdgeCount} raw edges → ${confFilteredEdges.length} after confidence → ${dedupedEdges.length} final`);

    // ── Pass 3 substage: cycle verification ──
    // Previously silent — user saw no activity for ~3–8s of post-
    // structuring work. Emit stage_boundary so the HUD can say
    // "Verifying feedback loops…" instead of going quiet.
    if (runId) {
      await emitStructuralEvent(db, runId, {
        type: "stage_boundary",
        stage: "intake",
        phase: "enter",
        message: "Verifying feedback loops against edge set…",
      });
    }

    // ── Cycle re-verification against filtered edge set ──
    // Cycles are LLM-traced prose, materialized before edge filtering. Any edge that
    // was below confidence threshold (filterLowConfidenceEdges) or merged away
    // (topology=equal) may have broken a cycle. Re-verify to drop phantom cycles
    // that claim A→B→C→A but are missing real edges in the final graph.
    if (parsed.cycles && parsed.cycles.length > 0) {
      const verification = verifyCyclesAgainstEdges(
        parsed.cycles as Array<{ cycle_id?: string; entity_ids: string[] }>,
        dedupedEdges as Array<{ source_entity_id: string; target_entity_id: string; relationship_type?: string; topology?: string | null; dynamics?: string | null; confidence?: number }>,
      );
      if (verification.dropped.length > 0 || verification.downgraded.length > 0) {
        console.log(`[cycle-verify] ${verification.verified.length} verified, ${verification.dropped.length} dropped as phantom, ${verification.downgraded.length} downgraded (missing 1 edge in long chain)`);
        for (const d of verification.dropped) {
          console.log(`[cycle-verify] Dropped ${d.cycle_id}: ${d.reason}`);
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parsed.cycles = verification.verified as any;
    }

    // ── Pass 3 substage: Tier 3 enrichment ──
    if (runId) {
      await emitStructuralEvent(db, runId, {
        type: "stage_boundary",
        stage: "intake",
        phase: "enter",
        message: "Enriching cycles with compounding dynamics…",
      });
    }

    // ── Tier 3 → cycle enrichment ──
    // Cross-reference the LLM-traced cycles with edges that Tier 3 annotations
    // flagged as compounding/exponential. Boosts growth_type where missing, marks
    // cycles as tier3_verified, and surfaces orphan feedback edges as candidates
    // (cycles the LLM may have missed tracing).
    if (parsed.cycles && parsed.cycles.length > 0) {
      const cycleEnrichment = enrichCyclesWithTier3(
        parsed.cycles as Array<{ cycle_id?: string; entity_ids: string[]; growth_type?: string | null; classification?: string }>,
        dedupedEdges as Array<{ source_entity_id: string; target_entity_id: string; dynamics?: string | null; confidence?: number; polarity?: string }>,
      );
      if (cycleEnrichment.stats.cyclesVerified > 0 || cycleEnrichment.stats.orphanCompoundingEdges > 0) {
        console.log(`[cycle-enrich] ${cycleEnrichment.stats.cyclesVerified}/${parsed.cycles.length} cycles tier3-verified, ${cycleEnrichment.stats.cyclesGrowthTypeBoosted} growth_type backfilled, ${cycleEnrichment.stats.orphanCompoundingEdges} orphan compounding edges flagged as candidate cycles`);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parsed.cycles = cycleEnrichment.enrichedCycles as any;
      // Store candidate cycles on structuringMeta for display + future cycle-detection pass
      if (cycleEnrichment.candidateCycles.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (parsed as any).candidate_cycles = cycleEnrichment.candidateCycles;
      }
    }

    // ── Pass 3 substage: quality scoring ──
    if (runId) {
      await emitStructuralEvent(db, runId, {
        type: "stage_boundary",
        stage: "intake",
        phase: "enter",
        message: "Scoring decomposition quality…",
      });
    }

    // ── Quality scoring + quality-driven retry ──
    let qualityReport: DecompositionQualityReport = scoreDecompositionQuality(
      dedupedEntities as Array<{ entity_id: string; name: string; description?: string; source_tag?: string; importance?: string; manifold?: unknown }>,
      dedupedEdges as Array<{ source_entity_id: string; target_entity_id: string; relationship_type?: string; topology?: string | null; dynamics?: string | null; confidence?: number }>,
      reasoningDepth
    );
    let didRetry = false;
    let retryImproved = false;

    console.log(`[decompose] Quality score: ${qualityReport.overall.toFixed(2)}, deficiencies: ${qualityReport.deficiencies.length}${qualityReport.retryRecommended ? " → RETRY RECOMMENDED" : ""}${comprehensiveMode ? " [COMPREHENSIVE MODE]" : ""}`);
    if (qualityReport.deficiencies.length > 0) {
      console.log(`[decompose] Deficiencies: ${qualityReport.deficiencies.join("; ")}`);
    }

    // In comprehensive mode, promote retry recommendation to mandatory if either:
    //  - the quality report already recommends retry, OR
    //  - no HIDDEN axiom was extracted from Pass 1 (comprehensive demands at least one)
    // Parse axioms ahead of schedule for the HIDDEN-check; they'll also be parsed
    // later for the normal flow.
    const preCheckAxioms = parseAxioms(rawDecomposition);
    const hasHiddenAxiom = preCheckAxioms.some((a) => a.visibility === "HIDDEN");
    const comprehensiveDemandsRetry = comprehensiveMode && !hasHiddenAxiom;
    if (comprehensiveDemandsRetry) {
      console.log(`[decompose] Comprehensive mode: no HIDDEN axiom extracted — forcing retry with stricter Tier 7 demand`);
    }

    // Earlier gate required `dedupedEntities.length > 0` for retry —
    // that excluded the worst case (Pass 2 returned 0 entities from a
    // 15K-char Pass 1) and silently persisted an empty graph. The new
    // condition ALSO retries when we got zero entities but Pass 1
    // produced real text (i.e., the LLM managed freeform reasoning but
    // the structuring step yielded nothing useful). Pass1Failed path
    // skips retry because the LLM was unreachable — retrying would
    // just hit the same outage.
    const zeroEntityFromValidPass1 = !pass1Failed && dedupedEntities.length === 0 && rawDecomposition.length > 200;
    if (
      (qualityReport.retryRecommended || comprehensiveDemandsRetry || zeroEntityFromValidPass1) &&
      !pass1Failed
    ) {
      didRetry = true;
      if (zeroEntityFromValidPass1) {
        console.warn(
          `[decompose] Pass 2 returned 0 entities from ${rawDecomposition.length}-char Pass 1. Retrying with targeted guidance…`,
        );
      } else {
        console.warn(
          `[decompose] Quality ${qualityReport.overall.toFixed(2)} below threshold. Retrying with targeted guidance...`,
        );
      }
      try {
        const comprehensiveDirective = comprehensiveMode
          ? `\n\nCOMPREHENSIVE MODE — stricter requirements:
- Tier 7: You MUST surface at least ONE HIDDEN axiom (user/input never explicitly stated it, but the decomposition depends on it). Common hidden-axiom patterns: stable preferences, continuous demand, rational actors, available capital, the problem existing as described, the user being the decision-maker.
- Tier 3: Every edge with a causal or enabling relationship MUST have dynamics classified (not just "linear"). Use threshold/compounding/exponential/delayed/decay/step_function where applicable.
- Edge density target is elevated: aim for 2.5-3.5× entity count.
- Retries are EXPENSIVE in comprehensive mode — this is your second chance; do not waste it.`
          : "";
        const retryPrompt = `${qualityReport.retryGuidance}${comprehensiveDirective}

INPUT:
${enrichedPrompt}`;

        const retryDecomp = await llmGenerate({
          system: getDecompositionPrompt(reasoningDepth),
          user: retryPrompt,
          maxTokens: decompTokens,
          temperature: 0.3,
        });

        // Build structuring guidance from the quality report for enriched Pass 2
        const structGuidance = buildStructuringGuidance(
          qualityReport,
          dedupedEntities as Array<{ entity_id: string; name: string; importance?: string }>
        );

        const retryParsed = await structureDecompositionJSON({
          decompositionText: retryDecomp,
          reasoningDepth,
          maxTokens: structTokens,
          fallbackPrefix: spaceConfig?.prefix,
          fallbackName: spaceConfig?.name,
          fallbackDescription: spaceConfig?.description,
          extraGuidance: structGuidance,
        });

        const retryFiltered = filterLowConfidenceEdges(retryParsed.edges ?? [], 0.2, (retryParsed.entities ?? []).length);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const retryNameDeduped = deduplicateEntities(
          (retryParsed.entities ?? []) as any,
          retryFiltered as any
        );
        // Apply the same topology-equal merge pass on the retry result so the
        // quality scorer compares apples to apples.
        const retryDeduped = mergeByTopologyEqual(retryNameDeduped.entities, retryNameDeduped.edges);

        // Score the retry result
        const retryQuality = scoreDecompositionQuality(
          retryDeduped.entities as Array<{ entity_id: string; name: string; description?: string; source_tag?: string; importance?: string; manifold?: unknown }>,
          retryDeduped.edges as Array<{ source_entity_id: string; target_entity_id: string }>,
          reasoningDepth
        );

        console.log(`[decompose] Retry quality: ${retryQuality.overall.toFixed(2)} (was ${qualityReport.overall.toFixed(2)}), entities: ${retryDeduped.entities.length} (was ${dedupedEntities.length})`);

        // Use retry result if EITHER it scored higher OR the original
        // had zero entities (the retry literally can't be worse than
        // nothing). Previous bug: quality scoring is statistical (entity
        // count × density × diversity) — a 0-entity decomposition can
        // score 0.54 because the formula penalizes missing targets but
        // rewards correctness-of-emptiness, while a 25-entity decomposition
        // scores 0.41 because it's "too dense" or misses distribution
        // targets. The retry-keep logic then kept 0 entities over 25.
        // The zero-original fallback override fixes the pathological case.
        const originalHadEntities = dedupedEntities.length > 0;
        const retryHasEntities = retryDeduped.entities.length > 0;
        const shouldUseRetry =
          retryQuality.overall > qualityReport.overall ||
          (!originalHadEntities && retryHasEntities);
        if (shouldUseRetry) {
          retryImproved = true;
          qualityReport = retryQuality;
          dedupedEntities.length = 0;
          dedupedEntities.push(...(retryDeduped.entities as typeof dedupedEntities));
          dedupedEdges.length = 0;
          dedupedEdges.push(...(retryDeduped.edges as typeof dedupedEdges));
          // Also update parsed for cycles, propositions, etc.
          if (retryParsed.cycles) parsed.cycles = retryParsed.cycles;
          if (retryParsed.propositions) parsed.propositions = retryParsed.propositions;
          if (retryParsed.leverage_points) parsed.leverage_points = retryParsed.leverage_points;
          if (retryParsed.risk_points) parsed.risk_points = retryParsed.risk_points;
          if (retryParsed.master_bottleneck) parsed.master_bottleneck = retryParsed.master_bottleneck;
          if (retryParsed.novel_connections) parsed.novel_connections = retryParsed.novel_connections;
          if (retryParsed.contradictions) parsed.contradictions = retryParsed.contradictions;
          if (retryParsed.scenarios) parsed.scenarios = retryParsed.scenarios;
          if (retryParsed.action_items) parsed.action_items = retryParsed.action_items;
          if (retryParsed.metadata) parsed.metadata = retryParsed.metadata;
          console.log(`[decompose] Using retry result (quality improved)`);
        } else {
          console.log(`[decompose] Retry did not improve quality, keeping original`);
        }
      } catch (retryErr) {
        console.warn(`[decompose] Retry failed, using original:`, retryErr);
      }
    }

    // ── D9 · Glean defaults (docs/KG_DEPTH_CRITIQUE.md §3) ───────────
    //
    // Targeted single-pass cleanup of three under-filled fields the
    // initial Pass-2 prompt reliably defaults: edge.dynamics ("linear"
    // ~75% of the time), edge.conditions (null on most causal/enabling
    // edges), and entity.measurement (null on D1 entities the LLM
    // skipped). Each pass runs a cheap yes/no preflight first to
    // avoid paying for the full glean when nothing's worth changing.
    //
    // Soft-fail throughout — gleaner errors leave the original arrays
    // untouched. Mutations happen in place on dedupedEntities /
    // dedupedEdges; downstream sanitizeEntity + sanitizedEdges paths
    // pick the upgraded fields up automatically.
    //
    // Telemetry: counts logged + emitted as a stage_boundary event so
    // canvas can surface "system upgraded N edges + M measurements".
    try {
      const { gleanDefaults } = await import("@/lib/pipeline/glean-defaults");
      const gleanResult = await gleanDefaults(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dedupedEntities as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dedupedEdges as any,
      );
      const totalUpgrades =
        gleanResult.dynamics_upgraded +
        gleanResult.conditions_filled +
        gleanResult.measurement_filled +
        gleanResult.measurement_excused;
      if (totalUpgrades > 0) {
        console.log(
          `[decompose] glean: dynamics=${gleanResult.dynamics_upgraded} conditions=${gleanResult.conditions_filled} measurement=${gleanResult.measurement_filled} excused=${gleanResult.measurement_excused} (${gleanResult.llm_calls} LLM calls)`,
        );
        if (runId) {
          await emitStructuralEvent(db, runId, {
            type: "stage_boundary",
            stage: "kg",
            phase: "enter",
            message: `Gleaned defaults — ${gleanResult.dynamics_upgraded} dynamics, ${gleanResult.conditions_filled} conditions, ${gleanResult.measurement_filled} measurements (+${gleanResult.measurement_excused} excused)`,
          });
        }
      } else {
        console.log(
          `[decompose] glean: no upgrades (preflight: dyn=${gleanResult.preflight.dynamics} cond=${gleanResult.preflight.conditions} meas=${gleanResult.preflight.measurement}, ${gleanResult.llm_calls} LLM calls)`,
        );
      }
    } catch (gleanErr) {
      console.warn("[decompose] glean-defaults failed (non-fatal):", gleanErr);
    }

    // Create (or hydrate) space. When bootstrap pre-created a placeholder,
    // UPDATE it in place so the client's already-open whiteboard keeps its
    // URL + the pipeline_run row stays attached to the same space.
    const prefix = spaceConfig?.prefix ?? text.trim().split(/\s/)[0].slice(0, 2).toUpperCase().replace(/[^A-Z]/g, "C");
    const spaceName = parsed.metadata?.name ?? spaceConfig?.name ?? text.trim().slice(0, 60);
    const maturity = MATURITY_LEVELS.includes(parsed.metadata?.maturity as typeof MATURITY_LEVELS[number])
      ? parsed.metadata?.maturity
      : "actionable_now";

    let spaceId: string;
    if (existingSpaceId) {
      // Bootstrap path — refresh the placeholder's computed fields.
      const { error: updateError } = await db
        .from("spaces")
        .update({
          name: spaceName,
          description: parsed.metadata?.description ?? spaceConfig?.description ?? null,
          space_prefix: prefix,
          raw_decomposition: rawDecomposition,
          synthesis_text: parsed.metadata?.synthesis_text ?? null,
          entity_count: dedupedEntities.length,
          edge_count: dedupedEdges.length,
          orphan_count: parsed.metadata?.orphan_count ?? 0,
          cycle_count: parsed.cycles?.length ?? 0,
          maturity,
          user_role: intent?.user_role ?? null,
          primary_goal: intent?.primary_goal ?? null,
          context_type: intent?.context_type ?? null,
        })
        .eq("id", existingSpaceId)
        .eq("user_id", user.id);
      if (updateError) {
        console.error("[Decompose] Space hydrate failed:", updateError);
        return NextResponse.json({ error: "Space hydration failed" }, { status: 500 });
      }
      spaceId = existingSpaceId;
    } else {
      const { data: spaceData, error: spaceError } = await db
        .from("spaces")
        .insert({
          user_id: user.id,
          name: spaceName,
          description: parsed.metadata?.description ?? spaceConfig?.description ?? null,
          space_prefix: prefix,
          input_text: text,
          raw_decomposition: rawDecomposition,
          synthesis_text: parsed.metadata?.synthesis_text ?? null,
          entity_count: dedupedEntities.length,
          edge_count: dedupedEdges.length,
          orphan_count: parsed.metadata?.orphan_count ?? 0,
          cycle_count: parsed.cycles?.length ?? 0,
          maturity,
          user_role: intent?.user_role ?? null,
          primary_goal: intent?.primary_goal ?? null,
          context_type: intent?.context_type ?? null,
          parent_space_id: spaceConfig?.parent_space_id ?? null,
          originated_from_entity_id: spaceConfig?.originated_from_entity_id ?? null,
          depth_level: spaceConfig?.depth_level ?? 0,
        })
        .select("id")
        .single();

      if (spaceError || !spaceData) {
        console.error("[Decompose] Space creation failed:", spaceError);
        return NextResponse.json({ error: "Space creation failed" }, { status: 500 });
      }
      spaceId = spaceData.id;
    }

    // ── Structural event bus: start run + announce intake stage ──
    // When bootstrap already started the run, reuse it so the SSE stream
    // the client is watching keeps receiving events on the same run_id.
    if (existingRunId) {
      runId = existingRunId;
    } else {
      runId = await startPipelineRun(db, {
        spaceId,
        userId: user.id,
        pipeline: "decompose",
        initialPrompt: text.slice(0, 2000),
      });
    }
    await emitStructuralEvent(db, runId, {
      type: "stage_boundary",
      stage: "intake",
      phase: "enter",
      message: `Decomposing: ${spaceName.slice(0, 80)}`,
    });

    // ── Link parent entity to newly created sub-space ──
    const originEntityId = spaceConfig?.originated_from_entity_id;
    if (originEntityId) {
      await db
        .from("entities")
        .update({ has_sub_space: true, sub_space_id: spaceId })
        .eq("id", originEntityId);
    }

    // ── Insert entities (sanitized + resilient) ──
    // Heartbeat: tell the canvas we're about to start persisting entities
    // so the HUD subtitle doesn't stall on "Extracting…" for minutes.
    //
    // CRITICAL: emit intake:exit BEFORE kg:enter. Without the explicit
    // exit, the canvas-stage-indicator + run-context panel show intake
    // as "active" forever (the live timer keeps growing past 20 minutes
    // even after the run actually finishes). This was the root cause of
    // the stuck-at-Intake symptom users were reporting.
    if (runId) {
      await emitStructuralEvent(db, runId, {
        type: "stage_boundary",
        stage: "intake",
        phase: "exit",
        message: `Intake complete — ${dedupedEntities.length} entities ready to persist`,
      });
      await emitStructuralEvent(db, runId, {
        type: "stage_boundary",
        stage: "kg",
        phase: "enter",
        message: `Persisting ${dedupedEntities.length} entities…`,
      });
    }

    const entityIdMap = new Map<string, string>();
    const sanitizedEntities = dedupedEntities.map((e) => sanitizeEntity(e, spaceId));

    if (sanitizedEntities.length > 0) {
      const { data: entityData } = await resilientInsert(db, "entities", sanitizedEntities, "id, entity_id");
      // Phase 1 Step 18 — partial-insert warning. resilientInsert
      // silently drops rows that violate RLS or constraints; the
      // graph then has orphan edges the downstream filter quietly
      // skips. Emit a visible warning heartbeat when we lose >10%
      // of entities so the user isn't surprised by a sparse graph.
      if (runId && entityData.length < sanitizedEntities.length) {
        const dropped = sanitizedEntities.length - entityData.length;
        const pctDropped = Math.round((dropped / sanitizedEntities.length) * 100);
        if (pctDropped >= 10) {
          await emitStructuralEvent(db, runId, {
            type: "stage_boundary",
            stage: "kg",
            phase: "enter",
            message: `⚠ ${dropped} of ${sanitizedEntities.length} entities couldn't persist (${pctDropped}%). Graph may be sparse.`,
          });
        }
      }
      for (const row of entityData) {
        entityIdMap.set(row.entity_id, row.id);
      }

      // Emit entity_added events — one per persisted entity. Canvas
      // HUD + future ghost painter react live to these.
      const entityEvents: StructuralEvent[] = [];
      for (const e of dedupedEntities) {
        const uuid = entityIdMap.get(e.entity_id);
        if (!uuid) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyE = e as any;
        entityEvents.push({
          type: "entity_added",
          entityId: uuid,
          entityCode: e.entity_id,
          name: e.name,
          entityCategory: anyE.entity_category ?? null,
          importance: anyE.importance ?? null,
          parentEntityId: null,
        });
      }
      await emitBatchEvents(db, runId, entityEvents);

      // Sprint 2 follow-up — memory-index new entities inline so ambient
      // retrieval surfaces them immediately. Previously this relied on the
      // backfill endpoint, which meant the first ambient call after a
      // decompose missed newly-extracted concepts. Non-fatal on failure —
      // the user still gets their decomposition; the backfill endpoint is
      // the fallback.
      try {
        const { buildEntityInput, upsertMemoryItemsBatch } = await import(
          "@/lib/memory/writer"
        );
        // Hydrate inserted entities with the fields buildEntityInput wants.
        const insertedIds = Array.from(entityIdMap.values());
        if (insertedIds.length > 0) {
          const { data: fullEntities } = await db
            .from("entities")
            .select("id, space_id, name, description, importance")
            .in("id", insertedIds);
          const rows =
            (fullEntities as Array<{
              id: string;
              space_id: string;
              name: string;
              description: string | null;
              importance: string | null;
            }> | null) ?? [];
          if (rows.length > 0) {
            await upsertMemoryItemsBatch(
              db,
              rows.map((e) => buildEntityInput(user.id, e)),
            );
          }
        }
      } catch (memErr) {
        console.warn(
          "[decompose] memory index failed (non-fatal):",
          memErr,
        );
      }
    }

    // ── Persist evidence_basis as claims (non-critical) ──
    try {
      const claimInserts: Array<{
        space_id: string;
        claim_text: string;
        claim_type: string;
        status: string;
        confidence: number;
        source_entity_id: string;
        source_type: string;
        source_quote: string | null;
      }> = [];
      for (const rawEntity of dedupedEntities) {
        const entityUuid = entityIdMap.get(rawEntity.entity_id);
        if (!entityUuid) continue;
        const evidence = extractEvidenceBasis(rawEntity);
        for (const ev of evidence) {
          claimInserts.push({
            space_id: spaceId,
            claim_text: ev.claim,
            claim_type: ev.claim_type,
            status: "proposed",
            confidence: ev.confidence,
            source_entity_id: entityUuid,
            source_type: "synthesis",
            source_quote: ev.source_quote,
          });
        }
      }
      if (claimInserts.length > 0) {
        await resilientInsert(db, "claims", claimInserts, "id");

        // Update evidence_strength on entities (average claim confidence)
        const entityClaimConfidences = new Map<string, number[]>();
        for (const c of claimInserts) {
          const arr = entityClaimConfidences.get(c.source_entity_id) ?? [];
          arr.push(c.confidence);
          entityClaimConfidences.set(c.source_entity_id, arr);
        }
        for (const [entityUuid, confidences] of entityClaimConfidences) {
          const avg = confidences.reduce((a, b) => a + b, 0) / confidences.length;
          await db
            .from("entities")
            .update({ evidence_strength: Math.round(avg * 100) / 100 })
            .eq("id", entityUuid)
            .then(() => {});
        }
      }
    } catch (claimErr) {
      console.warn("[Decompose] Claim persistence failed (non-critical):", claimErr);
    }

    // ── Materialize contradictions as fault entities ──
    // Contradictions from the LLM become first-class entities with edges
    // (relationship_type=contradicts, topology=disjoint) to the entities they
    // implicate. This makes tensions navigable graph structure instead of
    // buried JSON on the space. Non-critical: failures here are logged and
    // we proceed with the rest of the pipeline.
    const faultEdges: Array<{
      source_entity_id: string;
      target_entity_id: string;
      relationship_type: string;
      dimension: string;
      source_tag: string;
      strength: number;
      polarity: string;
      confidence: number;
      conditions: string;
      topology: string;
    }> = [];
    let faultCount = 0;
    try {
      const existingEntityIdSet = new Set(entityIdMap.keys());
      const contradictions = Array.isArray(parsed.contradictions) ? parsed.contradictions : [];
      const faultEntitiesToInsert: ReturnType<typeof sanitizeEntity>[] = [];

      for (let i = 0; i < contradictions.length; i++) {
        const materialized = materializeFault(contradictions[i], i, existingEntityIdSet);
        if (!materialized) continue;
        faultEntitiesToInsert.push(sanitizeEntity(materialized.entity, spaceId));
        faultEdges.push(...materialized.edges);
      }

      if (faultEntitiesToInsert.length > 0) {
        const { data: faultRows } = await resilientInsert(
          db,
          "entities",
          faultEntitiesToInsert,
          "id, entity_id"
        );
        for (const row of faultRows) {
          entityIdMap.set(row.entity_id, row.id);
        }
        faultCount = faultRows.length;
        console.log(`[decompose] Materialized ${faultCount} fault entities with ${faultEdges.length} contradicts edges`);
      }
    } catch (faultErr) {
      console.warn("[Decompose] Fault materialization failed (non-critical):", faultErr);
    }

    // ── Insert edges (sanitized, skip invalid refs) ──
    // Fault edges are concatenated here so they go through the same sanitize
    // path (which validates entity references + derives topology fallback).
    const sanitizedEdges = [...dedupedEdges, ...faultEdges]
      .map((e) => sanitizeEdge(e, spaceId, entityIdMap))
      .filter((e): e is NonNullable<typeof e> => e !== null);

    let edgesInserted = 0;
    if (sanitizedEdges.length > 0) {
      const { inserted } = await resilientInsert(db, "edges", sanitizedEdges, "id");
      edgesInserted = inserted;

      // Emit edge_added events for each sanitized edge (no per-edge
      // UUID from resilientInsert; we use the edge data we just wrote).
      const edgeEvents: StructuralEvent[] = sanitizedEdges.map((e, i) => ({
        type: "edge_added",
        edgeId: `batch-${Date.now()}-${i}`,
        sourceEntityId: e.source_entity_id,
        targetEntityId: e.target_entity_id,
        relationshipType: e.relationship_type,
        dimension: e.dimension,
        polarity: e.polarity ?? null,
        confidence: e.confidence ?? 0.7,
      }));
      await emitBatchEvents(db, runId, edgeEvents);
    }

    // ── Compute degree-based centrality_rank ──
    // The tier classifier's highest-weight signal (0.28) is centrality_rank.
    // Without it every entity defaults to the 0.5 midpoint, which caps the
    // achievable tier across the whole graph. Degree-based ranking is a
    // cheap, deterministic baseline — PageRank/betweenness can be layered
    // on later if needed.
    const entityUuids = Array.from(entityIdMap.values());
    if (entityUuids.length > 0) {
      const centralityInputEntities = entityUuids.map((id) => ({ id }));
      const centralityEdges = sanitizedEdges.map((e) => ({
        source_entity_id: e.source_entity_id,
        target_entity_id: e.target_entity_id,
      }));
      const rankings = computeDegreeCentrality(centralityInputEntities, centralityEdges);
      await Promise.all(
        rankings.map((r) =>
          db.from("entities").update({ centrality_rank: r.rank }).eq("id", r.id)
        )
      );
      console.log(`[decompose] Centrality assigned to ${rankings.length} entities (top degree: ${rankings[0]?.degree ?? 0})`);
    }

    // ── Cascade detection (multi-hop reasoning) ──
    // First non-trivial reasoning-layer write. Traces causal/functional paths
    // downstream from leverage points, risk points, the master bottleneck, and
    // fundamental-importance entities. Persists to reasoning_results so UIs
    // can answer "if you move X, what else moves" without an LLM call.
    //
    // Non-critical: cascade failure doesn't fail the decompose.
    try {
      const leverageIds = new Set(
        (parsed.leverage_points ?? [])
          .map((lp) => typeof lp === "object" && lp !== null ? (lp as { entity_id?: string }).entity_id : null)
          .filter((id): id is string => Boolean(id))
      );
      const riskIds = new Set(
        (parsed.risk_points ?? [])
          .map((rp) => typeof rp === "object" && rp !== null ? (rp as { entity_id?: string }).entity_id : null)
          .filter((id): id is string => Boolean(id))
      );
      const bottleneckId = typeof parsed.master_bottleneck === "object" && parsed.master_bottleneck !== null
        ? (parsed.master_bottleneck as { entity_id?: string }).entity_id
        : undefined;

      const cascadeEntities = sanitizedEntities
        .map((e) => {
          const uuid = entityIdMap.get(e.entity_id);
          if (!uuid) return null;
          return {
            id: uuid,
            entity_id: e.entity_id,
            name: e.name,
            // Combine entity-level flags with structuring-metadata flags — the LLM
            // sometimes emits these in the leverage_points array but forgets to
            // set is_leverage_point on the entity itself.
            is_leverage_point: e.is_leverage_point || leverageIds.has(e.entity_id),
            is_risk_point: e.is_risk_point || riskIds.has(e.entity_id),
            is_master_bottleneck: e.is_master_bottleneck || e.entity_id === bottleneckId,
            importance: e.importance ?? null,
            blast_radius: e.blast_radius ?? null,
          };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);

      const cascadeEdges = sanitizedEdges.map((e) => ({
        source_entity_id: e.source_entity_id,
        target_entity_id: e.target_entity_id,
        dimension: e.dimension,
        strength: e.strength,
        confidence: e.confidence,
        polarity: e.polarity,
      }));

      const cascadeReport = computeCascades(cascadeEntities, cascadeEdges);

      if (cascadeReport.paths.length > 0) {
        await db.from("reasoning_results").insert({
          space_id: spaceId,
          reasoning_type: "cascade",
          input_params: {
            source: "decompose_auto",
            seed_strategy: "leverage_risk_bottleneck_fundamental",
            max_depth: 4,
          },
          result_data: cascadeReport,
          result_text: `Auto-cascade from ${cascadeReport.seeds_analyzed} seeds: ${cascadeReport.total_affected_entities} entities affected across ${cascadeReport.paths.length} paths (${cascadeReport.systemic_pressure_points.length} systemic pressure points)`,
        });
        console.log(`[decompose] Cascade: ${cascadeReport.seeds_analyzed} seeds → ${cascadeReport.paths.length} paths, ${cascadeReport.total_affected_entities} affected entities, ${cascadeReport.systemic_pressure_points.length} pressure points`);
      } else {
        console.log(`[decompose] Cascade: no seeds had downstream reach (seeds=${cascadeReport.seeds_analyzed})`);
      }
    } catch (cascadeErr) {
      console.warn("[decompose] Cascade detection failed (non-critical):", cascadeErr);
    }

    // ── Insert cycles (sanitized) ──
    const sanitizedCycles = (parsed.cycles ?? [])
      .map((c) => sanitizeCycle(c, spaceId, entityIdMap))
      .filter((c): c is NonNullable<typeof c> => c !== null);

    let cyclesInserted = 0;
    if (sanitizedCycles.length > 0) {
      const { inserted } = await resilientInsert(db, "cycles", sanitizedCycles, "id");
      cyclesInserted = inserted;

      // Emit cycle_detected events — classification drives the canvas
      // ring color (reinforcing_positive / balancing / etc.).
      const cycleEvents: StructuralEvent[] = sanitizedCycles.map((c, i) => ({
        type: "cycle_detected",
        cycleId: c.cycle_id ?? `cycle-${i}`,
        classification: c.classification ?? "balancing",
        entityIds: Array.isArray(c.entity_ids) ? c.entity_ids : [],
      }));
      await emitBatchEvents(db, runId, cycleEvents);
    }

    // ── Batch 7 · canonical node signatures ──
    //
    // Now that entities, edges, and cycles are all persisted + emitted,
    // walk each entity and materialize its canonical signature from
    // the already-persisted KG context. Signatures drive the layered-
    // ring visual in the three-panel UI. Soft-fail: a failure here
    // does not abort the stage — worst case is entities render as
    // bare dots without rings until a re-materialize pass lands.
    try {
      const { materialized, emitted } = await materializeAndEmitSignatures({
        db,
        runId,
        spaceId,
        sanitizedEntities,
        entityIdMap,
        sanitizedEdges,
      });
      if (materialized > 0) {
        console.log(
          `[decompose] Materialized ${materialized} node signatures (${emitted} ring events emitted).`,
        );
      }
    } catch (sigErr) {
      console.warn("[decompose] signature materialization failed (non-fatal):", sigErr);
    }

    // ── Insert propositions (non-critical) ──
    const propositions = (parsed.propositions ?? []).filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (p: any) => p.statement && typeof p.statement === "string"
    );
    if (propositions.length > 0) {
      const validPropTypes = ["certain", "probable", "possible", "speculative", "irreducible"];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const propRows = propositions.map((p: any) => ({
        space_id: spaceId,
        proposition_id: (typeof p.proposition_id === "string" && p.proposition_id)
          ? p.proposition_id
          : `P${Math.random().toString(36).slice(2, 6)}`,
        statement: p.statement,
        proposition_type: validPropTypes.includes(p.proposition_type) ? p.proposition_type : "probable",
        confidence: typeof p.confidence === "number" ? Math.max(0, Math.min(1, p.confidence)) : 0.7,
        depends_on: Array.isArray(p.depends_on) ? p.depends_on : null,
        entity_ids: Array.isArray(p.entity_ids) ? p.entity_ids : null,
      }));
      await resilientInsert(db, "propositions", propRows, "id").catch((err) => {
        console.warn("[decompose] proposition persist failed (non-fatal):", err);
      });
    }

    // ── Store rich structuring metadata on space ──
    // Leverage points, risk points, open questions, etc. go into synthesis_data
    // so the synthesis step can use them even if it runs later
    const structuringMeta: Record<string, unknown> = {};
    if (parsed.leverage_points?.length) structuringMeta.leverage_points = parsed.leverage_points;
    if (parsed.risk_points?.length) structuringMeta.risk_points = parsed.risk_points;
    if (parsed.master_bottleneck) structuringMeta.master_bottleneck = parsed.master_bottleneck;
    if (parsed.open_questions?.length) structuringMeta.open_questions = parsed.open_questions;
    if (parsed.novel_connections?.length) structuringMeta.novel_connections = parsed.novel_connections;
    if (parsed.contradictions?.length) structuringMeta.contradictions = parsed.contradictions;
    if (parsed.scenarios?.length) structuringMeta.scenarios = parsed.scenarios;
    if (parsed.action_items?.length) structuringMeta.action_items = parsed.action_items;
    if (parsed.shared_variables?.length) structuringMeta.shared_variables = parsed.shared_variables;

    // Tier 3 cycle enrichment — orphan compounding edges flagged as candidate cycles
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidateCycles = (parsed as any).candidate_cycles as Array<{ edge: { source: string; target: string; dynamics: string }; reason: string }> | undefined;
    if (candidateCycles && candidateCycles.length > 0) {
      structuringMeta.candidate_cycles = candidateCycles;
    }

    // Tier 7: parse load-bearing axioms from raw decomposition text
    const axioms = parseAxioms(rawDecomposition);
    if (axioms.length > 0) {
      structuringMeta.axioms = axioms;
      console.log(`[decompose] Parsed ${axioms.length} axioms (scopes: ${axioms.map(a => a.scope).join(", ")}; hidden: ${axioms.filter(a => a.visibility === "HIDDEN").length})`);
    }

    // Store epistemic classification for downstream phases (synthesis, objectives, strategy)
    if (epistemicClassification) {
      structuringMeta.epistemic_classification = epistemicClassification;
      if (epistemicClassification.preliminary_objectives?.length) {
        structuringMeta.preliminary_objectives = epistemicClassification.preliminary_objectives;
      }
    }

    // Store decomposition quality metadata for downstream phases
    structuringMeta.decomposition_quality = {
      overall: qualityReport.overall,
      metrics: qualityReport.metrics,
      deficiencies: qualityReport.deficiencies,
      retry_used: didRetry,
      retry_improved: retryImproved,
      scored_at: new Date().toISOString(),
    };

    // ── Audit trail: append a completed decompose run ──
    // Store fingerprint so /synthesize's lazy guard can recognize when the decomp
    // hasn't changed.
    const decomposeFingerprint = computeDecompFingerprint(
      dedupedEntities as Array<{ entity_id: string; name: string; importance?: string }>,
      dedupedEdges as Array<{ source_entity_id: string; target_entity_id: string; relationship_type?: string }>,
    );
    const decomposeRun: AnalysisRun = {
      run_id: makeRunId(),
      pipeline: "decompose",
      started_at: decomposeStartedAt,
      completed_at: new Date().toISOString(),
      status: "completed",
      depth: reasoningDepth,
      stages_run: [
        "pass1_decomposition",
        "tier3_annotation_extraction",
        "pass2_structuring",
        "cycle_verification",
        "quality_scoring",
        ...(didRetry ? ["retry"] : []),
        ...(axioms.length > 0 ? ["axiom_parsing"] : []),
      ],
      stages_skipped: [],
      cache_hits: [],
      fingerprint: decomposeFingerprint,
      quality_score: Math.round(qualityReport.overall * 100),
      note: retryImproved ? "Quality-driven retry improved score" : (didRetry ? "Retry used but no improvement" : undefined),
    };
    // Merge with any existing analysis_runs to preserve cross-pipeline history
    const { data: priorSpace } = await db.from("spaces")
      .select("synthesis_data").eq("id", spaceId).single();
    const priorSpaceData = (priorSpace?.synthesis_data as Record<string, unknown>) ?? {};
    const priorRuns = (priorSpaceData.analysis_runs as AnalysisRun[] | undefined) ?? [];
    structuringMeta.analysis_runs = appendRun(priorRuns, decomposeRun);
    structuringMeta.decomp_fingerprint = decomposeFingerprint;

    // Update space counts with actual inserted counts
    await db.from("spaces").update({
      entity_count: entityIdMap.size,
      edge_count: edgesInserted,
      cycle_count: cyclesInserted,
      ...(Object.keys(structuringMeta).length > 0 ? { synthesis_data: structuringMeta } : {}),
    }).eq("id", spaceId);

    // ──────────────────────────────────────────────────────────────────
    // Wave A — ground the decomposed KG in detected objectives.
    //
    // If the epistemic classification detected preliminary_objectives,
    // materialize them as improvement_goals rows (status='proposed',
    // source='auto_detected'), then run an LLM tagger to populate
    // entity_objectives so downstream surfaces (Lab, Apps, Synthesis)
    // can ground reasoning in what the user wants to achieve.
    //
    // Non-fatal: any failure in this block logs + continues. Decompose
    // still succeeds end-to-end.
    // ──────────────────────────────────────────────────────────────────
    const prelimObjectives = Array.isArray(
      structuringMeta.preliminary_objectives,
    )
      ? (structuringMeta.preliminary_objectives as Array<{
          title: string;
          objective_type: string;
          rationale: string;
          confidence: "high" | "moderate" | "low";
          input_type_basis: string;
        }>)
      : [];

    if (prelimObjectives.length > 0 && entityIdMap.size > 0) {
      try {
        const { groundObjectives } = await import(
          "@/lib/pipeline/ground-objectives"
        );
        // Re-fetch inserted entities so the tagger has the sanitized
        // DB-side fields (name/description/category/importance) rather
        // than depending on decompose's in-flight structure.
        const insertedEntityIds = Array.from(entityIdMap.values());
        const { data: entityRows } = (await db
          .from("entities")
          .select("id, name, description, entity_category, importance")
          .in("id", insertedEntityIds)) as {
          data: Array<{
            id: string;
            name: string;
            description: string | null;
            entity_category: string | null;
            importance: string | null;
          }> | null;
        };
        const groundingRes = await groundObjectives({
          db,
          spaceId,
          userId: user.id,
          preliminaryObjectives: prelimObjectives,
          entities: entityRows ?? [],
        });
        console.log(
          `[decompose/wave-a] goals=${groundingRes.goals_created} links=${groundingRes.links_created} memory=${groundingRes.memory_indexed}${groundingRes.errors.length ? ` errors=${groundingRes.errors.join("|")}` : ""}`,
        );
      } catch (groundErr) {
        console.warn(
          "[decompose/wave-a] ground-objectives failed (non-fatal):",
          groundErr,
        );
      }
    }

    // ──────────────────────────────────────────────────────────────────
    // Wave B — propagate "KG changed" to apps. Any app whose
    // dominant_entity_ids overlaps the newly-inserted entities (direct)
    // or whose served-goal's entities overlap (via Wave A junction) gets
    // flagged stale_reason='kg_changed'. Non-fatal.
    // ──────────────────────────────────────────────────────────────────
    if (entityIdMap.size > 0) {
      try {
        const { notifyEntitiesChanged } = await import("@/lib/apps/notify");
        const insertedEntityIds = Array.from(entityIdMap.values());
        const flagged = await notifyEntitiesChanged(
          db,
          spaceId,
          insertedEntityIds,
          "pipeline:decompose",
        );
        if (flagged.direct + flagged.via_objectives > 0) {
          console.log(
            `[decompose/wave-b] flagged apps: direct=${flagged.direct} via_objectives=${flagged.via_objectives}`,
          );
        }
      } catch (notifyErr) {
        console.warn(
          "[decompose/wave-b] app staleness notify failed (non-fatal):",
          notifyErr,
        );
      }
    }

    // Log changelog (non-critical)
    await db.from("space_changelog").insert({
      space_id: spaceId,
      version: 1,
      change_type: "initial_analysis",
      summary: `Analysis: ${entityIdMap.size} entities, ${edgesInserted} edges, ${cyclesInserted} cycles${faultCount > 0 ? `, ${faultCount} faults` : ""} (quality: ${qualityReport.overall.toFixed(2)})`,
      details: {
        entity_count: entityIdMap.size,
        edge_count: edgesInserted,
        cycle_count: cyclesInserted,
        fault_count: faultCount,
        quality_score: qualityReport.overall,
      },
    }).then(() => {}, () => {});

    // ── Auto-expansion for standard + deep tiers ──
    // Automatically expand top critical/fundamental entities to reveal internal structure.
    // Standard tier: top 2 entities. Deep tier: top 3 entities.
    let autoExpandCount = 0;
    let materializedEntityCount = 0;
    let materializedEdgeCount = 0;
    if (reasoningDepth === "standard" || reasoningDepth === "deep") {
      const AUTO_EXPAND_COUNT = reasoningDepth === "deep" ? 3 : 2;
      try {
        // Select top entities to auto-expand
        // Priority 1: fundamental/critical entities (highest quality expansion targets)
        // Priority 2: entities with highest edge count (most connected = most complex)
        // This ensures expansion even when the LLM doesn't mark entities fundamental/critical
        const importanceRank: Record<string, number> = { fundamental: 4, critical: 3, important: 2, moderate: 1 };
        const expandCandidates = dedupedEntities
          .filter((e) => e.importance !== "minor")
          .sort((a, b) => {
            // Sort by importance tier first
            const impA = importanceRank[(a.importance ?? "moderate") as string] ?? 1;
            const impB = importanceRank[(b.importance ?? "moderate") as string] ?? 1;
            if (impB !== impA) return impB - impA;
            // Then by blast_radius desc
            const brA = (a as Record<string, unknown>).blast_radius as number ?? 0;
            const brB = (b as Record<string, unknown>).blast_radius as number ?? 0;
            if (brB !== brA) return brB - brA;
            // Then by centrality_rank asc
            const crA = (a as Record<string, unknown>).centrality_rank as number ?? 99;
            const crB = (b as Record<string, unknown>).centrality_rank as number ?? 99;
            return crA - crB;
          })
          .slice(0, AUTO_EXPAND_COUNT);

        if (expandCandidates.length > 0) {
          console.log(`[decompose] Auto-expanding ${expandCandidates.length} entities: ${expandCandidates.map((e) => e.name).join(", ")}`);

          const { buildExpansionPrompt } = await import("@/lib/prompts/expansion");

          // Run expansions in parallel
          const expansionResults = await Promise.allSettled(
            expandCandidates.map(async (entity) => {
              // Find this entity's UUID from the entityIdMap
              const entityUuid = entityIdMap.get(entity.entity_id);
              if (!entityUuid) return null;

              // Fetch edges for this entity
              const { data: entityEdges } = await db
                .from("edges")
                .select("*")
                .eq("space_id", spaceId)
                .or(`source_entity_id.eq.${entityUuid},target_entity_id.eq.${entityUuid}`)
                .limit(30);

              // Build connected entity names map
              const connIds = new Set<string>();
              for (const edge of (entityEdges ?? [])) {
                if (edge.source_entity_id !== entityUuid) connIds.add(edge.source_entity_id);
                if (edge.target_entity_id !== entityUuid) connIds.add(edge.target_entity_id);
              }
              const { data: connEnts } = await db
                .from("entities")
                .select("id, name")
                .in("id", Array.from(connIds));
              const connNames = new Map<string, string>();
              for (const e of (connEnts ?? [])) connNames.set(e.id, e.name);

              // Build and execute expansion
              const { systemPrompt, userPrompt } = buildExpansionPrompt({
                entity: { ...entity, id: entityUuid } as import("@/types").Entity,
                connectedEdges: (entityEdges ?? []) as import("@/types").Edge[],
                connectedEntityNames: connNames,
                spaceName: spaceName,
                spaceDescription: parsed.metadata?.description ?? "",
                userInputText: text,
                depthLevel: 1,
              });

              const result = await llmJSON({
                system: systemPrompt,
                user: userPrompt,
                model: "gpt-4o-mini",
                temperature: 0.4,
              });

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const llmResult = result as any;
              const subComponents = (llmResult.sub_components ?? []).slice(0, 7);
              if (subComponents.length < 2) return null;

              // Store expansion
              await db.from("expansions").delete().eq("entity_id", entityUuid);
              const { data: expansion } = await db
                .from("expansions")
                .insert({
                  space_id: spaceId,
                  entity_id: entityUuid,
                  depth_level: 1,
                  summary: llmResult.summary ?? `Internal structure of ${entity.name}`,
                  sub_components: subComponents,
                  internal_pathways: (llmResult.internal_pathways ?? []).slice(0, 15),
                  internal_dynamics: (llmResult.internal_dynamics ?? []).slice(0, 5),
                  llm_model: "gpt-4o-mini",
                  token_cost: 0,
                })
                .select()
                .single();

              if (expansion) {
                await db.from("entities").update({ is_expanded: true, expansion_id: expansion.id }).eq("id", entityUuid);
                return entity.name;
              }
              return null;
            })
          );

          autoExpandCount = expansionResults.filter(
            (r) => r.status === "fulfilled" && r.value !== null
          ).length;
          console.log(`[decompose] Auto-expanded ${autoExpandCount}/${expandCandidates.length} entities`);

          // ── Materialize expansions into actual graph entities + edges ──
          // This is the critical step that converts expansion JSONB into real graph topology.
          // Without this, sub-components stay hidden in a side table and the graph is flat.
          if (autoExpandCount > 0) {
            try {
              const { computeExpansionMaterializations, buildExpansionEntityRecords, buildExpansionEdgeRecords } =
                await import("@/lib/pipeline/expansion-materializer");

              // Fetch the just-created expansions
              const { data: expansionRows } = await db
                .from("expansions")
                .select("*")
                .eq("space_id", spaceId);

              // Fetch parent entities (the ones that were expanded)
              const expandedUuids = expandCandidates
                .map((e) => entityIdMap.get(e.entity_id))
                .filter((id): id is string => !!id);
              const { data: parentEntityRows } = await db
                .from("entities")
                .select("*")
                .in("id", expandedUuids);

              // Fetch ALL existing entities and edges in this space (for dedup + inherited edges)
              const [{ data: allExistingEntities }, { data: allExistingEdges }] = await Promise.all([
                db.from("entities").select("*").eq("space_id", spaceId),
                db.from("edges").select("*").eq("space_id", spaceId),
              ]);

              if (expansionRows?.length && parentEntityRows?.length) {
                const matResult = computeExpansionMaterializations(
                  expansionRows as import("@/lib/pipeline/expansion-materializer").ExpansionRow[],
                  parentEntityRows as import("@/types").Entity[],
                  (allExistingEntities ?? []) as import("@/types").Entity[],
                  (allExistingEdges ?? []) as import("@/types").Edge[],
                );

                console.log(`[decompose] Materialization: ${matResult.stats.entities_produced} entities, ${matResult.stats.pathway_edges_produced} pathways, ${matResult.stats.dynamic_edges_produced} dynamics, ${matResult.stats.component_edges_produced} has_component, ${matResult.stats.inherited_edges_produced} inherited edges`);

                // Insert materialized entities
                if (matResult.entities.length > 0) {
                  const entityRecords = buildExpansionEntityRecords(spaceId, matResult.entities);
                  const { data: insertedEntityData } = await resilientInsert(db, "entities", entityRecords, "id, entity_id");
                  materializedEntityCount = insertedEntityData.length;

                  // Build UUID map for edge insertion
                  const matEntityIdToUuid = new Map<string, string>();
                  for (const row of insertedEntityData) {
                    if (row.entity_id && row.id) {
                      matEntityIdToUuid.set(row.entity_id, row.id);
                    }
                  }
                  // Include ALL existing entities in the UUID map (needed for has_component
                  // edges and inherited_connection edges that reference neighbor entities)
                  for (const [eid, uuid] of entityIdMap.entries()) {
                    matEntityIdToUuid.set(eid, uuid);
                  }
                  for (const ent of (allExistingEntities ?? [])) {
                    const e = ent as import("@/types").Entity;
                    if (e.entity_id && e.id) matEntityIdToUuid.set(e.entity_id, e.id);
                  }

                  // Insert all materialized edges (has_component + internal pathways + dynamics)
                  const allMatEdges = [...matResult.parent_component_edges, ...matResult.edges];
                  if (allMatEdges.length > 0) {
                    const edgeRecords = buildExpansionEdgeRecords(spaceId, allMatEdges, matEntityIdToUuid);
                    if (edgeRecords.length > 0) {
                      const { inserted } = await resilientInsert(db, "edges", edgeRecords, "id");
                      materializedEdgeCount = inserted;
                      edgesInserted += inserted;
                    }
                  }

                  // Update entity count on space
                  await db.from("spaces").update({
                    entity_count: entityIdMap.size + materializedEntityCount,
                    edge_count: edgesInserted,
                  }).eq("id", spaceId);

                  // Mark expansions as materialized
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const expansionIds = expansionRows.map((r: any) => r.id);
                  await db.from("expansions")
                    .update({ materialized_at: new Date().toISOString() })
                    .in("id", expansionIds);
                }

                console.log(`[decompose] Materialized: ${materializedEntityCount} entities, ${materializedEdgeCount} edges inserted into graph`);
              }
            } catch (matErr) {
              console.warn("[decompose] Expansion materialization failed (non-critical):", matErr);
            }
          }
        }
      } catch (expandErr) {
        console.warn("[decompose] Auto-expansion failed (non-critical):", expandErr);
      }
    }

    // ── Structural event bus: close the stage ──
    // Emit stage_boundary exit always, but DEFER `completePipelineRun`
    // when we're about to auto-advance to the next stage on the same
    // run. Otherwise the client's SSE would see `completed` status
    // mid-chain and tear down the stream before research/synthesize
    // events arrive. Chain-terminal stage (strategy-refresh) is the
    // one that finally closes the run.
    await emitStructuralEvent(db, runId, {
      type: "stage_boundary",
      stage: "kg",
      phase: "exit",
    });
    const isChainHop = autoAdvance && existingRunId;
    if (!isChainHop) {
      await completePipelineRun(db, runId, "completed");
    }

    // Phase 1 Step 13/16 — auto-advance to research via short-abort
    // handoff. Cookies forwarded so research's safeAuth re-
    // authenticates; existingRunId forwarded so events land on the
    // same SSE subscription. AbortError is expected — we hang up the
    // client side of the fetch once research's Lambda has the
    // request, so this Lambda can terminate without holding for
    // research's 60-120s work. DO NOT mark the shared run failed on
    // abort; research is still running on its own Lambda.
    if (autoAdvance) {
      const cookieHeader = request.headers.get("cookie") ?? "";
      const origin = new URL(request.url).origin;
      const chainedText = text;
      const chainedSpaceId = spaceId;
      const chainedRunId = runId;

      // Phase 52 — "KG continuously builds in real time": auto-trigger
      // recursive-decompose on the top fundamental/critical entities
      // AFTER Pass 2 inserts land but BEFORE research completes. Each
      // call adds 2-3 proxy-indicator ghost children below its parent
      // so the canvas keeps developing while research runs in parallel.
      // Fire-and-forget: failures are non-fatal (we want the main
      // pipeline to continue regardless).
      const importanceRankRD: Record<string, number> = {
        fundamental: 4,
        critical: 3,
        important: 2,
        moderate: 1,
      };
      const recursiveCandidates = (
        dedupedEntities as Array<{ entity_id: string; importance?: string }>
      )
        .filter((e) => {
          const imp = e.importance ?? "moderate";
          return imp === "fundamental" || imp === "critical";
        })
        .sort(
          (a, b) =>
            (importanceRankRD[(b.importance ?? "moderate") as string] ?? 0) -
            (importanceRankRD[(a.importance ?? "moderate") as string] ?? 0),
        )
        .slice(0, 3)
        .map((e) => entityIdMap.get(e.entity_id))
        .filter((id): id is string => typeof id === "string");

      if (recursiveCandidates.length > 0) {
        after(async () => {
          await Promise.allSettled(
            recursiveCandidates.map((entityId) =>
              fetch(`${origin}/api/canvas/recursive-decompose`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Cookie: cookieHeader,
                },
                body: JSON.stringify({
                  spaceId: chainedSpaceId,
                  entityId,
                  existingRunId: chainedRunId,
                }),
              }),
            ),
          );
        });
      }

      after(async () => {
        const ctrl = new AbortController();
        const handoffTimeout = setTimeout(() => ctrl.abort(), 10000);
        try {
          await fetch(`${origin}/api/pipeline/research`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: cookieHeader,
            },
            body: JSON.stringify({
              spaceIds: [chainedSpaceId],
              inputSummary: chainedText.slice(0, 2000),
              researchDepth: "standard",
              triggeredBy: "auto_advance",
              autoAdvance: true,
              existingRunId: chainedRunId,
              reservationId,
            }),
            signal: ctrl.signal,
          });
          clearTimeout(handoffTimeout);
        } catch (advanceErr) {
          clearTimeout(handoffTimeout);
          const name = (advanceErr as { name?: string })?.name;
          if (name === "AbortError") return;
          console.warn("[decompose] research handoff threw:", advanceErr);
          await completePipelineRun(
            db,
            chainedRunId,
            "failed",
            `handoff failed: ${advanceErr instanceof Error ? advanceErr.message : String(advanceErr)}`,
          ).catch(() => {});
        }
      });
    }

    // ── D8 · Community detection + bottom-up summaries ───────────────
    //
    // Runs unconditionally in `after()` so EVERY decompose (auto-
    // advance or direct user trigger) gets the operational layering
    // substrate (docs/KG_DEPTH_CRITIQUE.md §9 D8).
    //
    // Async by design — clustering + summaries take 15-30s for typical
    // spaces (one LLM call per detected community), and we don't want
    // to hold the response. Soft-fail throughout: a detection or
    // summarize failure logs but doesn't break anything else.
    after(async () => {
      try {
        const { runCommunityDetectionAndSummarize } = await import(
          "@/lib/pipeline/community-tail"
        );
        await runCommunityDetectionAndSummarize({
          db,
          spaceId,
          runId,
        });
      } catch (commErr) {
        console.warn(
          "[decompose] community detection/summarize failed (non-fatal):",
          commErr,
        );
      }
    });

    // ── D4 · Multi-way interaction discovery ─────────────────────────
    //
    // Activates the dormant `reactions` table (see §5 of the critique).
    // Runs ANOVA-decomposition over candidate triples to find emergent
    // 3-way interactions where joint(A,B,C) ≠ linear sum of marginals.
    // See docs/KG_DEPTH_CRITIQUE.md §9 D4 + src/lib/pipeline/interaction-discovery.ts.
    //
    // Independent of D8 (community detection); both can run in parallel
    // — they read from the same persisted entities/edges but neither
    // depends on the other. Cost-bounded by MAX_TRIPLES=12 × 7 MC calls
    // each at 300 iterations × 6 timesteps. Soft-fail throughout.
    after(async () => {
      try {
        const { runInteractionDiscovery } = await import(
          "@/lib/pipeline/interaction-discovery-tail"
        );
        await runInteractionDiscovery({ db, spaceId, runId });
      } catch (intErr) {
        console.warn(
          "[decompose] interaction discovery failed (non-fatal):",
          intErr,
        );
      }
    });

    return NextResponse.json({
      spaceId,
      runId,
      entityCount: entityIdMap.size + materializedEntityCount,
      edgeCount: edgesInserted,
      cycleCount: cyclesInserted,
      faultCount,
      qualityScore: qualityReport.overall,
      qualityDeficiencies: qualityReport.deficiencies.length,
      retryUsed: didRetry,
      autoExpansions: autoExpandCount,
      materializedEntities: materializedEntityCount,
      materializedEdges: materializedEdgeCount,
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    console.error("[Decompose] Error:", raw);
    // Mark the run as failed so SSE consumers get a terminal `done`.
    // Soft-fail: never let the failure-handler itself throw — but log
    // it so we don't silently leave a client stuck waiting.
    await completePipelineRun(db, runId, "failed", raw).catch((completeErr) => {
      console.error("[decompose] completePipelineRun(failed) itself threw — client may hang:", completeErr);
    });
    // Refund the pre-flight reservation — decompose didn't complete,
    // so the user doesn't pay. Log failures: a stuck reservation
    // charges a user for work that never happened.
    if (reservationId) {
      const { cancelReservation } = await import("@/lib/credits");
      await cancelReservation(db, reservationId).catch((refundErr) => {
        console.error(
          `[decompose] credit refund failed for reservation ${reservationId} — user may be charged for failed run:`,
          refundErr,
        );
      });
    }
    return NextResponse.json({ error: `Decomposition failed: ${sanitizeErrorMessage(err)}` }, { status: 500 });
  }
}
