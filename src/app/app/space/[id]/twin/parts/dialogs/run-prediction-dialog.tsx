"use client";

// ── RunPredictionDialog ────────────────────────────────────────────
//
// Modal for the user-emitted forecast flow. Mirrors the LogObservation
// dialog's visual language so the two "feeding the twin" actions feel
// like a matched pair.
//
// Required fields: metric_label, value (numeric OR text), horizon_at.
// Optional: unit, rationale, confidence.
//
// Default horizon is "1 week from now" — short enough that the user
// gets feedback quickly, long enough that most metrics have time to
// move.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Target } from "lucide-react";
import { PredictionIcon } from "@/components/twin/icons/twin-icons";

interface Props {
  spaceId: string;
  open: boolean;
  onClose: () => void;
  /** Fired with the inserted prediction id after success. */
  onSubmitted?: (predictionId: string) => void;
}

// Helper — ISO date string for horizon input default (1 week out).
function defaultHorizonIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  // Local-time YYYY-MM-DD for <input type="date">
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function RunPredictionDialog({
  spaceId,
  open,
  onClose,
  onSubmitted,
}: Props) {
  const [metric, setMetric] = useState("");
  const [unit, setUnit] = useState("");
  const [valueKind, setValueKind] = useState<"numeric" | "text">("numeric");
  const [numericValue, setNumericValue] = useState("");
  const [textValue, setTextValue] = useState("");
  const [horizonDate, setHorizonDate] = useState(defaultHorizonIso());
  const [rationale, setRationale] = useState("");
  const [confidence, setConfidence] = useState(60); // 0..100 in the UI, converted on submit
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const metricRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open && metricRef.current) metricRef.current.focus();
  }, [open]);

  // Reset form on close.
  useEffect(() => {
    if (!open) {
      setMetric("");
      setUnit("");
      setValueKind("numeric");
      setNumericValue("");
      setTextValue("");
      setHorizonDate(defaultHorizonIso());
      setRationale("");
      setConfidence(60);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const handleSubmit = async () => {
    if (submitting) return;
    if (metric.trim().length === 0) {
      setError("Pick a metric you're forecasting.");
      return;
    }
    if (valueKind === "numeric") {
      const n = Number(numericValue);
      if (!Number.isFinite(n)) {
        setError("Enter a numeric value or switch to text.");
        return;
      }
    } else if (textValue.trim().length === 0) {
      setError("Enter a qualitative prediction or switch to numeric.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Convert local date input → ISO at end-of-day local.
      const [yyyy, mm, dd] = horizonDate.split("-").map((s) => parseInt(s, 10));
      const horizon = new Date(yyyy, (mm ?? 1) - 1, dd ?? 1, 23, 59, 59, 0);

      const body = {
        metric_label: metric.trim(),
        metric_unit: unit.trim() || null,
        horizon_at: horizon.toISOString(),
        predicted_value:
          valueKind === "numeric" ? Number(numericValue) : null,
        predicted_value_text:
          valueKind === "text" ? textValue.trim() : null,
        rationale: rationale.trim() || null,
        confidence: confidence / 100,
      };

      const res = await fetch(
        `/api/spaces/${spaceId}/twin/run-prediction`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { prediction: { id: string } };
      onSubmitted?.(json.prediction.id);
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
        aria-labelledby="run-pred-title"
        className="relative w-full max-w-lg overflow-hidden rounded-3xl"
        style={{
          background: "var(--glass-float-bg)",
          boxShadow: "var(--shadow-float)",
          backdropFilter: "blur(var(--blur-float))",
          WebkitBackdropFilter: "blur(var(--blur-float))",
          animation: "run-pred-in 240ms var(--ease-out-quart)",
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
            <PredictionIcon size={11} />
            Run prediction
          </div>
          <h2
            id="run-pred-title"
            className="mt-2 font-display-tight text-[22px] font-semibold leading-tight text-gray-900"
          >
            What do you forecast?
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-gray-500">
            Put a stake in the ground. We&apos;ll auto-resolve against
            your next matching observation.
          </p>

          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-[2fr_1fr] gap-2">
              <div>
                <label className="text-[10.5px] font-medium uppercase tracking-wide text-gray-500">
                  Metric
                </label>
                <input
                  ref={metricRef}
                  value={metric}
                  onChange={(e) => setMetric(e.target.value)}
                  placeholder="deep_work_hours"
                  className="mt-1 w-full rounded-xl border border-black/[0.06] bg-white/60 px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-black/[0.12] focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10.5px] font-medium uppercase tracking-wide text-gray-500">
                  Unit
                </label>
                <input
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="hours"
                  className="mt-1 w-full rounded-xl border border-black/[0.06] bg-white/60 px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-black/[0.12] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-[10.5px] font-medium uppercase tracking-wide text-gray-500">
                  Predicted value
                </label>
                <div
                  className="inline-flex items-center gap-0.5 rounded-full p-0.5 text-[10.5px]"
                  style={{
                    background: "rgba(15,23,42,0.04)",
                  }}
                >
                  {(["numeric", "text"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setValueKind(k)}
                      className={`rounded-full px-2 py-0.5 transition ${
                        valueKind === k
                          ? "bg-white text-gray-900 shadow-sm"
                          : "text-gray-500"
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              {valueKind === "numeric" ? (
                <input
                  value={numericValue}
                  onChange={(e) => setNumericValue(e.target.value)}
                  placeholder="3.5"
                  inputMode="decimal"
                  className="mt-1 w-full rounded-xl border border-black/[0.06] bg-white/60 px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-black/[0.12] focus:outline-none"
                />
              ) : (
                <input
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                  placeholder="qualitative outcome…"
                  className="mt-1 w-full rounded-xl border border-black/[0.06] bg-white/60 px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-black/[0.12] focus:outline-none"
                />
              )}
            </div>

            <div>
              <label className="text-[10.5px] font-medium uppercase tracking-wide text-gray-500">
                Horizon (when to check)
              </label>
              <input
                type="date"
                value={horizonDate}
                onChange={(e) => setHorizonDate(e.target.value)}
                className="mt-1 w-full rounded-xl border border-black/[0.06] bg-white/60 px-3 py-2 text-[13px] text-gray-900 focus:border-black/[0.12] focus:outline-none"
              />
            </div>

            <div>
              <label className="flex items-center justify-between text-[10.5px] font-medium uppercase tracking-wide text-gray-500">
                <span>Confidence</span>
                <span className="font-mono normal-case text-gray-700">
                  {confidence}%
                </span>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={confidence}
                onChange={(e) => setConfidence(parseInt(e.target.value, 10))}
                className="mt-2 w-full accent-gray-900"
              />
            </div>

            <div>
              <label className="text-[10.5px] font-medium uppercase tracking-wide text-gray-500">
                Rationale (optional)
              </label>
              <textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Why do you think this will happen?"
                rows={2}
                className="mt-1 w-full resize-none rounded-xl border border-black/[0.06] bg-white/60 px-3 py-2 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-black/[0.12] focus:outline-none"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">
                {error}
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="text-[11px] text-gray-500">
              <Target className="mr-1 inline h-3 w-3" strokeWidth={1.75} />
              The resolver checks back after your horizon.
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
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-2 text-[12.5px] font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? "Submitting…" : "Run prediction"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes run-pred-in {
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
