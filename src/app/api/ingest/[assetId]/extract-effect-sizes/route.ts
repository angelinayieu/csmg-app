// POST /api/ingest/[assetId]/extract-effect-sizes
//
// Run the effect-size extraction primitive against an attached
// research artifact. Persists each extraction as an evidence_registries
// row (status='extracted', un-reviewed) and returns the persisted rows
// so the drawer can render them immediately.
//
// Body (optional): { goalContext?: string }
//   goalContext narrows the LLM's attention to findings relevant to
//   the user's research question. When the artifact is a multi-
//   endpoint paper this materially reduces noise.
//
// Auth: user must own the asset's space (verifySpaceOwnership).
//
// Soft-fail discipline: per-extraction insert failures are logged
// and surfaced via the inserted_count vs extraction_count delta in
// the response, never aborting the batch.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { extractEffectSizes } from "@/lib/extraction/extract-effect-sizes";
import type {
  EffectSizeExtraction,
  EvidenceRegistryRow,
} from "@/types/evidence-registry";
import type { AssetClass } from "@/types/asset";

export const maxDuration = 120;
export const runtime = "nodejs";

interface AssetRow {
  id: string;
  user_id: string;
  space_id: string | null;
  source_name: string;
  asset_class: AssetClass | null;
  normalized_text: string | null;
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

  // ── Body ─────────────────────────────────────────────────────────
  const { data: body } = await safeJsonParse<{ goalContext?: string }>(request);
  const goalContext =
    body && typeof body.goalContext === "string"
      ? body.goalContext.slice(0, 4000)
      : null;

  // ── Load the asset ──────────────────────────────────────────────
  const { data: asset, error: assetErr } = (await db
    .from("ingested_files")
    .select("id, user_id, space_id, source_name, asset_class, normalized_text")
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
      { error: "Asset is not attached to a space; attach it before extracting evidence." },
      { status: 400 },
    );
  }
  const owns = await verifySpaceOwnership(supabase, asset.space_id, user.id);
  if (!owns) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const content = asset.normalized_text ?? "";
  if (content.trim().length < 200) {
    return NextResponse.json(
      {
        error:
          "Asset content too short for evidence extraction (need ≥200 chars).",
      },
      { status: 400 },
    );
  }

  // ── Run primitive ────────────────────────────────────────────────
  let result;
  try {
    result = await extractEffectSizes({
      assetId,
      sourceName: asset.source_name,
      artifactClass: asset.asset_class ?? null,
      artifactText: content,
      goalContext,
    });
  } catch (err) {
    console.error("[extract-effect-sizes] primitive failed:", err);
    return NextResponse.json(
      { error: `Extraction failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }

  // ── Persist each extraction ─────────────────────────────────────
  // We insert one-at-a-time so a single bad row doesn't kill the
  // batch. For 10-30 extractions this is fine; if it grows we can
  // chunk into bulk inserts.
  const inserted: EvidenceRegistryRow[] = [];
  const insertErrors: Array<{ local_id: string; error: string }> = [];

  for (const ext of result.extractions) {
    const row = toInsertRow({
      extraction: ext,
      spaceId: asset.space_id,
      ingestedFileId: asset.id,
      userId: user.id,
    });
    const { data: insRow, error: insErr } = await db
      .from("evidence_registries")
      .insert(row)
      .select("*")
      .single();
    if (insErr || !insRow) {
      console.warn(
        `[extract-effect-sizes] insert failed for ${ext.local_id}:`,
        insErr,
      );
      insertErrors.push({
        local_id: ext.local_id,
        error: insErr?.message ?? "unknown insert error",
      });
      continue;
    }
    inserted.push(insRow as EvidenceRegistryRow);
  }

  // Auto-attach pass — resolve `outcome_label` against existing
  // entities in the space and set `attached_entity_id` for high-
  // confidence matches. Runs BEFORE the pool recompute so the
  // pooling step sees freshly-attached rows in the same call.
  // Mutates the in-memory `inserted` array's flags so the response
  // reflects the auto-attach decision without a re-fetch.
  let auto_attach_summary = null;
  if (inserted.length > 0) {
    try {
      const { autoAttachEvidence } = await import(
        "@/lib/evidence/auto-attach"
      );
      auto_attach_summary = await autoAttachEvidence(
        db,
        asset.space_id,
        inserted,
      );
    } catch (err) {
      console.warn(
        "[extract-effect-sizes] auto-attach soft-failed:",
        err,
      );
    }
  }

  // Phase 6A — auto-recompute edge strengths now that new evidence
  // has landed (and possibly been auto-attached). Soft-fail discipline:
  // pooling errors must never propagate to the user (they got the
  // evidence rows; pooling is a downstream rigor pass). The recompute
  // is bounded (one query per edge in the space) so we run it inline;
  // future scale would move it to a background job.
  let edge_repool_summary = null;
  if (inserted.length > 0) {
    try {
      const { recomputeEdgeStrengthsForSpace } = await import(
        "@/lib/evidence/recompute-edge-strengths"
      );
      edge_repool_summary = await recomputeEdgeStrengthsForSpace(
        db,
        asset.space_id,
      );
    } catch (err) {
      console.warn(
        "[extract-effect-sizes] edge-strength repool soft-failed:",
        err,
      );
    }
  }

  return NextResponse.json({
    asset_id: assetId,
    summary: result.summary,
    extraction_count: result.extractions.length,
    inserted_count: inserted.length,
    insert_errors: insertErrors,
    rows: inserted,
    generated_at: result.generated_at,
    auto_attach_summary,
    edge_repool_summary,
  });
}

// ── Mapping helpers ────────────────────────────────────────────────

interface InsertRowOpts {
  extraction: EffectSizeExtraction;
  spaceId: string;
  ingestedFileId: string;
  userId: string;
}

function toInsertRow(opts: InsertRowOpts) {
  const { extraction: e, spaceId, ingestedFileId, userId } = opts;
  return {
    space_id: spaceId,
    ingested_file_id: ingestedFileId,
    user_id: userId,
    status: "extracted",
    outcome_label: e.outcome_label,
    instrument_label: e.instrument_label,
    intervention_label: e.intervention_label,
    comparator_label: e.comparator_label,
    population_label: e.population_label,
    effect_size: e.effect_size,
    effect_metric: e.effect_metric,
    ci_lower: e.ci_lower,
    ci_upper: e.ci_upper,
    ci_level: e.ci_level,
    p_value: e.p_value,
    standard_error: e.standard_error,
    n_treatment: e.n_treatment,
    n_control: e.n_control,
    followup_weeks: e.followup_weeks,
    followup_label: e.followup_label,
    study_design: e.study_design,
    blinding: e.blinding,
    source_page: e.source.page,
    source_bbox: e.source.bbox,
    source_quote: e.source.quote,
    source_table_html: e.source.table_html,
    llm_label_provenance: e.llm_label_provenance,
    parser_provenance: e.parser_provenance,
    extraction_confidence: e.extraction_confidence,
    flags: e.flags,
  };
}
