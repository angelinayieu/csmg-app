// ── Shared avatar upload/remove ──
//
// Single source of truth for user avatars. Resizes to 256² client-side
// (canvas) so we don't burn Storage quota on phone photos, uploads via
// the Supabase Storage browser client, then PATCHes the profile with
// the public URL. Used by both the Synergy avatar uploader and the
// /app/profile identity control — extend HERE, don't fork.
//
// Bucket policy (migration 20260808_tier1_polish.sql):
//   - Files stored at `<user_id>/<filename>` so RLS gates writes
//   - Public read so the URL works without auth headers
//   - 512 KB cap + image/{png,jpeg,webp} allowlist at the bucket level
//
// Browser-only (uses createImageBitmap/canvas) — import from client
// components only.

import { createClient } from "@/lib/supabase/client";

const BUCKET = "synergy_avatars";
const TARGET_SIZE = 256;
const MAX_BYTES = 256 * 1024; // 256 KB after resize (under the bucket's 512 KB cap)

/**
 * Resize + upload an avatar for `userId`, persist it on the profile, and
 * return the public URL. Throws on validation/upload/persist failure
 * (callers surface the message). Best-effort cleans up older files.
 */
export async function uploadAvatar(file: File, userId: string): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please pick an image file");
  }

  const resized = await resizeToSquare(file, TARGET_SIZE);
  // png in → png out (preserves alpha), else webp for best compression.
  // Both are in the bucket allowlist.
  const outputType = file.type === "image/png" ? "image/png" : "image/webp";
  const blob = await canvasToBlob(resized, outputType, 0.85);
  if (blob.size > MAX_BYTES) {
    throw new Error("Image too large after resize — try a smaller original");
  }

  const supabase = createClient();
  // Path: <user_id>/avatar-<timestamp>.<ext>. The timestamp prevents
  // CDN-cache hits on overwrite; the user_id prefix satisfies the RLS
  // folder check from the migration.
  const ext = outputType === "image/png" ? "png" : "webp";
  const path = `${userId}/avatar-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: outputType,
    cacheControl: "3600",
    upsert: false,
  });
  if (upErr) throw upErr;

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = urlData.publicUrl;

  const res = await fetch("/api/synergy/profiles/me", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ avatar_url: publicUrl }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }

  // Best-effort: drop older avatar files for this user. RLS-gated +
  // async; failures are silent.
  cleanupOldAvatars(supabase, userId, path).catch((err) =>
    console.warn("[avatar] cleanup failed:", err),
  );

  return publicUrl;
}

/**
 * Clear the avatar on the profile and best-effort delete the underlying
 * Storage file. Throws only if the profile PATCH fails.
 */
export async function removeAvatar(
  userId: string,
  currentUrl: string | null,
): Promise<void> {
  const res = await fetch("/api/synergy/profiles/me", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ avatar_url: null }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  // Delete the file too (best-effort — an orphan file in storage is fine).
  try {
    const path = currentUrl ? pathFromPublicUrl(currentUrl, userId) : null;
    if (path) {
      const supabase = createClient();
      await supabase.storage.from(BUCKET).remove([path]);
    }
  } catch {
    // ignore
  }
}

// ── helpers ──

async function resizeToSquare(
  file: File,
  size: number,
): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  // Centered square crop first so non-square photos don't squish.
  const min = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - min) / 2;
  const sy = (bitmap.height - min) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2d context unavailable");
  ctx.drawImage(bitmap, sx, sy, min, min, 0, 0, size, size);
  return canvas;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("toBlob returned null"));
      },
      type,
      quality,
    );
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cleanupOldAvatars(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  currentPath: string,
) {
  const { data: files } = await supabase.storage.from(BUCKET).list(userId);
  if (!files) return;
  const stale = (files as Array<{ name: string }>)
    .map((f) => `${userId}/${f.name}`)
    .filter((p) => p !== currentPath);
  if (stale.length === 0) return;
  await supabase.storage.from(BUCKET).remove(stale);
}

function pathFromPublicUrl(url: string, userId: string): string | null {
  // https://<project>.supabase.co/storage/v1/object/public/synergy_avatars/<userId>/<filename>
  const marker = `/${BUCKET}/${userId}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  return `${userId}/${url.slice(i + marker.length)}`;
}
