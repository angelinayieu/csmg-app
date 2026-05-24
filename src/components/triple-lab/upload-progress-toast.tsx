"use client";

// Upload progress toast — bottom-left stack that shows the stage of
// each in-flight file drop. Without this the user drops a PDF and
// sees nothing for 30-90s while parse + HITL preview run; with this
// they see "Uploading 'paper.pdf'…" → "Parsing… (this can take 30s)"
// → "Opening review" → done.
//
// Wired from the page-level CardActionHost so both drop paths (raw-
// signal panel AND unified empty state) share one stack — drops from
// either surface show up in the same place.

import { useEffect, useState } from "react";
import type { UploadProgress, UploadStage } from "./upload-flow";
import { colors, tracking } from "./tokens";

interface UploadProgressToastProps {
  /** Imperative API: parent calls `push()` from its onProgress callback
   *  to add or update a toast entry. We keep them in local state and
   *  age out completed/errored ones after a short delay. */
  registerHandle: (handle: { push: (progress: UploadProgress) => void }) => void;
}

interface ToastEntry extends UploadProgress {
  // Local-only timestamp so completed toasts can age out at a steady
  // rate regardless of when the server replied.
  updatedAt: number;
}

const STAGE_LABEL: Record<UploadStage, string> = {
  uploading: "Uploading…",
  parsing: "Parsing PDF · this can take 30s",
  opening_review: "Opening extraction review…",
  materialized: "Added to canvas",
  done: "Review open",
  error: "Upload failed",
};

const TERMINAL_STAGES: Set<UploadStage> = new Set([
  "materialized",
  "done",
  "error",
]);

// How long terminal toasts stay on screen before fading out.
const AGE_OUT_MS = 4500;

export function UploadProgressToast({ registerHandle }: UploadProgressToastProps) {
  const [entries, setEntries] = useState<ToastEntry[]>([]);

  // Register the imperative push handle with the parent ONCE on mount.
  // The parent's onProgress callback then forwards every progress
  // event into this component's local state. Simpler than a context.
  useEffect(() => {
    registerHandle({
      push: (progress: UploadProgress) => {
        const now = Date.now();
        setEntries((prev) => {
          const existing = prev.findIndex((p) => p.id === progress.id);
          if (existing >= 0) {
            const next = [...prev];
            next[existing] = { ...progress, updatedAt: now };
            return next;
          }
          return [...prev, { ...progress, updatedAt: now }];
        });
      },
    });
  }, [registerHandle]);

  // Age-out tick: every 750ms, drop terminal toasts that exceed
  // AGE_OUT_MS. Cheap setInterval — only runs while toasts are on
  // screen because we early-return when entries is empty.
  useEffect(() => {
    if (entries.length === 0) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      setEntries((prev) =>
        prev.filter(
          (e) => !TERMINAL_STAGES.has(e.stage) || now - e.updatedAt < AGE_OUT_MS,
        ),
      );
    }, 750);
    return () => window.clearInterval(interval);
  }, [entries.length]);

  if (entries.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-4 z-50 flex flex-col gap-2"
      style={{ width: 320 }}
    >
      {entries.map((entry) => (
        <ToastCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

// ── Single toast card ────────────────────────────────────────────────
function ToastCard({ entry }: { entry: ToastEntry }) {
  const isError = entry.stage === "error";
  const isTerminal = TERMINAL_STAGES.has(entry.stage);
  const isProgressing = !isTerminal;

  // Tone palette: indigo for in-progress, green for success, red for
  // error. Keeps the same visual grammar as the rest of the lab.
  const tone = isError
    ? {
        bg: colors.state.bottleneckSoft,
        border: "rgba(220, 38, 38, 0.3)",
        fg: colors.state.bottleneckFg,
        accent: colors.state.bottleneck,
      }
    : isTerminal
    ? {
        bg: colors.state.okSoft,
        border: "rgba(13, 148, 136, 0.3)",
        fg: colors.state.okFg,
        accent: colors.state.ok,
      }
    : {
        bg: colors.brand.bgSoft,
        border: colors.brand.haloSoft,
        fg: colors.brand.fgDark,
        accent: colors.brand.fg,
      };

  return (
    <div
      className="pointer-events-auto overflow-hidden rounded-xl border bg-white shadow-xl"
      style={{
        borderColor: tone.border,
        boxShadow: colors.neutral.cardShadowFloating,
      }}
    >
      {/* Tone band on top — narrow accent stripe so the toast type
       *  reads at a glance before the user even reads the text. */}
      <div style={{ height: 2, background: tone.accent }} />

      <div className="flex items-start gap-3 px-3 py-2.5">
        {/* Status indicator: spinner for in-progress, dot for terminal */}
        <div className="mt-0.5 flex h-3 w-3 shrink-0 items-center justify-center">
          {isProgressing ? (
            <Spinner color={tone.accent} />
          ) : (
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: tone.accent }}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {/* Eyebrow: file name + stage label */}
          <div
            className="text-[8.5px] font-bold uppercase"
            style={{
              color: tone.fg,
              letterSpacing: tracking.eyebrowTight,
            }}
          >
            {STAGE_LABEL[entry.stage]}
          </div>
          <div
            className="truncate text-[12px] font-semibold text-slate-900"
            title={entry.fileName}
          >
            {entry.fileName}
          </div>
          {entry.errorMessage && (
            <div
              className="mt-1 text-[10.5px] leading-relaxed"
              style={{ color: tone.fg }}
            >
              {entry.errorMessage}
            </div>
          )}
        </div>
      </div>

      {/* Progress strip for in-progress stages: indeterminate sweep so
       *  the user knows it's alive even when nothing else is moving. */}
      {isProgressing && (
        <div
          className="relative h-0.5 overflow-hidden"
          style={{ background: "rgba(15, 23, 42, 0.05)" }}
        >
          <div
            className="absolute inset-y-0"
            style={{
              width: "30%",
              background: tone.accent,
              animation: "upload-toast-sweep 1.6s ease-in-out infinite",
            }}
          />
        </div>
      )}
    </div>
  );
}

// ── Spinner ──────────────────────────────────────────────────────────
function Spinner({ color }: { color: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      style={{ animation: "upload-toast-spin 0.9s linear infinite" }}
    >
      <circle
        cx="6"
        cy="6"
        r="4.5"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        strokeDasharray="18 28"
        strokeLinecap="round"
      />
    </svg>
  );
}
