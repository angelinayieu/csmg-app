"use client";

// ── CalibrationStatusStrip ──────────────────────────────────────────────
//
// Gap B's second half: simulating current reality is calibration. The
// lab should refuse to present proposal simulations with a straight face
// until the KG can reproduce the user's stated baselines within
// tolerance. This strip is the user-visible artifact of that gate.
//
// Five states driven by CalibrationSummary:
//
//   unknown       — no baselines declared; strip is a soft neutral note
//                   ("lab runs are unverified against reality")
//   uncalibrated  — declared but 0/N reproduce; strip is red, action
//                   is "show me what's missing"
//   partial       — some reproduce, some don't; strip is amber, action
//                   is "review gaps" + "proceed anyway"
//   calibrated    — all reproduce; strip is emerald, lab is fully unlocked
//   bypassed      — user explicitly said "run anyway past a failing
//                   gate"; strip is dashed amber so the UI keeps
//                   reminding them they chose to ignore it
//
// Not wired to real data yet — the calibration engine itself is a
// separate piece of work (new pipeline stage `reality-calibration`).
// This component ships first so the UI contract is locked in and the
// engine has a concrete target shape to emit. Mount above the lab
// content once SpaceLab can make room for a horizontal strip.

import { ShieldCheck, ShieldAlert, Info, ShieldOff, RefreshCw } from "lucide-react";
import type { CalibrationSummary } from "@/types/simulation-mode";

export interface CalibrationStatusStripProps {
  summary: CalibrationSummary;
  /** Click handler for "review gaps" — opens a drawer listing the
   *  blocker entities the user would need more information on. */
  onReviewGaps?: () => void;
  /** Click handler for "run anyway" — flips to bypassed state. Omit
   *  to hide the escape hatch (strict mode). */
  onBypass?: () => void;
  /** Click handler for "re-run calibration" — recomputes against the
   *  current KG state after the user has fixed blocker entities.
   *  Omit to hide the action (e.g. on the `unknown` / `calibrated`
   *  states where there's nothing to recompute that would change the
   *  verdict). */
  onRecompute?: () => void;
  /** Set while `onRecompute` is in flight so the button can show a
   *  spinner + disable itself. The strip itself doesn't own this
   *  state — the parent tracks it alongside its fetch cache. */
  recomputing?: boolean;
  /** Compact single-line variant for tight headers. Default false. */
  dense?: boolean;
}

export function CalibrationStatusStrip({
  summary,
  onReviewGaps,
  onBypass,
  onRecompute,
  recomputing = false,
  dense = false,
}: CalibrationStatusStripProps) {
  const tone = TONE[summary.status];
  const Icon = tone.icon;
  return (
    <div
      className="flex items-center gap-3 rounded-lg border px-3 py-2"
      style={{
        borderColor: tone.border,
        background: tone.bg,
        borderStyle: summary.status === "bypassed" ? "dashed" : "solid",
      }}
    >
      <Icon className="h-4 w-4 flex-shrink-0" style={{ color: tone.fg }} />
      <div className="min-w-0 flex-1">
        <div
          className="text-[10px] font-bold uppercase tracking-widest"
          style={{ color: tone.fg }}
        >
          {tone.label}
        </div>
        {!dense && (
          <div className="mt-0.5 text-[12px] text-[var(--lab-text-mid)]">
            {summary.headline}
          </div>
        )}
      </div>
      {/* Ratio pill — "8/10 baselines" — present when anything's declared. */}
      {summary.totalCount > 0 && (
        <span
          className="flex-shrink-0 rounded px-2 py-0.5 font-mono text-[11px] tabular-nums"
          style={{ background: `${tone.fg}18`, color: tone.fg }}
        >
          {summary.reproducedCount}/{summary.totalCount}
        </span>
      )}
      {/* Actions — gap-specific. Re-run is surfaced on uncalibrated/
          partial/bypassed because those are the states where a KG fix
          would plausibly change the verdict. On `unknown` there are no
          baselines to re-check; on `calibrated` a recompute adds cost
          without a meaningful state change. The parent owns the
          recomputing-state flag so we can show a spinner inline while
          the orchestrator runs the agent. */}
      {summary.status === "uncalibrated" ||
      summary.status === "partial" ||
      summary.status === "bypassed" ? (
        <div className="flex flex-shrink-0 gap-1.5">
          {onRecompute && (
            <button
              onClick={onRecompute}
              disabled={recomputing}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--lab-border)] px-2.5 py-1 text-[11px] text-[var(--lab-text-mid)] hover:text-[var(--lab-text)] disabled:cursor-not-allowed disabled:opacity-60"
              title="Recompute against the current KG state"
            >
              <RefreshCw
                className={`h-3 w-3 ${recomputing ? "animate-spin" : ""}`}
              />
              {recomputing ? "Re-running…" : "Re-run"}
            </button>
          )}
          {onReviewGaps && (
            <button
              onClick={onReviewGaps}
              className="rounded-md border border-[var(--lab-border-strong)] bg-[var(--lab-panel-raised)] px-2.5 py-1 text-[11px] font-semibold text-[var(--lab-text)] hover:bg-[var(--lab-panel-bg)]"
            >
              Review gaps
            </button>
          )}
          {onBypass && (
            <button
              onClick={onBypass}
              className="rounded-md border border-[var(--lab-border)] px-2.5 py-1 text-[11px] text-[var(--lab-text-mid)] hover:text-[var(--lab-text)]"
            >
              Run anyway
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

const TONE: Record<
  CalibrationSummary["status"],
  {
    label: string;
    fg: string;
    bg: string;
    border: string;
    icon: typeof ShieldCheck;
  }
> = {
  unknown: {
    label: "No baselines declared",
    fg: "#9ca3af",
    bg: "#9ca3af10",
    border: "#9ca3af40",
    icon: Info,
  },
  uncalibrated: {
    label: "Model does not reproduce reality",
    fg: "#f87171",
    bg: "#f8717112",
    border: "#f8717155",
    icon: ShieldAlert,
  },
  partial: {
    label: "Partial calibration",
    fg: "#f59e0b",
    bg: "#f59e0b12",
    border: "#f59e0b55",
    icon: ShieldAlert,
  },
  calibrated: {
    label: "Lab unlocked",
    fg: "#10b981",
    bg: "#10b98112",
    border: "#10b98155",
    icon: ShieldCheck,
  },
  bypassed: {
    label: "Calibration bypassed",
    fg: "#f59e0b",
    bg: "#f59e0b08",
    border: "#f59e0b55",
    icon: ShieldOff,
  },
};
