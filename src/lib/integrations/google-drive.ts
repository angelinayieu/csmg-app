// ── Google Drive integration (server) ──
//
// OAuth2 client factory + token lifecycle (refresh) + a file-content
// fetcher that exports Google-native docs/sheets/slides to text and
// downloads binaries (PDF/DOCX/XLSX) for the existing extractors.
//
// Tokens live in `user_integrations` (provider='google_drive'), RLS-locked
// to the owner. Configuration comes from GOOGLE_CLIENT_ID/SECRET +
// NEXT_PUBLIC_GOOGLE_DRIVE_REDIRECT (see .env.example).

import { google, type drive_v3 } from "googleapis";
import { extractPdf, extractDocx, extractSpreadsheet } from "@/lib/ingest/extractors";

export const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
];

export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function getRedirectUri(): string {
  const explicit = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_REDIRECT;
  if (explicit) return explicit;
  // Fall back to localhost dev if unset — production must set the env var
  // to match the URI registered in the Google Cloud console.
  return "http://localhost:3000/api/integrations/google/callback";
}

export function makeOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google Drive isn't configured (missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri());
}

/**
 * Return a valid Drive access token for the user, refreshing via the
 * stored refresh token when the current one is missing/expired. Throws
 * a user-readable error when Drive isn't connected.
 */
export async function getDriveAccessToken(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
): Promise<string> {
  const { data: row, error } = await db
    .from("user_integrations")
    .select("access_token, refresh_token, token_expires_at")
    .eq("user_id", userId)
    .eq("provider", "google_drive")
    .maybeSingle();
  if (error || !row) throw new Error("Google Drive isn't connected.");

  const expiresAt = row.token_expires_at
    ? new Date(row.token_expires_at).getTime()
    : 0;
  if (row.access_token && expiresAt > Date.now() + 60_000) {
    return row.access_token as string;
  }

  if (!row.refresh_token) {
    throw new Error("Google Drive session expired — reconnect Drive.");
  }

  const oauth = makeOAuthClient();
  oauth.setCredentials({ refresh_token: row.refresh_token });
  // getAccessToken() refreshes using the refresh token when needed and
  // populates oauth.credentials (incl. expiry_date).
  const { token } = await oauth.getAccessToken();
  if (!token) throw new Error("Could not refresh the Google Drive token.");

  await db
    .from("user_integrations")
    .update({
      access_token: token,
      token_expires_at: oauth.credentials.expiry_date
        ? new Date(oauth.credentials.expiry_date).toISOString()
        : null,
      status: "connected",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", "google_drive");

  return token;
}

export interface DrivePick {
  id: string;
  name: string;
  mimeType: string;
}

/**
 * Pull a Drive file's content as text. Google-native types export to
 * text/CSV; binaries (PDF/DOCX/XLSX) download and route through the
 * existing extractors so the same parsing rules apply everywhere.
 */
export async function fetchDriveFileText(
  drive: drive_v3.Drive,
  file: DrivePick,
): Promise<{ text: string; mime: string }> {
  const gm = file.mimeType || "";

  // ── Google-native: export ──
  if (gm === "application/vnd.google-apps.document") {
    const res = await drive.files.export(
      { fileId: file.id, mimeType: "text/plain" },
      { responseType: "text" },
    );
    return { text: String(res.data ?? ""), mime: "text/plain" };
  }
  if (gm === "application/vnd.google-apps.spreadsheet") {
    const res = await drive.files.export(
      { fileId: file.id, mimeType: "text/csv" },
      { responseType: "text" },
    );
    return { text: String(res.data ?? ""), mime: "text/csv" };
  }
  if (gm === "application/vnd.google-apps.presentation") {
    const res = await drive.files.export(
      { fileId: file.id, mimeType: "text/plain" },
      { responseType: "text" },
    );
    return { text: String(res.data ?? ""), mime: "text/plain" };
  }

  // ── Binary: download bytes, extract by type ──
  const res = await drive.files.get(
    { fileId: file.id, alt: "media" },
    { responseType: "arraybuffer" },
  );
  const buf = Buffer.from(res.data as ArrayBuffer);

  if (gm === "application/pdf") {
    const r = await extractPdf(buf, file.name);
    return { text: r.ok ? r.result.text : "", mime: gm };
  }
  if (
    gm.includes("spreadsheetml") ||
    gm === "application/vnd.ms-excel" ||
    file.name.toLowerCase().endsWith(".csv")
  ) {
    const r = await extractSpreadsheet(buf, file.name);
    return { text: r.ok ? r.result.text : "", mime: gm || "text/csv" };
  }
  if (gm.includes("wordprocessingml")) {
    const r = await extractDocx(buf, file.name);
    return { text: r.ok ? r.result.text : "", mime: gm };
  }

  // Plain text / markdown / unknown — best-effort utf-8.
  return { text: buf.toString("utf-8"), mime: gm || "text/plain" };
}
