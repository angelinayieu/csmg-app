// POST /api/ingest/[assetId]/extract
//
// HITL extraction-checklist flow phase 2 (input-side gap from
// docs/KG_DEPTH_CRITIQUE.md). Takes the user's selected_candidate_ids
// (from the cached extraction_preview on this asset) plus an optional
// focus_level, filters the cached preview, and commits the chosen
// subset as live KG entities via the existing
// persistPreExtractedEntities() path.
//
// Body: { selected_candidate_ids: string[], focus_level?: FocusLevel }
//
// Selection precedence (mirrors commitSelectedCandidates):
//   1. Non-empty selected_candidate_ids → use exactly those
//   2. Empty + focus_level set → auto-select top-N suggested
//   3. Both empty → all suggested candidates (auto-extract behavior)
//
// Response: ExtractionCommitResult (asset_id, entity_ids,
//   skipped_count, committed_at)
//
// Auth: asset owner.
// Side effects: writes to entities + updates ingested_files.{
//   extraction_status, extraction_target_count, preextracted_entity_ids
// }.

import { NextResponse, type NextRequest } from "next/server";
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

export const maxDuration = 30;
export const runtime = "nodejs";

interface AssetRow {
  id: string;
  user_id: string;
  space_id: string | null;
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
    .select("id, user_id, space_id, extraction_status, extraction_preview")
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

  const response: ExtractionCommitResult = {
    asset_id: assetId,
    entity_ids: result.insertedIds,
    skipped_count: result.skippedCount,
    committed_at: committedAt,
  };
  return NextResponse.json(response);
}
