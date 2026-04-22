"use client";

/**
 * Wave D L3.6 — AgentPulseModule.
 *
 * Dashboard card showing "what have the agents noticed?" — a live count
 * of unread findings broken by severity, with the top 3 headlines
 * inline. Clicking the card opens the FloatingFeedSheet.
 *
 * Philosophy (visionOS-aesthetic, matches PulseBar language):
 *   - One ambient surface, not a queue.
 *   - Color tells the story: amber when urgent items await; gray when clear.
 *   - Counts tween with cubic-bezier(0.22, 1, 0.36, 1) — never step-jumps.
 */

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Sparkles, Bell, ChevronRight } from "lucide-react";
import { useRealtimeAgentFindings } from "@/lib/hooks/use-realtime-agent-findings";
import { FloatingFeedSheet } from "./floating-feed-sheet";
import { cn } from "@/lib/utils";
import type { AgentFinding } from "@/types";

export interface AgentPulseModuleProps {
  userId: string;
  /** Scope to a single space. Omit for cross-space dashboard view. */
  spaceId?: string | null;
  className?: string;
}

const SPRING = { type: "spring" as const, stiffness: 260, damping: 28 };

export function AgentPulseModule({
  userId,
  spaceId = null,
  className,
}: AgentPulseModuleProps) {
  const { findings, unreadCount, urgentCount, loading, markReviewedLocal } =
    useRealtimeAgentFindings(userId, { spaceId, limit: 50 });
  const [sheetOpen, setSheetOpen] = useState(false);

  const headlines = useMemo(() => {
    // Show top 3 unread by severity, then notable, then info.
    const unread = findings.filter((f) => f.status === "unread");
    unread.sort((a, b) => {
      const rank = (sev: string | null) =>
        sev === "urgent" ? 0 : sev === "notable" ? 1 : 2;
      const r = rank(a.severity) - rank(b.severity);
      if (r !== 0) return r;
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
    return unread.slice(0, 3);
  }, [findings]);

  const tone: "urgent" | "notable" | "calm" = urgentCount > 0
    ? "urgent"
    : unreadCount > 0
      ? "notable"
      : "calm";

  const toneStyles = {
    urgent: {
      ring: "ring-amber-300/60",
      halo: "bg-amber-400/10",
      iconColor: "text-amber-600",
      label: "Needs attention",
    },
    notable: {
      ring: "ring-sky-300/50",
      halo: "bg-sky-400/10",
      iconColor: "text-sky-600",
      label: "New signals",
    },
    calm: {
      ring: "ring-neutral-200/60",
      halo: "bg-neutral-100/40",
      iconColor: "text-neutral-500",
      label: "All clear",
    },
  }[tone];

  return (
    <>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className={cn(
          "glass-card-dashboard is-interactive group relative w-full overflow-hidden rounded-2xl p-5 text-left transition-all duration-300",
          "ring-1",
          toneStyles.ring,
          className,
        )}
        style={{
          transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        aria-label={`Agent pulse — ${unreadCount} unread findings`}
      >
        {/* Ambient halo */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute -top-8 -right-8 h-32 w-32 rounded-full blur-2xl transition-opacity duration-500",
            toneStyles.halo,
            tone === "calm" ? "opacity-40" : "opacity-80",
          )}
        />

        <div className="relative flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl bg-white/70 shadow-sm backdrop-blur",
                toneStyles.iconColor,
              )}
            >
              {tone === "urgent" ? (
                <AlertTriangle className="h-4 w-4" strokeWidth={2.25} />
              ) : tone === "notable" ? (
                <Sparkles className="h-4 w-4" strokeWidth={2.25} />
              ) : (
                <Bell className="h-4 w-4" strokeWidth={2} />
              )}
            </div>
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-neutral-500">
                Agent pulse
              </div>
              <div className="text-sm font-semibold text-neutral-800">
                {toneStyles.label}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <AnimatePresence mode="popLayout">
              <motion.div
                key={`count-${unreadCount}`}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={SPRING}
                className="rounded-full bg-white/60 px-2.5 py-0.5 text-xs font-semibold text-neutral-700 shadow-sm backdrop-blur"
              >
                {loading ? "—" : unreadCount}
              </motion.div>
            </AnimatePresence>
            <ChevronRight className="h-4 w-4 text-neutral-400 transition-transform duration-300 group-hover:translate-x-0.5" />
          </div>
        </div>

        {/* Headlines */}
        <div className="relative mt-4 space-y-1.5">
          <AnimatePresence mode="popLayout" initial={false}>
            {headlines.length === 0 && !loading ? (
              <motion.p
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-xs text-neutral-500"
              >
                No unread findings. Agents will surface new signals here as they
                land.
              </motion.p>
            ) : (
              headlines.map((f) => (
                <motion.div
                  key={f.id}
                  layout
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 6 }}
                  transition={SPRING}
                  className="flex items-center gap-2 text-xs text-neutral-700"
                >
                  <SeverityDot severity={f.severity} />
                  <span className="line-clamp-1">{f.summary}</span>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>
      </button>

      <FloatingFeedSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        findings={findings}
        userId={userId}
        onMarkReviewed={markReviewedLocal}
      />
    </>
  );
}

function SeverityDot({ severity }: { severity: AgentFinding["severity"] }) {
  const color =
    severity === "urgent"
      ? "bg-amber-500"
      : severity === "notable"
        ? "bg-sky-500"
        : "bg-neutral-400";
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full",
        color,
      )}
      aria-hidden
    />
  );
}
