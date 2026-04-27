// POST /api/ingest/[assetId]/preview
//
// HITL extraction-checklist flow phase 1 (input-side gap from
// docs/KG_DEPTH_CRITIQUE.md). Generates 15-30 candidate entities for
// review WITHOUT writing to the entities table. Caches the result on
// `ingested_files.extraction_preview` so re-opening the drawer doesn't
// re-pay the LLM cost.
//
// Body (optional): { force?: boolean }
//   force = true forces a fresh LLM call even if a cached preview
//   exists. Default behavior returns the cache when available — the
//   user just wants to see the candidates again, not regenerate them.
//
// Response: { preview: ExtractionPreview, cached: boolean }
//
// Auth: user must own the asset's space (verifySpaceOwnership).
// Idempotent: can be called repeatedly without side effects beyond
// writing extraction_preview JSONB.

import { NextResponse, type NextRequest } from "next/server";
import {
  safeAuth,
  verifySpaceOwnership,
  safeJsonParse,
  sanitizeErrorMessage,
} from "@/lib/api-helpers";
import { previewCandidatesFromAsset } from "@/lib/pipeline/asset-preextractor";
import type { ExtractionPreview } from "@/types/extraction-preview";
import type { AssetClass } from "@/types/asset";

export const maxDuration = 60;
export const runtime = "nodejs";

interface AssetRow {
  id: string;
  user_id: string;
  space_id: string | null;
  source_name: string;
  asset_class: AssetClass | null;
  normalized_text: string | null;
  extraction_status: string | null;
  extraction_preview: ExtractionPreview | null;
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

  // ── Body (force flag) ────────────────────────────────────────────
  const { data: body } = await safeJsonParse(request);
  const force =
    typeof body === "object" &&
    body !== null &&
    (body as { force?: unknown }).force === true;

  // ── Load the asset ──────────────────────────────────────────────
  const { data: asset, error: assetErr } = (await db
    .from("ingested_files")
    .select(
      "id, user_id, space_id, source_name, asset_class, normalized_text, extraction_status, extraction_preview",
    )
    .eq("id", assetId)
    .maybeSingle()) as { data: AssetRow | null; error: { message?: string } | null };

  if (assetErr || !asset) {
    return NextResponse.json(
      { error: "Asset not found" },
      { status: 404 },
    );
  }

  // Owner check via the asset's user_id (assets without a space_id
  // can still be reviewed — they're just not yet attached to a space).
  if (asset.user_id !== user.id) {
    return NextResponse.json(
      { error: "Not authorized to preview this asset" },
      { status: 403 },
    );
  }
  // If attached to a space, double-check space ownership.
  if (asset.space_id) {
    const owns = await verifySpaceOwnership(supabase, asset.space_id, user.id);
    if (!owns) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
  }

  // ── Cache hit short-circuit ──────────────────────────────────────
  if (
    !force &&
    asset.extraction_preview &&
    typeof asset.extraction_preview === "object" &&
    Array.isArray(
      (asset.extraction_preview as ExtractionPreview).candidates,
    )
  ) {
    return NextResponse.json({
      preview: asset.extraction_preview,
      cached: true,
    });
  }

  // ── Run the preview ──────────────────────────────────────────────
  const content = asset.normalized_text ?? "";
  if (content.trim().length < 80) {
    // Too short for meaningful extraction. Persist an empty preview
    // so the UI shows "no candidates available" without re-trying
    // the LLM on every drawer open.
    const emptyPreview: ExtractionPreview = {
      asset_id: assetId,
      candidates: [],
      category_counts: {},
      suggested_count: 0,
      total_count: 0,
      generated_at: new Date().toISOString(),
      summary: null,
    };
    await db
      .from("ingested_files")
      .update({
        extraction_status: "previewed",
        extraction_preview: emptyPreview,
      })
      .eq("id", assetId);
    return NextResponse.json({ preview: emptyPreview, cached: false });
  }

  let preview: ExtractionPreview;
  try {
    preview = await previewCandidatesFromAsset({
      assetId,
      sourceName: asset.source_name,
      assetClass: (asset.asset_class ?? "pasted_text") as AssetClass,
      contentSnippet: content,
    });
  } catch (err) {
    console.error("[ingest/preview] preview generation failed:", err);
    return NextResponse.json(
      {
        error: `Preview generation failed: ${sanitizeErrorMessage(err)}`,
      },
      { status: 500 },
    );
  }

  // ── Persist cache + flip status ──────────────────────────────────
  const { error: updErr } = await db
    .from("ingested_files")
    .update({
      extraction_status: "previewed",
      extraction_preview: preview,
    })
    .eq("id", assetId);
  if (updErr) {
    // Non-fatal — preview is already in-memory and returned. Log so
    // we know the cache is missing for this run.
    console.warn(
      "[ingest/preview] failed to persist cache (non-fatal):",
      updErr,
    );
  }

  return NextResponse.json({ preview, cached: false });
}
