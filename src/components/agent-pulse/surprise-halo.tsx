"use client";

/**
 * Wave D L3.6 — SurpriseHalo.
 *
 * Ambient glow wrapper that pulses around any card / element when the
 * referenced entity has an unread urgent agent_finding (usually a
 * prediction surprise or flagged risk).
 *
 * Pure visual — no data fetching. The parent looks up findings from
 * useRealtimeAgentFindings and passes `active` + optional `severity`.
 * Decoupled so a halo can wrap an app card, a goal row, a metric chip,
 * etc. without each component re-querying.
 *
 * Motion note: uses a slow breathing pulse (3s cycle), not a flashy
 * blink — this is the visionOS "it's alive, not alarming" aesthetic.
 */

import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export interface SurpriseHaloProps {
  /** When true, the halo renders. */
  active: boolean;
  /** Drives halo color. Defaults to 'urgent'. */
  severity?: "urgent" | "notable" | "info";
  /** Corner radius of the underlying element — match the card's rounded-*. */
  rounded?: "md" | "lg" | "xl" | "2xl" | "3xl";
  children: React.ReactNode;
  className?: string;
}

export function SurpriseHalo({
  active,
  severity = "urgent",
  rounded = "2xl",
  children,
  className,
}: SurpriseHaloProps) {
  const color =
    severity === "urgent"
      ? "shadow-amber-400/50"
      : severity === "notable"
        ? "shadow-sky-400/50"
        : "shadow-neutral-300/40";
  const ring =
    severity === "urgent"
      ? "ring-amber-300/60"
      : severity === "notable"
        ? "ring-sky-300/50"
        : "ring-neutral-200/60";
  const roundedClass = {
    md: "rounded-md",
    lg: "rounded-lg",
    xl: "rounded-xl",
    "2xl": "rounded-2xl",
    "3xl": "rounded-3xl",
  }[rounded];

  return (
    <div className={cn("relative", className)}>
      <AnimatePresence>
        {active && (
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{
              opacity: [0.35, 0.75, 0.35],
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className={cn(
              "pointer-events-none absolute -inset-1 ring-2 shadow-[0_0_28px_8px_rgba(0,0,0,0)] shadow-current",
              roundedClass,
              ring,
              color,
            )}
          />
        )}
      </AnimatePresence>
      <div className="relative">{children}</div>
    </div>
  );
}
