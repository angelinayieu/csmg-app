// POST /api/ingest/[assetId]/extract
//
// HITL extraction-checklist flow phase 2 (input-side gap from
// docs/KG_DEPTH_CRITIQUE.md). Takes the user's selected_candidate_ids
// (from the cached extraction_preview on this asset) plus an optional
// focus_level, filters the cached preview, and commits the chosen
// subset as live KG entities via the existing
// persistPreExtractedEntities() path.
//
// Body: {
//   selected_candidate_ids: string[],
//   focus_level?: FocusLevel,
//   full_decompose?: boolean,             // Phase 2a (2026-07-04) — when true (default
//                                         //   for research_pdf/internal_doc), after the
//                                         //   HITL commit succeeds chain into
//                                         //   /api/pipeline/decompose against the
//                                         //   paper's normalized_text so the paper
//                                         //   contributes the same multi-pass depth
//                                         //   (cycles, bridges, structural edges,
//                                         //   framework overlays) as a prompt.
//   auto_extract_quantitative?: boolean   // Initiative 2 (2026-05-05) — when true (default
//                                         //   for research_pdf/internal_doc), fire-and-
//                                         //   forget chain into /extract-effect-sizes +
//                                         //   /extract-temporal so the paper lands with
//                                         //   numerical and time-anchored evidence rows
//                                         //   without an extra user click. Skip with
//                                         //   `false` to save tokens on speculative
//                                         //   uploads where the user just wants entities.
// }
//
// Selection precedence (mirrors commitSelectedCandidates):
//   1. Non-empty selected_candidate_ids → use exactly those
//   2. Empty + focus_level set → auto-select top-N suggested
//   3. Both empty → all suggested candidates (auto-extract behavior)
//
// Response: ExtractionCommitResult (asset_id, entity_ids,
//   skipped_count, committed_at) + optional decompose_run_id when
//   the chain fires.
//
// Auth: asset owner.
// Side effects: writes to entities + updates ingested_files.{
//   extraction_status, extraction_target_count, preextracted_entity_ids
// }. When full_decompose=true: triggers /api/pipeline/decompose +
// invalidateCoverageForNewEntities + notifyEntitiesChanged + fire-and-
// forget prospect-connections (Phase 3 auto-integration).

import { NextResponse, type NextRequest, after } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { commitSelectedCandidates } from "@/lib/pipeline/asset-preextractor";
import {
  isFocusLevel,
  FOCUS_LEVEL_TARGETS,
  type ExtractionCommitResult,
  type ExtractionPreview,
  type FocusLevel,
} from "@/types/extraction-preview";
import { invalidateCoverageForNewEntities } from "@/lib/kg/invalidate-coverage";

export const maxDuration = 30;
export const runtime = "nodejs";

interface AssetRow {
  id: string;
  user_id: string;
  space_id: string | null;
  extraction_status: string | null;
  extraction_preview: ExtractionPreview | null;
  asset_class: string | null;
  normalized_text: string | null;
  parse_status: string | null;
}

/**
 * Per-asset-class default for whether full_decompose chains in.
 * Research PDFs + internal docs benefit from the multi-pass depth;
 * pasted_text + spec_sheet + image are typically one-shot context
 * that doesn't need the full pipeline.
 */
function defaultFullDecompose(assetClass: string | null): boolean {
  return assetClass === "research_pdf" || assetClass === "internal_doc";
}

/**
 * Best-effort goalContext derivation for the extract-effect-sizes /
 * extract-temporal auto-fire. Reads the active strategy's target
 * objective when present so the LLM focuses on findings relevant to
 * the user's research question instead of blanket-extracting every
 * effect mentioned in the paper.
 *
 * Handles both wrapper shapes (StrategicRecommendationData with
 * .recommendation, or the inner StrategicRecommendation directly).
 * Returns undefined when nothing useful is found — callers should
 * pass an empty body in that case rather than fabricate context.
 */
