// POST /api/integrations/google/import
//
// Imports files picked from the Google Picker. Each file is fetched via
// the Drive API (Google-native → exported to text/CSV; binaries →
// downloaded + run through the existing extractors), normalized, and
// persisted as an ingested_files row with a null space_id — so the
// chatbox can attach it by id exactly like a dropped file.
//
// Body: { files: [{ id, name, mimeType }] }
// Returns: { imported: [{ name, assetId }] }

import { NextResponse } from "next/server";
import { google } from "googleapis";
import { safeAuth, safeJsonParse, sanitizeErrorMessage } from "@/lib/api-helpers";
import {
  getDriveAccessToken,
  makeOAuthClient,
  fetchDriveFileText,
  type DrivePick,
} from "@/lib/integrations/google-drive";
import { normalizeText } from "@/lib/ingest/normalizer";
import { inferAssetClass } from "@/types/asset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { user, supabase, error } = await safeAuth();
  if (error) return error;

  const { data: body, error: jsonErr } = await safeJsonParse<{
    files?: DrivePick[];
  }>(req);
  if (jsonErr) return jsonErr;

  const files = Array.isArray(body.files) ? body.files.slice(0, 20) : [];
  if (files.length === 0) return NextResponse.json({ imported: [] });

  let accessToken: string;
  try {
    accessToken = await getDriveAccessToken(supabase, user.id);
  } catch (err) {
    return NextResponse.json(
      { error: sanitizeErrorMessage(err) },
      { status: 400 },
    );
  }

  const oauth = makeOAuthClient();
  oauth.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: "v3", auth: oauth });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const imported: Array<{ name: string; assetId: string }> = [];
  for (const file of files) {
    if (!file?.id || !file?.name) continue;
    try {
      const { text, mime } = await fetchDriveFileText(drive, file);
      if (!text.trim()) continue;

      const {
        text: normalizedText,
        normalized,
        chunks,
      } = await normalizeText(text);
      const assetClass = inferAssetClass({
        sourceType: "file",
        mimeType: mime,
        sourceName: file.name,
        contentSnippet: normalizedText.slice(0, 500),
      });

      const { data: ins, error: insErr } = await db
        .from("ingested_files")
        .insert({
          user_id: user.id,
          space_id: null, // claimed onto the space when the objective is created
          source_type: "file",
          source_name: file.name,
          mime_type: mime,
          source_url: null,
          normalized_text: normalizedText,
          raw_chars: text.length,
          normalized_chars: normalizedText.length,
          extraction_method: "google_drive",
          asset_class: assetClass,
          metadata: { drive_file_id: file.id, normalize_chunks: chunks, normalized },
          parse_status: "ready",
          parse_completed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (!insErr && ins?.id) {
        imported.push({ name: file.name, assetId: ins.id as string });
      }
    } catch (err) {
      console.warn("[google/import] file failed:", file.name, err);
    }
  }

  return NextResponse.json({ imported });
}
