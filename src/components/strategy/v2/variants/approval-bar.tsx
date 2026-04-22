"use client";

// ── Approval bar (Arc 1, Items 3 + 5) ──
//
// Premium, confident CTA at the pivotal commit moment. Redesigned from a
// utilitarian toolbar into a single-focal-point action with:
//
//  • Centered primary CTA with oversized type (18px bold, high contrast)
//  • Readiness meter inline — user sees composite score before committing
//  • Approval choreography: click → button morphs to "Approving…" with
//    scale-down press + ring pulse → success flash on complete → smooth
//    transition to confirmed state
//  • Secondary actions (Regenerate / Question) demoted to the edges
//  • Keyboard shortcut: Cmd/Ctrl+Enter approves from the card focus
//  • Respects prefers-reduced-motion (drops scale + pulse animations)
//
// Motion choreography timing (ease-out-back curve):
//  0ms   → user clicks Approve
//  0-180ms  → button scales from 1.0 → 0.96 (tactile press)
//  180-380ms → scales back to 1.02 (lift) + green ring pulse expands
//  380-600ms → settles at 1.0 with "Approving…" text + subtle aurora
//  onSuccess → flash (200ms) → "✓ Confirmed" → 800ms fade to confirmed state

import { CheckCircle2, AlertTriangle, RefreshCw, Rocket } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { ReadyToShipMeter, type ReadyMeterInputs } from "@/components/strategy/ready-to-ship-meter";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { useHotkey } from "@/lib/hooks/use-hotkey";

interface ProgressSnapshot {
  status: "idle" | "running" | "complete" | "failed";
  completed_count: number;
  expected_count: number;
  apps_ready: number;
  apps_created?: number;
}

interface ApprovalBarProps {
  isConfirmed: boolean;
  isTopRanked: boolean;
  loading: boolean;
  onApprove: () => void | Promise<void>;
  onRegenerate?: () => void;
  onQuestion?: () => void;
  cascadeSummary?: string;
  /** Readiness inputs — when provided, the meter renders inline above the CTA */
  readinessInputs?: ReadyMeterInputs;
  /** Space ID — required to poll app-generation progress during confirm */
  spaceId?: string;
}

type MotionPhase = "idle" | "pressing" | "approving" | "success";