function deriveGoalContext(
  synthesisData: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!synthesisData || typeof synthesisData !== "object") return undefined;
  const rec = synthesisData.strategic_recommendation as
    | Record<string, unknown>
    | undefined;
  if (!rec) return undefined;
  const inner = (rec.recommendation ?? rec) as
    | Record<string, unknown>
    | undefined;
  if (!inner) return undefined;
  const target = inner.target_objective as Record<string, unknown> | undefined;
  if (target && typeof target.title === "string" && target.title.trim()) {
    const metric =
      typeof target.metric === "string" ? target.metric.trim() : null;
    return metric
      ? `${target.title.trim()} (metric: ${metric})`
      : target.title.trim();
  }
  // Fall back to the headline if no target_objective present.
  if (typeof inner.headline === "string" && inner.headline.trim()) {
    return inner.headline.trim();
  }
  return undefined;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await params;
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // ── Body parsing ─────────────────────────────────────────────────
  const { data: body } = await safeJsonParse(request);
  const bodyObj =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  const selectedRaw = bodyObj.selected_candidate_ids;
  const selectedCandidateIds: string[] = Array.isArray(selectedRaw)
    ? (selectedRaw as unknown[])
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .slice(0, 100) // sane cap
    : [];

  const focusLevel: FocusLevel | undefined = isFocusLevel(bodyObj.focus_level)
    ? bodyObj.focus_level
    : undefined;

  // ── Load asset + preview ─────────────────────────────────────────
  const { data: asset, error: assetErr } = (await db
    .from("ingested_files")
    .select(
      "id, user_id, space_id, extraction_status, extraction_preview, asset_class, normalized_text, parse_status",
    )
    .eq("id", assetId)
    .maybeSingle()) as { data: AssetRow | null; error: { message?: string } | null };

  if (assetErr || !asset) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
  if (asset.user_id !== user.id) {
    return NextResponse.json(
      { error: "Not authorized to extract from this asset" },
      { status: 403 },
    );
  }
  if (!asset.space_id) {
    return NextResponse.json(
      {
        error:
          "Asset is not attached to a space — extraction requires space context",
      },
      { status: 400 },
    );
  }
  const owns = await verifySpaceOwnership(supabase, asset.space_id, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const preview = asset.extraction_preview;
  if (
    !preview ||
    typeof preview !== "object" ||
    !Array.isArray((preview as ExtractionPreview).candidates) ||
    (preview as ExtractionPreview).candidates.length === 0
  ) {
    return NextResponse.json(
      {
        error:
          "No preview cached for this asset. POST /preview first to generate candidates.",
      },
      { status: 409 },
    );
  }

  // ── Idempotency: already extracted? ──────────────────────────────
  if (asset.extraction_status === "extracted") {
    return NextResponse.json(
      {
        error: "Asset already extracted — call /preview with force=true to re-run",
        extraction_status: asset.extraction_status,
      },
      { status: 409 },
    );
  }

  // ── Flip to 'extracting' to lock against concurrent commits ─────
  await db
    .from("ingested_files")
    .update({ extraction_status: "extracting" })
    .eq("id", assetId);

  let result: { insertedIds: string[]; skippedCount: number };
  try {
    result = await commitSelectedCandidates(db, {
      spaceId: asset.space_id,
      userId: user.id,
      assetId,
      preview: preview as ExtractionPreview,
      selectedCandidateIds,
      focusLevel,
    });
  } catch (err) {
    // Roll status back so the user can retry.
    await db
      .from("ingested_files")
      .update({ extraction_status: "previewed" })
      .eq("id", assetId);
    console.error("[ingest/extract] commit failed:", err);
    return NextResponse.json(
      { error: `Extraction failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }

  // ── Persist final state ──────────────────────────────────────────
  const targetCount =
    selectedCandidateIds.length > 0
      ? selectedCandidateIds.length
      : focusLevel
        ? FOCUS_LEVEL_TARGETS[focusLevel]
        : null;

  const committedAt = new Date().toISOString();
  await db
    .from("ingested_files")
    .update({
      extraction_status: "extracted",
      extraction_target_count: targetCount,
    })
    .eq("id", assetId);

  // ── Phase 2a — chain into /api/pipeline/decompose ─────────────────
  //
  // Research PDFs + internal docs default to full_decompose=true so the
  // paper contributes the same multi-pass depth as a prompt: cycles,
  // bridges, structural edges, framework overlays (Pearl's ladder fires
  // for research_paper classification, etc.). Other classes default to
  // false; the HITL commit alone is enough.
  //
  // Caller can override via body.full_decompose. Skip the chain when the
  // paper has no normalized_text yet (parse_status not 'ready') —
  // shouldn't happen since /preview wouldn't have generated candidates,
  // but defensive.
  const fullDecomposeReq =
    typeof bodyObj.full_decompose === "boolean"
      ? bodyObj.full_decompose
      : defaultFullDecompose(asset.asset_class);
  const hasParsedText =
    asset.parse_status === "ready" &&
    typeof asset.normalized_text === "string" &&
    asset.normalized_text.trim().length > 50;

  // ── Phase 2a — schedule the decompose chain (background) ──────────
  //
  // Decompose can take 30-180s for a deep multi-pass extraction. Awaiting
  // it inline blew through extract's 30s maxDuration (HTTP 504 at the
  // gateway). Worse, the user-facing extract() promise rejected before
  // the HITL refresh could run, so the candidate entities never painted.
  // Move the chain to after() so the route response carries the HITL
  // commit results immediately; the chain runs in the background and
  // its events stream to the same SSE channel the canvas already
  // listens on (when existingRunId is provided).
  //
  // The client doesn't get back a decompose runId on this path — it's
  // not known synchronously. The client mitigates by polling
  // refreshSpaceEntities for ~3 minutes after extract returns, catching
  // chain entities/edges as they land.
  const willChain = fullDecomposeReq && hasParsedText;
  const decomposeError: string | null = null;
  if (willChain) {
    after(async () => {
      try {
        const origin = new URL(request.url).origin;
        const cookieHeader = request.headers.get("cookie") ?? "";
        const decompRes = await fetch(`${origin}/api/pipeline/decompose`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: cookieHeader },
          body: JSON.stringify({
            text: asset.normalized_text,
            existingSpaceId: asset.space_id,
            // Tells the Phase 8 epistemic router to apply Pearl's ladder
            // + epistemic_status overlays. We know it's a paper because
            // asset_class said so — don't make the classifier guess.
            epistemicClassification:
              asset.asset_class === "research_pdf" ? "research_paper" : null,
            // Deep so all 6 tiers + framework overlays fire. The paper is
            // the source of truth; we want the multi-pass extraction.
            reasoningDepth: "deep",
            // Soft signal that this came from a paper — appears in run
            // metadata + entity provenance via decompose's normal path.
            intent: {
              paper_asset_id: assetId,
              chained_from: "ingest_extract",
            },
          }),
        });
        if (!decompRes.ok) {
          const errBody = (await decompRes.json().catch(() => ({}))) as {
            error?: string;
          };
          console.warn(
            `[ingest/extract] background decompose chain failed (non-fatal): ${errBody.error ?? decompRes.status}`,
          );
        }
      } catch (err) {
        console.warn(
          "[ingest/extract] background decompose chain threw (non-fatal):",
          err,
        );
      }
    });
  }

  // ── Initiative 2 — auto-fire quantitative extractions ─────────────
  //
  // For research PDFs and internal docs, automatically run the effect-
  // size and temporal extractors after the HITL commit lands. Both
  // routes already exist and persist evidence_registries rows; until
  // now they required separate user clicks. Triggering them here means
  // a paper upload yields entities + edges + numerical evidence + time
  // anchors in a single user-perceived flow.
  //
  // Skip when:
  //   - body.auto_extract_quantitative === false   (explicit opt-out)
  //   - asset_class isn't research_pdf / internal_doc (low-signal classes)
  //   - parse_status not 'ready' (no normalized text to extract from)
  const autoExtractQuantitative =
    typeof bodyObj.auto_extract_quantitative === "boolean"
      ? bodyObj.auto_extract_quantitative
      : defaultFullDecompose(asset.asset_class);

  // ── Phase 3 — auto-integration ─────────────────────────────────────
  //
  // Even when the decompose chain doesn't fire, the HITL commit added
  // entities + edges to the KG. Treat them like card-level decompose
  // (the existing pattern we shipped): flag pairwise neighbors as
  // revisit_required, notify dependent apps, and fire a prospect run
  // in the background to surface cross-canvas links.
  //
  // All steps are after()-scheduled so the user-facing response returns
  // immediately. Any failure here is logged and ignored.
  const newEntityIds = result.insertedIds;
  if (newEntityIds.length > 0 && asset.space_id) {
    after(async () => {
      const spaceId = asset.space_id!;

      // Single read of synthesis_data — reused by the stale-flag write
      // below AND by the auto-extraction goalContext derivation. The
      // strategic_recommendation.target_objective tells the extractors
      // which findings the user actually cares about, sharpening the
      // LLM's attention vs. blanket extraction.
      let synth: Record<string, unknown> = {};
      let goalContext: string | undefined;
      try {
        const { data: spaceRow } = (await db
          .from("spaces")
          .select("synthesis_data")
          .eq("id", spaceId)
          .maybeSingle()) as {
          data: { synthesis_data: Record<string, unknown> | null } | null;
        };
        synth = (spaceRow?.synthesis_data ?? {}) as Record<string, unknown>;
        goalContext = deriveGoalContext(synth);
      } catch (err) {
        console.warn(
          "[ingest/extract] synthesis_data read failed (non-fatal):",
          err,
        );
      }

      // Coverage invalidation: prior pairwise checks involving the new
      // entities' 1-hop neighbors are stale.
      try {
        const inv = await invalidateCoverageForNewEntities(db, {
          spaceId,
          newEntityIds,
          reason: "neighbor_added",
        });
        if (inv.flagged > 0) {
          console.log(
            `[ingest/extract] invalidated ${inv.flagged} pair checks for ${inv.neighborCount} neighbors`,
          );
        }
      } catch (err) {
        console.warn(
          "[ingest/extract] coverage invalidation failed (non-fatal):",
          err,
        );
      }

      // App staleness: dependent app entities that touch the new ones.
      // Cascade-aware — extends reach through downstream causal edges so
      // 2-N hop dependents are also flagged.
      try {
        const { notifyEntitiesChangedWithCascade } = await import(
          "@/lib/apps/notify"
        );
        const flagged = await notifyEntitiesChangedWithCascade(
          db,
          spaceId,
          newEntityIds,
          `paper:${assetId}`,
        );
        if (flagged.direct + flagged.via_objectives > 0) {
          console.log(
            `[ingest/extract] flagged apps: direct=${flagged.direct} via_objectives=${flagged.via_objectives} (cascade extended set by ${flagged.cascade_extended})`,
          );
        }
      } catch (err) {
        console.warn(
          "[ingest/extract] app-staleness notify failed (non-fatal):",
          err,
        );
      }

      // Synthesis stale-flag: surface "papers landed since last
      // synthesis · refresh" in the rail. Reuses the synth blob we read
      // above so we don't issue two reads.
      try {
        await db
          .from("spaces")
          .update({
            synthesis_data: {
              ...synth,
              last_paper_landed_at: committedAt,
              last_paper_asset_id: assetId,
            },
          })
          .eq("id", spaceId);
      } catch (err) {
        console.warn(
          "[ingest/extract] synthesis stale-flag failed (non-fatal):",
          err,
        );
      }

      // Auto-fire effect-sizes + temporal extractions when requested
      // and the asset class warrants it. Both calls are independent —
      // effect-sizes auto-attaches to entities by name (so it benefits
      // from the just-completed decompose chain), temporal stands
      // alone. We fire them in parallel since neither blocks the other.
      const shouldAutoExtract =
        autoExtractQuantitative &&
        defaultFullDecompose(asset.asset_class) &&
        asset.parse_status === "ready" &&
        typeof asset.normalized_text === "string" &&
        asset.normalized_text.trim().length > 50;

      if (shouldAutoExtract) {
        const origin = new URL(request.url).origin;
        const cookieHeader = request.headers.get("cookie") ?? "";
        const extractBody = JSON.stringify(
          goalContext ? { goalContext } : {},
        );
        await Promise.allSettled([
          fetch(`${origin}/api/ingest/${assetId}/extract-effect-sizes`, {
            method: "POST",
            headers: { "content-type": "application/json", cookie: cookieHeader },
            body: extractBody,
          })
            .then(async (res) => {
              if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                console.warn(
                  `[ingest/extract] auto effect-sizes HTTP ${res.status}:`,
                  err,
                );
              }
            })
            .catch((err) => {
              console.warn(
                "[ingest/extract] auto effect-sizes threw (non-fatal):",
                err,
              );
            }),
          fetch(`${origin}/api/ingest/${assetId}/extract-temporal`, {
            method: "POST",
            headers: { "content-type": "application/json", cookie: cookieHeader },
            body: extractBody,
          })
            .then(async (res) => {
              if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                console.warn(
                  `[ingest/extract] auto temporal HTTP ${res.status}:`,
                  err,
                );
              }
            })
            .catch((err) => {
              console.warn(
                "[ingest/extract] auto temporal threw (non-fatal):",
                err,
              );
            }),
        ]);
      }

      // Prospect-connections: fire-and-forget so cross-canvas links are
      // surfaced in the rail's Live zone. Same pattern we use for
      // card-level decompose; the route picks up revisit_required pairs
      // first. Runs last so the new evidence rows are already in place
      // when the prospector decides which pairs to examine.
      try {
        const origin = new URL(request.url).origin;
        const cookieHeader = request.headers.get("cookie") ?? "";
        await fetch(`${origin}/api/pipeline/prospect-connections`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: cookieHeader },
          body: JSON.stringify({
            spaceId,
            entitiesToExamine: 5,
            pairsPerRun: 8,
          }),
        });
      } catch (err) {
        console.warn(
          "[ingest/extract] prospect-connections failed (non-fatal):",
          err,
        );
      }
    });
  }

  const response: ExtractionCommitResult = {
    asset_id: assetId,
    entity_ids: result.insertedIds,
    skipped_count: result.skippedCount,
    committed_at: committedAt,
    // Chain runs in after() — runId isn't known synchronously. The
    // client polls refreshSpaceEntities for ~3 min to catch results.
    // null here signals "queued, no runId yet" rather than "didn't fire."
    decompose_run_id: null,
    decompose_error: decomposeError,
    full_decompose_requested: willChain,
    auto_quantitative_queued:
      autoExtractQuantitative &&
      defaultFullDecompose(asset.asset_class) &&
      asset.parse_status === "ready" &&
      typeof asset.normalized_text === "string" &&
      asset.normalized_text.trim().length > 50 &&
      newEntityIds.length > 0,
  };
  return NextResponse.json(response);
}
