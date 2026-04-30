// ── GET /api/spaces/[id]/asset-metadata ──
//
// P6 · returns per-asset { source_name, paper_metadata } for every
// ingested file in the space. Powers AssetCardShape's title display
// and the ResearchLibraryChip's per-paper rows.
//
// Single fetch + RLS-bound, so cheap to call once per canvas mount.
// paper_metadata lives inside extraction_preview JSONB; we unwrap it
// server-side so clients don't have to know the JSONB shape.

import { NextResponse } from "next/server";
import { safeAuth, verifySpaceOwnership } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

interface PaperMetadata {
  title: string | null;
  authors: string[];
  year: number | null;
  doi: string | null;
}

interface AssetMetadataRow {
  id: string;
  source_name: string | null;
  source_url: string | null;
  asset_class: string | null;
  paper_metadata: PaperMetadata | null;
}

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

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;
  const isOwner = await verifySpaceOwnership(supabase, spaceId, user.id);
  if (!isOwner) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: rows, error } = await db
    .from("ingested_files")
    .select("id, source_name, source_url, asset_class, extraction_preview")
    .eq("space_id", spaceId);

  if (error) {
    console.warn("[asset-metadata] fetch failed:", error);
    return NextResponse.json({ assets: [] satisfies AssetMetadataRow[] });
  }

  const assets: AssetMetadataRow[] = (
    (rows ?? []) as Array<{
      id: string;
      source_name: string | null;
      source_url: string | null;
      asset_class: string | null;
      extraction_preview: unknown;
    }>
  ).map((r) => ({
    id: r.id,
    source_name: r.source_name,
    source_url: r.source_url,
    asset_class: r.asset_class,
    paper_metadata: extractPaperMetadata(r.extraction_preview),
  }));

  return NextResponse.json({ assets });
}
