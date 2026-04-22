// GET /api/spaces/[id]/files/catalog
//
// Phase 2D — returns every `ingested_files` row that was uploaded
// INTO this space OR analyzed INTO this space. Union because users
// may upload pre-space then pick a space later; both paths should
// surface in the Files folder.
//
// Each row feeds the Library's Files folder + lets users drag a
// prior upload back onto the canvas as a FileCardShape.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";
import type { Space } from "@/types";

export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ id: string }>;
}

export type IngestedSourceType = "file" | "url" | "text";

export interface FileCatalogEntry {
  id: string;
  space_id: string;
  source_type: IngestedSourceType;
  source_name: string;
  mime_type: string | null;
  source_url: string | null;
  /** First ~200 chars of normalized_text for the card preview. */
  preview: string;
  raw_chars: number;
  normalized_chars: number;
  extraction_method: string | null;
  analyzed: boolean;
  created_at: string;
}

export interface FilesCatalogResponse {
  files: FileCatalogEntry[];
  computed_at: string;
  space_name: string;
}

export async function GET(_request: Request, ctx: Ctx) {
  const { supabase, user, error: authError } = await safeAuth();
  if (authError) return authError;

  const { id: spaceId } = await ctx.params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const [spaceRes, filesRes] = await Promise.all([
    db
      .from("spaces")
      .select("id, name, user_id")
      .eq("id", spaceId)
      .maybeSingle(),
    // Union of "uploaded into" and "analyzed into" this space.
    // Supabase JS doesn't expose a native UNION so we use an `or`
    // filter; RLS still enforces ownership.
    db
      .from("ingested_files")
      .select(
        "id, space_id, source_type, source_name, mime_type, source_url, normalized_text, raw_chars, normalized_chars, extraction_method, analyzed, analyzed_space_id, created_at",
      )
      .or(`space_id.eq.${spaceId},analyzed_space_id.eq.${spaceId}`)
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  if (!spaceRes?.data) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if ((spaceRes.data as Space).user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const spaceName = (spaceRes.data as Space).name;
  const rows = (filesRes.data ?? []) as Array<{
    id: string;
    space_id: string | null;
    source_type: IngestedSourceType;
    source_name: string;
    mime_type: string | null;
    source_url: string | null;
    normalized_text: string;
    raw_chars: number;
    normalized_chars: number;
    extraction_method: string | null;
    analyzed: boolean;
    analyzed_space_id: string | null;
    created_at: string;
  }>;

  const files: FileCatalogEntry[] = rows.map((r) => ({
    id: r.id,
    // For display, use analyzed_space_id when space_id is null (the
    // file was uploaded pre-space then analyzed into this one).
    space_id: r.space_id ?? r.analyzed_space_id ?? spaceId,
    source_type: r.source_type,
    source_name: r.source_name,
    mime_type: r.mime_type,
    source_url: r.source_url,
    preview: (r.normalized_text ?? "").slice(0, 240),
    raw_chars: r.raw_chars,
    normalized_chars: r.normalized_chars,
    extraction_method: r.extraction_method,
    analyzed: r.analyzed,
    created_at: r.created_at,
  }));

  const payload: FilesCatalogResponse = {
    files,
    computed_at: new Date().toISOString(),
    space_name: spaceName,
  };
  return NextResponse.json(payload);
}
