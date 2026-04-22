"use client";

/**
 * Wave D L3.7 — AgentActivityBell.
 *
 * Compact bell icon for the sidebar footer. Shows a count badge when
 * there are unread findings; tinted amber when any unread finding is
 * urgent. Clicking opens the FloatingFeedSheet.
 *
 * Mounting this in the sidebar means the agent feed is reachable from
 * every authenticated route — not just pages that happen to include
 * the AgentPulseModule card.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell } from "lucide-react";
import { useRealtimeAgentFindings } from "@/lib/hooks/use-realtime-agent-findings";
import { FloatingFeedSheet } from "./floating-feed-sheet";
import { cn } from "@/lib/utils";

export interface AgentActivityBellProps {
  userId: string | null;
  /** Sidebar collapsed state — bell shrinks to icon-only when true. */
  collapsed?: boolean;
  className?: string;
}

const SPRING = { type: "spring" as const, stiffness: 280, damping: 26 };

export function AgentActivityBell({
  userId,
  collapsed,
  className,
}: AgentActivityBellProps) {
  const { findings, unreadCount, urgentCount, markReviewedLocal } =
    useRealtimeAgentFindings(userId, { limit: 50 });
  const [sheetOpen, setSheetOpen] = useState(false);

  if (!userId) return null;

  const tone: "urgent" | "notable" | "calm" = urgentCount > 0
    ? "urgent"
    : unreadCount > 0
      ? "notable"
      : "calm";

  const toneClasses = {
    urgent: "bg-amber-50 text-amber-700 hover:bg-amber-100",
    notable: "bg-sky-50 text-sky-700 hover:bg-sky-100",
    calm: "bg-white/60 text-gray-600 hover:bg-white",
  }[tone];

  return (
    <>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className={cn(
          "relative flex w-full items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold transition-all",
          toneClasses,
          collapsed && "justify-center px-1.5",
          className,
        )}
        aria-label={`Agent activity — ${unreadCount} unread${urgentCount > 0 ? `, ${urgentCount} urgent` : ""}`}
        title={
          collapsed
            ? `Agent activity — ${unreadCount} unread${urgentCount > 0 ? `, ${urgentCount} urgent` : ""}`
            : undefined
        }
      >
        <div className="relative flex-shrink-0">
          <Bell className="h-3 w-3" />
          <AnimatePresence>
            {unreadCount > 0 && (
              <motion.span
                key={`badge-${unreadCount}-${tone}`}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={SPRING}
                className={cn(
                  "absolute -top-1.5 -right-1.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full px-1 text-[9px] font-bold text-white shadow-sm",
                  tone === "urgent" ? "bg-amber-500" : "bg-sky-500",
                )}
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        {!collapsed && (
          <span className="flex-1 text-left">
            {tone === "urgent"
              ? "Needs attention"
              : tone === "notable"
                ? "New findings"
                : "Agent activity"}
          </span>
        )}
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
