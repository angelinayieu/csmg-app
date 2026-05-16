// ── Archive confirm sheet ──
//
// Mirrors the reveal-confirm-sheet pattern. Confirms before archiving
// because archive is destructive from the user's POV — once archived,
// the room hides from /rooms and check-ins / reveals get rejected.
//
// Visual structure identical to reveal sheet: backdrop + centered card
// + ghost Cancel + filled gray-900 Confirm. The icon (Archive) and the
// copy are the only things that differ.

"use client";

import { useEffect, useState } from "react";
import { Archive, Loader2, X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function ArchiveConfirmSheet({ open, onClose, onConfirm }: Props) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) setPending(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending, onClose]);

  if (!open) return null;

  const handleConfirm = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onConfirm();
    } catch {
      setPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="archive-sheet-title"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={() => !pending && onClose()}
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]"
      />

      <div
        className="relative w-full max-w-[440px] rounded-2xl border border-gray-200 bg-white p-6"
        style={{
          boxShadow:
            "0 1px 2px rgba(15,23,42,0.06), 0 24px 48px -16px rgba(15,23,42,0.28)",
        }}
      >
        <button
          type="button"
          onClick={() => !pending && onClose()}
          disabled={pending}
          aria-label="Close"
          className="absolute right-4 top-4 inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>

        <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gray-900">
          <Archive className="h-4 w-4 text-white" strokeWidth={1.75} />
        </div>

        <h2
          id="archive-sheet-title"
          className="font-display-tight mt-4 text-[20px] font-semibold leading-tight text-gray-900"
        >
          Archive this room?
        </h2>

        <div className="mt-3 space-y-3 text-[13px] leading-relaxed text-gray-600">
          <p>
            The room moves out of your active list. Check-ins and identity
            reveal actions become unavailable for both of you, and the
            weekly digest will stop generating new entries.
          </p>
          <p>
            All existing check-ins, reflections, and digest history stay
            in place — only forward writes are stopped.
          </p>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => !pending && onClose()}
            disabled={pending}
            className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px] font-medium text-gray-700 transition hover:border-gray-300 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-2 text-[12.5px] font-medium text-white transition hover:bg-gray-800 disabled:opacity-60"
          >
            {pending && (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
            )}
            Archive room
          </button>
        </div>
      </div>
    </div>
  );
}
