"use client";

// ── ConfirmActionDialog ────────────────────────────────────────────
//
// Generic confirmation modal for destructive / heavy Coach actions.
// Used by the dispatcher for:
//   - regenerate_strategy (kicks off a full pipeline re-run)
//   - build_app           (kicks off generate-apps pipeline)
//
// Apple-glass aesthetic matching the other twin dialogs. The
// "Confirm" button can be disabled while the action is in flight
// and shows a custom loading label.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, AlertTriangle, Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  loadingLabel?: string;
  /** Tone of the confirm button. "destructive" uses red, "primary" black. */
  tone?: "primary" | "destructive";
  onConfirm: () => Promise<void> | void;
}

export function ConfirmActionDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  loadingLabel = "Working…",
  tone = "primary",
  onConfirm,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, busy]);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      // Caller is responsible for toasting; dialog stays open so
      // user can retry or cancel.
    } finally {
      setBusy(false);
    }
  };

  if (!mounted || !open) return null;

  const confirmCls =
    tone === "destructive"
      ? "bg-red-600 hover:bg-red-500"
      : "bg-gray-900 hover:bg-gray-700";

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/20"
        onClick={busy ? undefined : onClose}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        className="relative w-full max-w-md overflow-hidden rounded-3xl"
        style={{
          background: "var(--glass-float-bg)",
          boxShadow: "var(--shadow-float)",
          backdropFilter: "blur(var(--blur-float))",
          WebkitBackdropFilter: "blur(var(--blur-float))",
        }}
      >
        {!busy && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-500 transition hover:bg-black/[0.04] hover:text-gray-900"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        )}
        <div className="px-7 py-6">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
              style={{
                background:
                  tone === "destructive"
                    ? "rgba(254, 226, 226, 0.7)"
                    : "rgba(15,23,42,0.04)",
                color:
                  tone === "destructive" ? "#dc2626" : "var(--accent-500)",
              }}
            >
              <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <h2 className="font-display-tight text-[19px] font-semibold leading-tight text-gray-900">
                {title}
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-gray-600">
                {description}
              </p>
            </div>
          </div>
          <div className="mt-6 flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded-full px-4 py-2 text-[12.5px] font-medium text-gray-600 transition hover:text-gray-900 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={busy}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${confirmCls}`}
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />}
              {busy ? loadingLabel : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
