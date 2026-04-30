// POST /api/ingest/[assetId]/extract-temporal
//
// Run the temporal-extraction primitive against an attached research
// artifact. Persists each extraction as an evidence_registries row
// (status='extracted', un-reviewed) and returns the persisted rows so
// the drawer can render them immediately.
//
// Mirrors /api/ingest/[assetId]/extract-effect-sizes — same auth
// pattern, same soft-fail discipline, same auto-attach pass. Differs
// only in which primitive is called and which columns are populated
// (temporal half vs effect-size half of evidence_registries).
//
// Body (optional): { goalContext?: string }
//   goalContext narrows the LLM's attention to findings relevant to
//   the user's research question.
//
// Auth: user must own the asset's space (verifySpaceOwnership).

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { extractTemporal } from "@/lib/extraction/extract-temporal";
import type {
  EvidenceRegistryRow,
  TemporalExtraction,
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
    .maybeSingle()) as {
    data: AssetRow | null;
    error: { message?: string } | null;
  };

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
          "Asset is not attached to a space; attach it before extracting evidence.",
      },
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
          "Asset content too short for temporal extraction (need ≥200 chars).",
      },
      { status: 400 },
    );
  }

  // ── Run primitive ────────────────────────────────────────────────
  let result;
  try {
    result = await extractTemporal({
      assetId,
      sourceName: asset.source_name,
      artifactClass: asset.asset_class ?? null,
      artifactText: content,
      goalContext,
    });
  } catch (err) {
    console.error("[extract-temporal] primitive failed:", err);
    return NextResponse.json(
      { error: `Extraction failed: ${sanitizeErrorMessage(err)}` },
      { status: 500 },
    );
  }

  // ── Persist each extraction ─────────────────────────────────────
  // Insert one-at-a-time for soft-fail discipline. A single bad row
  // does not kill the batch — failures are surfaced via insert_errors.
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
        `[extract-temporal] insert failed for ${ext.local_id}:`,
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

  // Auto-attach pass — temporal rows route to the same entities the
  // effect-size auto-attach uses. Same import, same heuristic
  // (resolves outcome_label against existing entities). Phase 3 will
  // run a temporal-aware aggregator after attach to update edge
  // timing fields; for now attach is sufficient.
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
      console.warn("[extract-temporal] auto-attach soft-failed:", err);
    }
  }

  // Phase 3 — temporal pool repool. Mirror of the effect-size route's
  // recomputeEdgeStrengthsForSpace call: after a batch of temporal
  // claims lands and auto-attach routes them to entities, repool the
  // edges in this space so onset/peak/persistence on the edges
  // reflect the new evidence. Soft-fail discipline: pooling errors
  // do not propagate to the user (they got the rows; pooling is a
  // downstream rigor pass). Bounded (one query per edge) so we run
  // inline; future scale would move to a background job.
  let edge_temporal_repool_summary = null;
  if (inserted.length > 0) {
    try {
      const { recomputeEdgeTemporalsForSpace } = await import(
        "@/lib/evidence/recompute-edge-temporals"
      );
      edge_temporal_repool_summary = await recomputeEdgeTemporalsForSpace(
        db,
        asset.space_id,
      );
    } catch (err) {
      console.warn(
        "[extract-temporal] edge-temporal repool soft-failed:",
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
    edge_temporal_repool_summary,
  });
}

// ── Mapping helpers ────────────────────────────────────────────────

interface InsertRowOpts {
  extraction: TemporalExtraction;
  spaceId: string;
  ingestedFileId: string;
  userId: string;
}

/** Map a TemporalExtraction → an evidence_registries insert payload.
 *  Populates ONLY the temporal half of the row; effect-size columns
 *  remain null (a row can carry effect-size data, temporal data, or
 *  both — this primitive writes the temporal half). */
function toInsertRow(opts: InsertRowOpts) {
  const { extraction: e, spaceId, ingestedFileId, userId } = opts;
  return {
    space_id: spaceId,
    ingested_file_id: ingestedFileId,
    user_id: userId,
    status: "extracted",

    // Identity labels — same vocabulary as effect-size, so auto-attach
    // can route a temporal row to the same entity an effect-size row
    // would attach to.
    outcome_label: e.outcome_label,
    instrument_label: e.instrument_label,
    intervention_label: e.intervention_label,
    comparator_label: e.comparator_label,
    population_label: e.population_label,
    study_design: e.study_design,

    // Source location of the timing claim — populates the existing
    // source_* columns. The temporal_evidence_quote column duplicates
    // source_quote for self-contained queries against rows that mix
    // effect-size + temporal data; for temporal-only rows they're
    // identical.
    source_page: e.source.page,
    source_quote: e.source.quote,

    // Temporal half — new columns from migration 20260621.
    onset_days: e.onset_days,
    onset_days_ci_lower: e.onset_days_ci_lower,
    onset_days_ci_upper: e.onset_days_ci_upper,
    peak_days: e.peak_days,
    peak_days_ci_lower: e.peak_days_ci_lower,
    peak_days_ci_upper: e.peak_days_ci_upper,
    persistence_days: e.persistence_days,
    persistence_days_ci_lower: e.persistence_days_ci_lower,
    persistence_days_ci_upper: e.persistence_days_ci_upper,
    decay_kinetics: e.decay_kinetics,
    time_points: e.time_points,
    temporal_evidence_quote: e.temporal_evidence_quote,
    temporal_extraction_method: e.temporal_extraction_method,
    temporal_flags: e.flags,
    temporal_llm_provenance: e.llm_provenance,
    temporal_parser_provenance: e.parser_provenance,
    temporal_extraction_confidence: e.extraction_confidence,
  };
}
