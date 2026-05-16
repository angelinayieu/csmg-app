// ── Divergence banner ──
//
// Soft notification banner that surfaces when the strategy matcher
// flags this room as diverged. One paragraph + two buttons:
//   - "Keep tracking" → dismisses the banner (POST /dismiss-divergence)
//   - "Archive room"  → opens the archive sheet via callback
//
// Visual: hairline gray-200 border, gray-50 background (off-white so
// it sits between the white card chrome and the page), inline ⚠
// glyph at strokeWidth 1.5 in gray-700. Apple Pro restraint — no
// bright color anywhere, no urgent affordances. The room user got
// here by regenerating; this is informational, not alarming.

"use client";

import { useState } from "react";
import { GitBranch, Loader2 } from "lucide-react";
import { toast } from "@/lib/hooks/use-toast";
import { dismissDivergence } from "@/lib/synergy/divergence-client";

interface Props {
  roomId: string;
  /** Called after a successful dismiss so the parent can hide the banner. */
  onDismissed: () => void;
  /** Opens the archive confirm sheet (owned by the parent / more-menu). */
  onArchive: () => void;
}

export function DivergenceBanner({ roomId, onDismissed, onArchive }: Props) {
  const [dismissing, setDismissing] = useState(false);

  const onKeepTracking = async () => {
    if (dismissing) return;
    setDismissing(true);
    try {
      await dismissDivergence(roomId);
      toast.success("Keep tracking");
      onDismissed();
    } catch (e) {
      toast.error("Couldn't dismiss", { description: (e as Error).message });
      setDismissing(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-7 rounded-2xl border border-gray-200 bg-gray-50/80 px-5 py-4"
    >
      <div className="flex items-start gap-3">
        <GitBranch
          className="mt-0.5 h-4 w-4 shrink-0 text-gray-700"
          strokeWidth={1.5}
        />
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-gray-500">
            Paths diverged
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-gray-700">
            One of your strategies has changed enough that the matcher no
            longer finds a parallel-path fit between you. The room still
            works — but the shared theme and pillars are now stale.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onKeepTracking}
              disabled={dismissing}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:opacity-60"
            >
              {dismissing && (
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
              )}
              Keep tracking
            </button>
            <button
              type="button"
              onClick={onArchive}
              className="inline-flex items-center rounded-md bg-gray-900 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-gray-800"
            >
              Archive room
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
