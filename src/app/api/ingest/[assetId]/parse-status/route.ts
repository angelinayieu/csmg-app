// GET /api/ingest/[assetId]/parse-status
//
// Polled by the client after a multipart upload returns
// `awaiting_parse: true`. Returns the row's current parse_status, plus
// the extracted normalized_text when status='ready' or the error
// message when status='error'.
//
// Cheap query — no LLM, no extraction, just one indexed select. Safe
// to poll every 1s during the parse window.

import { NextResponse } from "next/server";
import { safeAuth } from "@/lib/api-helpers";

export const maxDuration = 10;
export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ assetId: string }>;
}

interface AssetRow {
  id: string;
  user_id: string;
  source_name: string | null;
  asset_class: string | null;
  parse_status: "pending" | "parsing" | "ready" | "error" | "skipped";
  parse_error: string | null;
  parse_started_at: string | null;
  parse_completed_at: string | null;
  normalized_text: string | null;
  raw_chars: number | null;
  normalized_chars: number | null;
  metadata: Record<string, unknown> | null;
}

export async function GET(_request: Request, ctx: Ctx) {
  const { user, supabase, error: authError } = await safeAuth();
  if (authError) return authError;

  const { assetId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data, error } = (await db
    .from("ingested_files")
    .select(
      "id, user_id, source_name, asset_class, parse_status, parse_error, parse_started_at, parse_completed_at, normalized_text, raw_chars, normalized_chars, metadata",
    )
    .eq("id", assetId)
    .maybeSingle()) as { data: AssetRow | null; error: { message?: string } | null };

  if (error) {
    return NextResponse.json(
      { error: `parse-status query failed: ${error.message ?? "unknown"}` },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
  if (data.user_id !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Shape the response so the client can decide what to do without
  // additional checks. text is included only when ready; error only
  // when failed; the metadata bundle is always returned for chip UX
  // (raw_chars / normalized_chars surface as "1.2k extracted").
  return NextResponse.json({
    asset_id: data.id,
    status: data.parse_status,
    error: data.parse_status === "error" ? data.parse_error : null,
    text: data.parse_status === "ready" ? (data.normalized_text ?? "") : null,
    source_name: data.source_name,
    asset_class: data.asset_class,
    raw_chars: data.raw_chars,
    normalized_chars: data.normalized_chars,
    started_at: data.parse_started_at,
    completed_at: data.parse_completed_at,
    metadata: data.metadata ?? null,
  });
}
