"use client";

import { useState } from "react";

export type StageStatus = "queued" | "running" | "ok" | "failed" | "skipped";

interface StageCardProps {
  index: number;
  title: string;
  subtitle?: string;
  status: StageStatus;
  durationSeconds?: number | null;
  summary?: React.ReactNode;
  details?: React.ReactNode;
}

const STATUS_COLOR: Record<StageStatus, { dot: string; label: string; text: string }> = {
  queued: { dot: "rgba(15,23,42,0.18)", label: "Queued", text: "rgba(15,23,42,0.4)" },
  running: { dot: "#D97706", label: "Running", text: "#D97706" },
  ok: { dot: "#16A34A", label: "Complete", text: "#16A34A" },
  failed: { dot: "#DC2626", label: "Failed", text: "#DC2626" },
  skipped: { dot: "rgba(15,23,42,0.25)", label: "Skipped", text: "rgba(15,23,42,0.5)" },
};

export function StageCard({
  index,
  title,
  subtitle,
  status,
  durationSeconds,
  summary,
  details,
}: StageCardProps) {
  const [open, setOpen] = useState(false);
  const colors = STATUS_COLOR[status];
  const showSpinner = status === "running";

  return (
    <div
      className="rounded-2xl overflow-hidden transition-all"
      style={{
        background: "white",
        border: "1px solid rgba(15,23,42,0.06)",
        boxShadow: "0 1px 2px rgba(11,18,40,0.04)",
        opacity: status === "queued" ? 0.55 : 1,
      }}
    >
      <div className="px-5 py-4 flex items-start gap-4">
        <div className="flex flex-col items-center pt-0.5">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11.5px] font-semibold"
            style={{
              background:
                status === "ok"
                  ? "rgba(22,163,74,0.1)"
                  : status === "failed"
                    ? "rgba(220,38,38,0.1)"
                    : status === "running"
                      ? "rgba(217,119,6,0.1)"
                      : "rgba(15,23,42,0.05)",
              color: colors.text,
            }}
          >
            {status === "ok" ? "✓" : status === "failed" ? "!" : index}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3
                className="text-[14px] font-semibold tracking-tight"
                style={{ color: "#0F172A" }}
              >
                {title}
              </h3>
              {subtitle && (
                <p
                  className="text-[12px] mt-0.5 truncate"
                  style={{ color: "rgba(15,23,42,0.55)" }}
                >
                  {subtitle}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {showSpinner && (
                <span
                  className="inline-block w-3 h-3 rounded-full"
                  style={{
                    border: "1.5px solid rgba(217,119,6,0.2)",
                    borderTopColor: "#D97706",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
              )}
              <span
                className="text-[10.5px] font-semibold uppercase tracking-wide"
                style={{ color: colors.text, letterSpacing: "0.05em" }}
              >
                {colors.label}
              </span>
              {durationSeconds != null && (
                <span
                  className="text-[10.5px]"
                  style={{ color: "rgba(15,23,42,0.4)" }}
                >
                  {durationSeconds}s
                </span>
              )}
            </div>
          </div>

          {summary && (
            <div className="mt-3 text-[13px]" style={{ color: "rgba(15,23,42,0.7)" }}>
              {summary}
            </div>
          )}

          {details && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="text-[11px] font-medium px-2 py-1 rounded transition-colors"
                style={{
                  color: "rgba(15,23,42,0.5)",
                  background: open ? "rgba(15,23,42,0.04)" : "transparent",
                }}
              >
                {open ? "Hide details" : "Show details"}
              </button>
              {open && (
                <div
                  className="mt-2 px-3 py-2.5 rounded-lg text-[12px] leading-relaxed"
                  style={{
                    background: "rgba(15,23,42,0.03)",
                    color: "rgba(15,23,42,0.7)",
                    maxHeight: "320px",
                    overflowY: "auto",
                  }}
                >
                  {details}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
