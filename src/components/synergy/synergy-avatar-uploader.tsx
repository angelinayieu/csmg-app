// ── Synergy avatar uploader ──
//
// Click-to-upload. Resizes the picked image to 256×256 client-side
// (via canvas) so we don't burn Storage quota on multi-MB phones
// photos. Uploads via the Supabase Storage browser client, then
// PATCHes the profile with the public URL.
//
// Bucket policy (migration 20260808_tier1_polish.sql):
//   - Files stored at `<user_id>/<filename>` so RLS gates writes
//   - Public read so the URL works in inbox cards + room canvases
//     without auth headers
//   - 512 KB cap + image/{png,jpeg,webp} allowlist enforced at the
//     bucket level

"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, Trash2, UserCircle2 } from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { createClient } from "@/lib/supabase/client";

interface Props {
  userId: string;
  currentUrl: string | null;
  onChanged: (newUrl: string | null) => void;
}

const TARGET_SIZE = 256;
const MAX_BYTES = 256 * 1024; // 256 KB after resize (well under bucket's 512 KB cap)

export function SynergyAvatarUploader({
  userId,
  currentUrl,
  onChanged,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = () => {
    if (uploading || removing) return;
    inputRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so picking the same file again re-fires
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please pick an image file");
      return;
    }

    setUploading(true);
    try {
      const resized = await resizeToSquare(file, TARGET_SIZE);
      // Output picker: png if input was png (preserves alpha), else webp
      // for best compression. Both are in the bucket allowlist.
      const outputType = file.type === "image/png" ? "image/png" : "image/webp";
      const blob = await canvasToBlob(resized, outputType, 0.85);
      if (blob.size > MAX_BYTES) {
        toast.error("Image too large after resize", {
          description: "Try a smaller original — under 1 MB before resize works best.",
        });
        return;
      }

      const supabase = createClient();
      // Path convention: <user_id>/avatar-<timestamp>.<ext>. The
      // timestamp prevents CDN-cache hits on overwrite; the user_id
      // prefix satisfies the RLS folder check from the migration.
      const ext = outputType === "image/png" ? "png" : "webp";
      const path = `${userId}/avatar-${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("synergy_avatars")
        .upload(path, blob, {
          contentType: outputType,
          cacheControl: "3600",
          upsert: false,
        });
      if (upErr) throw upErr;

      // Public URL
      const { data: urlData } = supabase.storage
        .from("synergy_avatars")
        .getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      // Persist to profile via existing PATCH (we need to extend the
      // profile endpoint to accept avatar_url — same idiom as
      // notification_email).
      const res = await fetch("/api/synergy/profiles/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ avatar_url: publicUrl }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          body.error ?? `${res.status} ${res.statusText}`,
        );
      }

      // Cleanup: delete any older avatar files for this user. Best-
      // effort; Storage list+delete is async + RLS-gated. Failures
      // are silent.
      cleanupOldAvatars(supabase, userId, path).catch((err) =>
        console.warn("[avatar] cleanup failed:", err),
      );

      onChanged(publicUrl);
      toast.success("Avatar updated");
    } catch (err) {
      toast.error("Upload failed", { description: (err as Error).message });
    } finally {
      setUploading(false);
    }
  };

  const onRemove = async () => {
    if (uploading || removing || !currentUrl) return;
    setRemoving(true);
    try {
      const res = await fetch("/api/synergy/profiles/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ avatar_url: null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      // Delete the underlying file too (best-effort)
      try {
        const path = pathFromPublicUrl(currentUrl, userId);
        if (path) {
          const supabase = createClient();
          await supabase.storage.from("synergy_avatars").remove([path]);
        }
      } catch {
        // ignore — orphan file in storage is fine
      }
      onChanged(null);
      toast.success("Avatar removed");
    } catch (err) {
      toast.error("Remove failed", { description: (err as Error).message });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={onPick}
        disabled={uploading || removing}
        className="group relative inline-flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-50 ring-1 ring-gray-200 transition hover:ring-blue-400 disabled:opacity-60"
        title={currentUrl ? "Replace avatar" : "Upload avatar"}
      >
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentUrl}
            alt="Avatar"
            className="h-full w-full object-cover"
          />
        ) : (
          <UserCircle2 className="h-9 w-9 text-blue-700" />
        )}
        {uploading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          </div>
        ) : (
          <div className="absolute inset-x-0 bottom-0 flex h-7 items-center justify-center bg-gradient-to-t from-black/45 to-transparent opacity-0 transition-opacity group-hover:opacity-100">
            <Camera className="h-3.5 w-3.5 text-white" />
          </div>
        )}
      </button>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={onPick}
          disabled={uploading || removing}
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition hover:border-blue-400 disabled:opacity-60"
        >
          <Camera className="h-3 w-3" />
          {currentUrl ? "Replace" : "Upload"}
        </button>
        {currentUrl && (
          <button
            type="button"
            onClick={onRemove}
            disabled={removing || uploading}
            className="inline-flex w-fit items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 transition hover:border-rose-400 hover:text-rose-700 disabled:opacity-60"
          >
            {removing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            Remove
          </button>
        )}
        <p className="font-mono text-[9px] uppercase tracking-wider text-gray-500">
          PNG / JPG / WebP · resized to 256px
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={onFile}
        className="hidden"
      />
    </div>
  );
}

// ── Client-side resize helpers ──

async function resizeToSquare(file: File, size: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  // Crop to a centered square first so non-square photos don't squish
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
async function cleanupOldAvatars(supabase: any, userId: string, currentPath: string) {
  const { data: files } = await supabase.storage
    .from("synergy_avatars")
    .list(userId);
  if (!files) return;
  const stale = (files as Array<{ name: string }>)
    .map((f) => `${userId}/${f.name}`)
    .filter((p) => p !== currentPath);
  if (stale.length === 0) return;
  await supabase.storage.from("synergy_avatars").remove(stale);
}

function pathFromPublicUrl(url: string, userId: string): string | null {
  // Public URLs look like:
  //   https://<project>.supabase.co/storage/v1/object/public/synergy_avatars/<userId>/<filename>
  const marker = `/synergy_avatars/${userId}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  return `${userId}/${url.slice(i + marker.length)}`;
}
