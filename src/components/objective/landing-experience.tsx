"use client";

// ── Landing experience ──
//
// State-based orchestrator for /app/objective. No route change
// between the portal landing and the entry form — clicking the
// portal card animates it expanding into the entry card via
// Framer Motion's `layoutId` (shared element). When the user
// submits, we navigate to /app/objective/[spaceId].
//
// States:
//   "portal" → portal card centered, recent list below
//   "entry"  → entry form expanded into the same card slot
//
// Direct linking: /app/objective/new still works — that route now
// just redirects here with ?stage=entry, which we read on mount.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { PortalCard } from "@/components/objective/portal-card";
import { ObjectiveEntryCard } from "@/components/objective/objective-entry-card";
import { appleVibe } from "@/lib/apple-vibe-tokens";

interface RecentCanvas {
  id: string;
  name: string | null;
  updated_at: string;
}

interface Props {
  recent: RecentCanvas[];
}

type Stage = "portal" | "entry";

export function LandingExperience({ recent }: Props) {
  const params = useSearchParams();
  const initialStage: Stage =
    params.get("stage") === "entry" ? "entry" : "portal";
  const [stage, setStage] = useState<Stage>(initialStage);
  const reduce = useReducedMotion();

  // Whiteboard texture is the "you've entered the canvas" cue. We
  // fade it in only when the user moves to the entry stage.
  const showWhiteboard = stage === "entry";

  // Lock body scroll while the entry card is mid-transition so the
  // expanding card animation isn't disrupted by scroll snap.
  useEffect(() => {
    if (stage === "entry") {
      document.body.style.overflow = "hidden";
      const timer = setTimeout(() => {
        document.body.style.overflow = "";
      }, 700);
      return () => {
        clearTimeout(timer);
        document.body.style.overflow = "";
      };
    }
  }, [stage]);

  return (
    <div
      className="relative w-full"
      style={{ fontFamily: appleVibe.font.stack }}
    >
      {/* Whiteboard texture — only visible after entering */}
      <motion.div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        initial={false}
        animate={{ opacity: showWhiteboard ? 1 : 0 }}
        transition={{ duration: reduce ? 0 : 0.45, ease: "easeOut" }}
        style={{
          backgroundImage:
            "radial-gradient(rgba(15,23,42,0.085) 1.1px, transparent 1.1px)",
          backgroundSize: "22px 22px",
          backgroundPosition: "0 0",
        }}
      />

      {/* ── Stage: portal ── */}
      <AnimatePresence mode="wait">
        {stage === "portal" && (
          <motion.div
            key="portal"
            initial={false}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeIn" }}
            className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 pb-24 pt-28"
          >
            {/* Hero */}
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="mb-8 text-center"
            >
              <div
                className="mx-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em]"
                style={{
                  background: appleVibe.surface.chip,
                  color: appleVibe.text.tertiary,
                  border: `1px solid ${appleVibe.stroke.hairline}`,
                }}
              >
                <Sparkle className="h-3 w-3" />
                Objective Canvas
              </div>
              <h1
                className="mt-4 text-[40px] font-semibold leading-tight tracking-tight"
                style={{
                  color: appleVibe.text.primary,
                  fontFamily: appleVibe.font.display,
                  letterSpacing: "-0.025em",
                }}
              >
                What are you working on?
              </h1>
              <p
                className="mx-auto mt-2 max-w-xl text-[14.5px] font-light"
                style={{ color: appleVibe.text.secondary }}
              >
                Start with an objective. We&rsquo;ll refine it through a few
                questions, propose sub-objectives, and unfurl them on a
                whiteboard.
              </p>
            </motion.div>

            {/* Portal */}
            <PortalCard onOpen={() => setStage("entry")} />

            {/* Recent — only on the portal stage */}
            {recent.length > 0 && (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
                className="mx-auto mt-12 w-full max-w-2xl"
              >
                <h2
                  className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: appleVibe.text.tertiary }}
                >
                  Recent
                </h2>
                <ul className="space-y-2">
                  {recent.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/app/objective/${c.id}`}
                        className="flex items-center justify-between rounded-2xl px-5 py-3.5 transition-all hover:bg-white"
                        style={{
                          border: `1px solid ${appleVibe.stroke.hairline}`,
                          background: "rgba(255,255,255,0.6)",
                          borderRadius: appleVibe.radius.lg,
                        }}
                      >
                        <span
                          className="line-clamp-1 text-[13.5px] font-medium"
                          style={{ color: appleVibe.text.primary }}
                        >
                          {c.name || "Untitled objective"}
                        </span>
                        <span
                          className="ml-3 flex-shrink-0 text-[10.5px] font-light"
                          style={{ color: appleVibe.text.tertiary }}
                        >
                          {relativeTime(c.updated_at)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* ── Stage: entry ── */}
        {stage === "entry" && (
          <motion.div
            key="entry"
            initial={false}
            transition={{ duration: 0.18, ease: "easeIn" }}
            className="relative mx-auto flex min-h-screen max-w-5xl items-center justify-center px-6"
          >
            <motion.div
              layoutId="portal-card"
              transition={{
                layout: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
              }}
              className="w-full max-w-2xl overflow-hidden"
              style={{
                background: appleVibe.surface.card,
                border: `1px solid ${appleVibe.stroke.soft}`,
                boxShadow: appleVibe.shadow.card,
                borderRadius: appleVibe.radius.xl,
              }}
            >
              <ObjectiveEntryCard onCancel={() => setStage("portal")} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