export function ApprovalBar({
  isConfirmed,
  isTopRanked,
  loading,
  onApprove,
  onRegenerate,
  onQuestion,
  cascadeSummary,
  readinessInputs,
  spaceId,
}: ApprovalBarProps) {
  const [phase, setPhase] = useState<MotionPhase>(isConfirmed ? "success" : "idle");
  const [progress, setProgress] = useState<ProgressSnapshot | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const prefersReducedMotion = useReducedMotion();

  // ── Streamed confirm progress (Arc 2, Item 4) ──
  // During the approving phase, poll /api/apps/generation-progress every 1000ms
  // so the button + a helper strip below it shows live progress — "Creating
  // tracker 12 / 50", "Generating app 3 / 7". This transforms the 10-30s
  // synchronous confirm from a black-box spinner into a narrated build.
  // Stops polling when phase leaves "approving" or on unmount.
  useEffect(() => {
    if (phase !== "approving" || !spaceId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/apps/generation-progress?spaceId=${encodeURIComponent(spaceId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ProgressSnapshot;
        if (cancelled) return;
        setProgress(data);
        // Terminal states stop the poll naturally via the phase change below
        if (data.status === "running" || data.status === "idle") {
          timer = setTimeout(poll, 1000);
        }
      } catch {
        if (cancelled) return;
        timer = setTimeout(poll, 1500);
      }
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, spaceId]);

  // Sync phase with external confirmed flag (e.g. if confirmation lands via
  // another surface, we still animate into success state.)
  useEffect(() => {
    if (isConfirmed && phase !== "success") {
      setPhase("success");
    } else if (!isConfirmed && phase === "success") {
      setPhase("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfirmed]);

  const handleApprove = async () => {
    if (isConfirmed || loading || phase === "approving") return;
    setPhase("pressing");
    // 180ms press → approving state
    setTimeout(() => setPhase("approving"), prefersReducedMotion ? 0 : 180);
    try {
      await onApprove();
      // success phase handled by isConfirmed effect
    } catch {
      setPhase("idle");
    }
  };

  // Cmd/Ctrl+Enter approves when the bar (or anything inside it) has focus.
  // Active whenever approval is viable (not confirmed, not mid-flight).
  useHotkey(
    "cmd+enter",
    () => {
      const el = barRef.current;
      if (el && el.contains(document.activeElement)) {
        void handleApprove();
      }
    },
    {
      scope: "approval-bar",
      enabled: !isConfirmed && !loading && phase === "idle",
      allowInInput: true, // constraint-input or adjacent textareas shouldn't block approve
    },
  );

  const statusLabel = isConfirmed
    ? "Confirmed strategy"
    : phase === "approving"
      ? "Launching execution labs…"
      : phase === "pressing"
        ? "Committing…"
        : "Ready for approval";

  const ctaLabel = isConfirmed
    ? "Confirmed"
    : phase === "approving"
      ? "Approving…"
      : phase === "pressing"
        ? "Approving…"
        : isTopRanked
          ? "Approve & launch"
          : "Promote & launch";

  const containerTone = isConfirmed
    ? "bg-gradient-to-br from-emerald-50/80 to-white border-emerald-200/70"
    : phase === "approving" || phase === "pressing"
      ? "bg-gradient-to-br from-emerald-50/50 to-white border-emerald-300/60"
      : "bg-gradient-to-br from-white/90 to-white/60 border-gray-200/70";

  return (
    <div
      ref={barRef}
      className={cn(
        "mt-3.5 rounded-[18px] border backdrop-blur-xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-colors duration-500",
        containerTone,
      )}
    >
      {/* Top row: readiness meter (if provided) + status pill */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between gap-4 flex-wrap">
        {readinessInputs ? (
          <ReadyToShipMeter inputs={readinessInputs} compact={false} />
        ) : (
          <div />
        )}
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              isConfirmed ? "bg-emerald-500" : "bg-amber-500",
              !isConfirmed && !prefersReducedMotion && "animate-pulse",
            )}
          />
          <span
            className={cn(
              "text-[9.5px] font-bold uppercase tracking-[0.14em]",
              isConfirmed ? "text-emerald-700" : "text-gray-600",
            )}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Cascade summary line */}
      <div className="px-5 text-[12px] leading-relaxed text-gray-700">
        {cascadeSummary ?? "All cascades converge · proxies wired · downstream traces verified"}
      </div>
      <div className="px-5 pb-3 pt-1 text-[10.5px] leading-snug text-gray-500">
        {isConfirmed
          ? "This variant is locked. Regenerate or swap alternatives to edit."
          : isTopRanked
            ? "Approving locks this variant and opens Execution Labs where live tracking begins. Can be unlocked and re-edited at any time."
            : "Select this alternative to promote it — current top-ranked will drop to review."}
      </div>

      {/* Primary CTA row — centered, oversized, confident */}
      <div className="px-5 pb-5 flex items-center justify-center gap-2">
        {/* Left: Question (demoted, small) */}
        {onQuestion && !isConfirmed && (
          <SecondaryButton
            onClick={onQuestion}
            icon={<AlertTriangle className="w-3 h-3" />}
            label="Question"
            disabled={loading || phase !== "idle"}
          />
        )}

        {/* Center: the pivotal CTA */}
        <button
          onClick={handleApprove}
          disabled={isConfirmed || loading || phase === "approving" || phase === "pressing"}
          className={cn(
            "group relative inline-flex items-center justify-center gap-2.5 rounded-full text-white font-bold transition-all overflow-hidden",
            "min-w-[240px] px-8 py-3.5 text-[15px] tracking-[-0.01em]",
            "shadow-[0_4px_16px_rgba(16,185,129,0.35)]",
            "disabled:opacity-90 disabled:cursor-default",
            !prefersReducedMotion && phase === "idle" && "hover:scale-[1.02] hover:shadow-[0_6px_22px_rgba(16,185,129,0.45)] active:scale-[0.98]",
            phase === "pressing" && !prefersReducedMotion && "scale-[0.96]",
            phase === "approving" && !prefersReducedMotion && "scale-[1.01]",
            isConfirmed ? "bg-emerald-700" : "bg-gradient-to-br from-emerald-500 to-emerald-600",
          )}
          style={{
            transition: prefersReducedMotion
              ? "background-color 200ms ease, box-shadow 200ms ease"
              : "transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 300ms ease-out, background 500ms ease",
          }}
          aria-live="polite"
        >
          {/* Aurora shimmer during approving */}
          {(phase === "approving" || phase === "pressing") && !prefersReducedMotion && (
            <span
              className="absolute inset-0 opacity-40"
              style={{
                background: "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.5) 50%, transparent 70%)",
                animation: "approval-shimmer 1.6s ease-in-out infinite",
              }}
              aria-hidden
            />
          )}
          {/* Ring pulse on press release */}
          {phase === "approving" && !prefersReducedMotion && (
            <span
              className="absolute inset-0 rounded-full ring-2 ring-emerald-300"
              style={{ animation: "approval-ring 1.4s ease-out infinite" }}
              aria-hidden
            />
          )}
          {isConfirmed ? (
            <CheckCircle2 className="w-4 h-4" strokeWidth={2.6} />
          ) : phase === "approving" || phase === "pressing" ? (
            <Rocket className="w-4 h-4" strokeWidth={2.4} />
          ) : (
            <Rocket className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" strokeWidth={2.4} />
          )}
          <span className="relative z-10">{ctaLabel}</span>
        </button>

        {/* Right: Regenerate (demoted, small) */}
        {onRegenerate && !isConfirmed && (
          <SecondaryButton
            onClick={onRegenerate}
            icon={<RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />}
            label="Regenerate"
            disabled={loading || phase !== "idle"}
          />
        )}
      </div>

      {/* Keyboard hint (idle only) */}
      {!isConfirmed && phase === "idle" && (
        <div className="px-5 pb-3 text-center text-[9.5px] text-gray-400 tracking-wide">
          <kbd className="px-1 py-[1px] rounded bg-gray-100 ring-1 ring-gray-200 font-mono text-[9px]">⌘</kbd>
          <span className="mx-0.5">+</span>
          <kbd className="px-1 py-[1px] rounded bg-gray-100 ring-1 ring-gray-200 font-mono text-[9px]">↵</kbd>
          <span className="ml-1.5">to approve</span>
        </div>
      )}

      {/* Live progress narration during approving — transforms the black-box
          wait into a stage-by-stage transparent build. Only visible when
          user has spaceId wired and phase is approving. */}
      {phase === "approving" && spaceId && (
        <ApprovalProgressStrip progress={progress} reducedMotion={prefersReducedMotion} />
      )}

      {/* Local keyframes scoped to this component */}
      <style jsx>{`
        @keyframes approval-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes approval-ring {
          0% { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(1.12); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

/**
 * Live progress strip shown during the approving phase. Narrates what's being
 * created: trackers materializing, apps generating, all with a progress bar +
 * count. Renders even when progress is null/idle (initial state while first
 * poll lands) — shows "Wiring up execution labs…" as a graceful placeholder.
 */
function ApprovalProgressStrip({
  progress,
  reducedMotion,
}: {
  progress: ProgressSnapshot | null;
  reducedMotion: boolean;
}) {
  const pct = progress && progress.expected_count > 0
    ? Math.min(100, Math.round((progress.completed_count / progress.expected_count) * 100))
    : 0;

  const stage = !progress
    ? "Wiring up execution labs…"
    : progress.status === "idle"
      ? "Initializing confirmation…"
      : progress.status === "running"
        ? progress.expected_count > 0
          ? `Generating apps · ${progress.apps_ready} of ${progress.expected_count} ready`
          : "Generating apps…"
        : progress.status === "complete"
          ? `All ${progress.apps_ready} apps ready`
          : "Finalizing…";

  return (
    <div className="px-5 pb-4 pt-1">
      <div className="rounded-xl bg-emerald-50/50 ring-1 ring-emerald-100 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-700">
            Building
          </span>
          <span className="text-[10px] tabular-nums text-emerald-700 font-semibold">
            {progress && progress.expected_count > 0 ? `${pct}%` : ""}
          </span>
        </div>
        <div className="text-[11px] text-emerald-900 leading-snug mb-2">{stage}</div>
        <div className="relative h-1 rounded-full bg-emerald-100 overflow-hidden">
          <div
            className={cn(
              "absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full",
              !reducedMotion && "transition-[width] duration-700 ease-out",
            )}
            style={{ width: `${Math.max(pct, 6)}%` }}
          />
          {/* Indeterminate shimmer while expected_count is 0 (pre-progress-write) */}
          {(!progress || progress.expected_count === 0) && !reducedMotion && (
            <div
              className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-emerald-300 to-transparent"
              style={{ animation: "approval-indeterminate 1.8s ease-in-out infinite" }}
            />
          )}
        </div>
      </div>
      <style jsx>{`
        @keyframes approval-indeterminate {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}

function SecondaryButton({
  onClick,
  icon,
  label,
  disabled,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-semibold text-gray-600 transition-all",
        "bg-white/80 ring-1 ring-gray-200 backdrop-blur-sm",
        "hover:ring-gray-300 hover:text-gray-800 hover:bg-white",
        "disabled:opacity-50 disabled:cursor-not-allowed",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

