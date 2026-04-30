// ── GET /api/entities/[id]/sources ──
//
// P3 · cross-paper attribution resolver. Mirrors
// /api/edges/[id]/sources. Reads entity.literature_sources (text[] of
// asset ids) and returns the matching ingested_files rows so the
// entity-detail drawer can render "supported by N papers" with names
// + links.
//
// Soft-fail: empty array if the column is empty or any id can't
// resolve. RLS already restricts to user-owned assets.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const runtime = "nodejs";
export const maxDuration = 10;

interface PaperMetadata {
  title: string | null;
  authors: string[];
  year: number | null;
  doi: string | null;
}

interface PaperRef {
  asset_id: string;
  source_name: string | null;
  source_url: string | null;
  asset_class: string | null;
  /** P6 · structured paper metadata extracted at preview time. */
  paper_metadata: PaperMetadata | null;
}

/** Extract paper_metadata from an ingested_files.extraction_preview
 *  JSONB blob. Defensive against malformed/missing data. */
function extractPaperMetadata(preview: unknown): PaperMetadata | null {
  if (!preview || typeof preview !== "object") return null;
  const p = (preview as Record<string, unknown>).paper_metadata;
  if (!p || typeof p !== "object") return null;
  const m = p as Record<string, unknown>;
  const title = typeof m.title === "string" ? m.title : null;
  const authors = Array.isArray(m.authors)
    ? m.authors.filter((a): a is string => typeof a === "string")
    : [];
  const year =
    typeof m.year === "number" && Number.isFinite(m.year) ? m.year : null;
  const doi = typeof m.doi === "string" ? m.doi : null;
  if (!title && authors.length === 0 && year === null && !doi) return null;
  return { title, authors, year, doi };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "entity id required" }, { status: 400 });
  }

  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: entity, error: entityError } = await db
    .from("entities")
    .select("id, space_id, literature_sources")
    .eq("id", id)
    .maybeSingle();

  if (entityError) {
    console.error("[entities/sources] fetch failed:", entityError);
    return NextResponse.json(
      { error: "Entity lookup failed" },
      { status: 500 },
    );
  }
  if (!entity) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }

  const { data: spaceRow } = await db
    .from("spaces")
    .select("user_id")
    .eq("id", entity.space_id)
    .maybeSingle();
  if (!spaceRow || spaceRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const assetIds = Array.isArray(entity.literature_sources)
    ? (entity.literature_sources as unknown[]).filter(
        (x): x is string => typeof x === "string" && x.length > 0,
      )
    : [];

  if (assetIds.length === 0) {
    return NextResponse.json({ papers: [] satisfies PaperRef[] });
  }

  const { data: rows, error: filesErr } = await db
    .from("ingested_files")
    .select("id, source_name, source_url, asset_class, extraction_preview")
    .in("id", assetIds);

  if (filesErr) {
    console.warn("[entities/sources] ingested_files fetch failed:", filesErr);
    return NextResponse.json({ papers: [] satisfies PaperRef[] });
  }

  const papers: PaperRef[] = (
    (rows ?? []) as Array<{
      id: string;
      source_name: string | null;
      source_url: string | null;
      asset_class: string | null;
      extraction_preview: unknown;
    }>
  ).map((r) => ({
    asset_id: r.id,
    source_name: r.source_name,
    source_url: r.source_url,
    asset_class: r.asset_class,
    paper_metadata: extractPaperMetadata(r.extraction_preview),
  }));

  return NextResponse.json({ papers });
}
