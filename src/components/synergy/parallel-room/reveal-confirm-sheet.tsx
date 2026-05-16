// ── Reveal confirm sheet ──
//
// A small modal-style dialog that opens when the user clicks the
// "Reveal identity" button (or "Withdraw" within the 24h window).
// Apple-Pro sheet feel:
//   - Centered card, max-width 440px
//   - Backdrop: rgba(15,23,42,0.45) with backdrop-blur(2px)
//   - White card, hairline gray-200 border, single soft shadow
//   - Two buttons: ghost Cancel (left) + filled gray-900 Confirm (right)
//
// Two modes via prop:
//   mode='reveal'   — initial reveal: explain the mutual handshake
//   mode='withdraw' — undo within 24h: explain that this hides you again
//
// Closes on backdrop click + Esc + after a successful action.

"use client";

import { useEffect, useState } from "react";
import { Loader2, Users, X } from "lucide-react";

interface Props {
  mode: "reveal" | "withdraw";
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function RevealConfirmSheet({
  mode,
  open,
  onClose,
  onConfirm,
}: Props) {
  const [pending, setPending] = useState(false);

  // Reset pending state when sheet opens
  useEffect(() => {
    if (open) setPending(false);
  }, [open]);

  // Escape key closes (unless pending)
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
      // onConfirm is expected to close on success (parent owns that)
    } catch {
      // Parent toasted; just reset pending
      setPending(false);
    }
  };

  const isReveal = mode === "reveal";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reveal-sheet-title"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={() => !pending && onClose()}
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]"
      />

      {/* Card */}
      <div
        className="relative w-full max-w-[440px] rounded-2xl border border-gray-200 bg-white p-6"
        style={{
          boxShadow:
            "0 1px 2px rgba(15,23,42,0.06), 0 24px 48px -16px rgba(15,23,42,0.28)",
        }}
      >
        {/* Close button (top-right) */}
        <button
          type="button"
          onClick={() => !pending && onClose()}
          disabled={pending}
          aria-label="Close"
          className="absolute right-4 top-4 inline-flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>

        {/* Icon */}
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gray-900">
          <Users className="h-4 w-4 text-white" strokeWidth={1.75} />
        </div>

        {/* Title */}
        <h2
          id="reveal-sheet-title"
          className="font-display-tight mt-4 text-[20px] font-semibold leading-tight text-gray-900"
        >
          {isReveal ? "Reveal your identity?" : "Hide your identity again?"}
        </h2>

        {/* Body copy */}
        <div className="mt-3 space-y-3 text-[13px] leading-relaxed text-gray-600">
          {isReveal ? (
            <>
              <p>
                Your display name and avatar become visible to your parallel-
                path partner — but only once they reveal too. Until then,
                you stay anonymous and they won&apos;t know you revealed.
              </p>
              <p>
                You can withdraw within 24 hours. After that, the reveal in
                this room is permanent.
              </p>
            </>
          ) : (
            <>
              <p>
                Your reveal is within the 24-hour withdraw window. Hiding
                will return you to the anonymous abstract avatar in this
                room.
              </p>
              <p>
                If your partner has already revealed, their identity will
                still be visible to you. They will not be notified that
                you withdrew.
              </p>
            </>
          )}
        </div>

        {/* Actions */}
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
            {isReveal ? "Reveal identity" : "Hide me again"}
          </button>
        </div>
      </div>
    </div>
  );
}
