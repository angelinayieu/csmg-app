// ── Synergy avatar uploader ──
//
// Click-to-upload avatar control for the Synergy profile. The actual
// resize → Storage upload → profile PATCH lives in the shared
// `@/lib/avatar-upload` helper (also used by /app/profile) — this is
// just the Synergy-styled chrome around it.

"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, Trash2, UserCircle2 } from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { uploadAvatar, removeAvatar } from "@/lib/avatar-upload";

interface Props {
  userId: string;
  currentUrl: string | null;
  onChanged: (newUrl: string | null) => void;
}

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

    setUploading(true);
    try {
      const publicUrl = await uploadAvatar(file, userId);
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
      await removeAvatar(userId, currentUrl);
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
