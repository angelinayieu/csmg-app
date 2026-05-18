"use client";

// ── LogObservationDialog ───────────────────────────────────────────
//
// Apple-glass modal. The user types what they saw, optionally tags
// it, optionally attaches a structured measurement, and submits. The
// endpoint scores it against open predictions (W7 calibration) and
// returns the inserted row with verdict chips.
//
// Lives in /parts/dialogs so multiple call sites can reuse it:
//   - Coach action_type="log_observation"
//   - Page header TwinActionsMenu → Log observation
//   - Outcomes tab "Log observation" button (replaces the Phase 1
//     dashed placeholder)
//
// Entity multi-select is deferred to Phase 3 — for now the user can
// reference entities in the free-text and we let the Skeptic pick
// them up later. predicted_entity_ids stays empty by default.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Sparkles } from "lucide-react";
import { ObservationIcon } from "@/components/twin/icons/twin-icons";
import type { ObservationRow } from "@/app/api/spaces/[id]/observations/route";

interface Props {
  spaceId: string;
  open: boolean;
  onClose: () => void;
  /** Called with the inserted observation after success. Callers
   *  use this to refresh their own state (recent list, bundle, etc.). */
  onSubmitted?: (observation: ObservationRow) => void;
}

export function LogObservationDialog({
  spaceId,
  open,
  onClose,
  onSubmitted,
}: Props) {
  const [text, setText] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [hasMeasurement, setHasMeasurement] = useState(false);
  const [metric, setMetric] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Autofocus the textarea when the dialog opens.
  useEffect(() => {
    if (open && textRef.current) {
      textRef.current.focus();
    }
  }, [open]);

  // Reset form on close.
  useEffect(() => {
    if (!open) {
      setText("");
      setTagsInput("");
      setHasMeasurement(false);
      setMetric("");
      setValue("");
      setUnit("");
      setError(null);
    }
  }, [open]);

  // Esc-to-close + body scroll lock.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const handleSubmit = async () => {
    if (submitting) return;
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      setError("Write what you observed before submitting.");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20);

      let actualValue:
        | { metric: string; value: number; unit?: string }
        | null = null;
      if (hasMeasurement) {
        const numeric = Number(value);
        if (metric.trim() && Number.isFinite(numeric)) {
          actualValue = {
            metric: metric.trim(),
            value: numeric,
            ...(unit.trim() ? { unit: unit.trim() } : {}),
          };
        }
      }

      const res = await fetch(`/api/spaces/${spaceId}/observations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          observation_text: trimmed,
          tags,
          actual_value: actualValue,
        }),
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }

      const json = (await res.json()) as { observation: ObservationRow };
      onSubmitted?.(json.observation);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/20 transition-opacity"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="log-obs-title"
        className="relative w-full max-w-lg overflow-hidden rounded-3xl"
        style={{
          background: "var(--glass-float-bg)",
          boxShadow: "var(--shadow-float)",
          backdropFilter: "blur(var(--blur-float))",
          WebkitBackdropFilter: "blur(var(--blur-float))",
          animation: "log-obs-in 240ms var(--ease-out-quart)",
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-500 transition hover:bg-black/[0.04] hover:text-gray-900"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>

        <div className="px-7 py-6">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-500">
            <ObservationIcon size={11} />
            Log observation
          </div>
          <h2
            id="log-obs-title"
            className="mt-2 font-display-tight text-[22px] font-semibold leading-tight text-gray-900"
          >
            What did you actually see?
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-gray-500">
            The twin will score this against any open predictions and
            recalibrate where it&apos;s wrong.
          </p>

          <div className="mt-5 space-y-4">
            <div>
              <textarea
                ref={textRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Worked 3 deep-work blocks today — felt sharper than the twin predicted."
                rows={4}
                maxLength={4000}
                className="w-full resize-none rounded-xl border border-black/[0.06] bg-white/60 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-gray-900 placeholder:text-gray-400 focus:border-black/[0.12] focus:outline-none"
              />
              <div className="mt-1 text-right text-[10.5px] text-gray-400">
                {text.length}/4000
              </div>
            </div>

            <div>
              <label className="text-[10.5px] font-medium uppercase tracking-wide text-gray-500">
                Tags (comma-separated, optional)
              </label>
              <input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="energy, morning, focus"
                className="mt-1 w-full rounded-xl border border-black/[0.06] bg-white/60 px-3.5 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-black/[0.12] focus:outline-none"
              />
            </div>

            <div className="rounded-xl border border-black/[0.05] bg-white/40 px-3.5 py-3">
              <label className="flex items-start gap-2.5 text-[12.5px] text-gray-700">
                <input
                  type="checkbox"
                  checked={hasMeasurement}
                  onChange={(e) => setHasMeasurement(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-gray-900"
                />
                <div>
                  <div className="font-medium text-gray-900">
                    Attach a measurement
                  </div>
                  <div className="text-[11px] text-gray-500">
                    Recommended when there&apos;s an open prediction on this
                    metric — enables numeric calibration.
                  </div>
                </div>
              </label>

              {hasMeasurement && (
                <div className="mt-3 grid grid-cols-[1.5fr_1fr_0.7fr] gap-2">
                  <input
                    value={metric}
                    onChange={(e) => setMetric(e.target.value)}
                    placeholder="metric"
                    className="rounded-lg border border-black/[0.06] bg-white/70 px-2.5 py-1.5 text-[12.5px] text-gray-900 placeholder:text-gray-400 focus:border-black/[0.12] focus:outline-none"
                  />
                  <input
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="value"
                    inputMode="decimal"
                    className="rounded-lg border border-black/[0.06] bg-white/70 px-2.5 py-1.5 text-[12.5px] text-gray-900 placeholder:text-gray-400 focus:border-black/[0.12] focus:outline-none"
                  />
                  <input
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="unit"
                    className="rounded-lg border border-black/[0.06] bg-white/70 px-2.5 py-1.5 text-[12.5px] text-gray-900 placeholder:text-gray-400 focus:border-black/[0.12] focus:outline-none"
                  />
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">
                {error}
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="text-[11px] text-gray-500">
              <Sparkles className="mr-1 inline h-3 w-3" strokeWidth={1.75} />
              The twin learns the moment you press submit.
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                disabled={submitting}
                className="rounded-full px-4 py-2 text-[12.5px] font-medium text-gray-600 transition hover:text-gray-900 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || text.trim().length === 0}
                className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-2 text-[12.5px] font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? "Submitting…" : "Log observation"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes log-obs-in {
          from {
            transform: translateY(8px) scale(0.985);
            opacity: 0;
          }
          to {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }
      `}</style>
    </div>,
    document.body,
  );
}
