"use client";

// ── Landing experience ──
//
// State-based orchestrator for /app/objective. Two stages:
//
//   "portal" → time-aware greeting + Create/Explore card pair +
//              recent list. No route change to enter the form —
//              clicking Create transitions in-place via Framer
//              Motion's layoutId.
//   "entry"  → entry form expanded from the Create card slot.
//
// Direct linking: /app/objective/new redirects here with
// ?stage=entry so deep links land on the form directly.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Beaker, Compass, LayoutTemplate, Plus } from "lucide-react";
import { PortalCard } from "@/components/objective/portal-card";
import { ObjectiveEntryCard } from "@/components/objective/objective-entry-card";
import { WorkspaceLibraryCard } from "@/components/objective/workspace-library-card";
import {
  firstName,
  timeGreeting,
} from "@/lib/objective-canvas/greeting";
import { appleVibe } from "@/lib/apple-vibe-tokens";
import type { WorkspaceCardData } from "@/lib/objective-canvas/load-workspace-library";

interface Props {
  library: WorkspaceCardData[];
  userEmail: string;
  displayName?: string | null;
}

type Stage = "portal" | "entry";

export function LandingExperience({
  library,
  userEmail,
  displayName,
}: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const initialStage: Stage =
    params.get("stage") === "entry" ? "entry" : "portal";
  const [stage, setStage] = useState<Stage>(initialStage);
  const [stackHovered, setStackHovered] = useState(false);
  const reduce = useReducedMotion();

  const showWhiteboard = stage === "entry";
  const greeting = timeGreeting();
  const name = firstName(displayName, userEmail);

  // Lock scroll briefly during the layout animation so the
  // expanding card isn't disrupted by user scrolling.
  useEffect(() => {
    if (stage === "entry") {
      document.body.style.overflow = "hidden";
      const t = setTimeout(() => {
        document.body.style.overflow = "";
      }, 700);
      return () => {
        clearTimeout(t);
        document.body.style.overflow = "";
      };
    }
  }, [stage]);

  return (
    <div
      className="relative w-full"
      style={{ fontFamily: appleVibe.font.stack }}
    >
      {/* Whiteboard dot grid — invisible until entry */}
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
        }}
      />

      <AnimatePresence mode="wait">
        {stage === "portal" && (
          <motion.div
            key="portal"
            initial={false}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeIn" }}
            className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 pb-24 pt-28"
          >
            {/* Greeting — single short line, no subtitle, no badge.
                The cards below explain themselves. */}
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
              className="mb-10 text-center"
            >
              <h1
                className="text-[44px] font-semibold leading-tight tracking-tight"
                style={{
                  color: appleVibe.text.primary,
                  fontFamily: appleVibe.font.display,
                  letterSpacing: "-0.028em",
                }}
              >
                {greeting},{" "}
                <span style={{ color: appleVibe.text.tertiary }}>{name}</span>
              </h1>
            </motion.div>

            {/* Card stack — three square portals fanned out, Create
                centered on top. Side cards tilt outward and sit
                slightly behind; hover an individual card to ease its
                rotation toward 0 and lift. Click Create to straighten
                + zoom + expand into the entry form. Click Templates
                to route to /app/use-cases. */}
            <div
              className="relative flex items-center justify-center"
              style={{ width: 720, height: 320 }}
              onMouseEnter={() => setStackHovered(true)}
              onMouseLeave={() => setStackHovered(false)}
            >
              {/* Templates — leftmost, tilted left, behind Create.
                  Clickable: routes to the use-cases / template library. */}
              <motion.div
                initial={reduce ? false : { opacity: 0, x: -16, y: 14 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                transition={{ duration: 0.5, delay: 0.05, ease: "easeOut" }}
                className="absolute"
                style={{ left: 0, top: 20, zIndex: stackHovered ? 1 : 2 }}
              >
                <PortalCard
                  variant="secondary"
                  title="Templates"
                  subtitle="Browse templates, patterns, and starter canvases."
                  icon={<LayoutTemplate className="h-5 w-5" strokeWidth={1.75} />}
                  onActivate={() => router.push("/app/use-cases")}
                  restRotation={-8}
                />
              </motion.div>

              {/* Create — center, primary, on top. layoutId bridges
                  to the entry stage. Sits flat (no tilt) so it reads
                  as the focal action of the trio. */}
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
                className="absolute"
                style={{ left: 220, top: 20, zIndex: 3 }}
              >
                <PortalCard
                  layoutId="portal-card"
                  variant="primary"
                  title="Create"
                  subtitle="Start a new objective from scratch."
                  icon={<Plus className="h-5 w-5" strokeWidth={2.25} />}
                  onActivate={() => setStage("entry")}
                  restRotation={0}
                />
              </motion.div>

              {/* Explore — rightmost, tilted right, behind Create. */}
              <motion.div
                initial={reduce ? false : { opacity: 0, x: 16, y: 14 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
                className="absolute"
                style={{ right: 0, top: 20, zIndex: stackHovered ? 1 : 2 }}
              >
                <PortalCard
                  variant="secondary"
                  title="Explore"
                  subtitle="Grow your ideas with world-class specialists & deep knowledge."
                  icon={<Compass className="h-5 w-5" strokeWidth={1.75} />}
                  badge="Coming soon"
                  disabled
                  restRotation={8}
                />
              </motion.div>
            </div>

            {/* ── Workspace Library — rich cards replacing the
                flat recents list. Each card shows domain, stage,
                totals, active themes, conflict signal, and reveals
                deliverable shortcuts on hover. The grid maxes out
                at 12 to keep the landing scannable; deeper history
                lives in the future cross-cutting views. */}
            {library.length > 0 && (
              <motion.div
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, delay: 0.18, ease: "easeOut" }}
                className="mx-auto mt-14 w-full max-w-5xl"
              >
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <h2
                    className="text-[10.5px] font-semibold uppercase tracking-[0.16em]"
                    style={{ color: appleVibe.text.tertiary }}
                  >
                    Library
                  </h2>
                  <span
                    className="text-[10.5px] font-light"
                    style={{ color: appleVibe.text.faint }}
                  >
                    {library.length === 1
                      ? "1 workspace"
                      : `${library.length} workspaces`}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {library.map((card) => (
                    <WorkspaceLibraryCard key={card.id} card={card} />
                  ))}
                </div>

                {/* ── Cross-cutting library views ──
                    Lifts experiments out of individual workspaces
                    into a single research-notebook surface. Only
                    renders when the user has ≥1 experiment in flight
                    so we don't suggest an empty link. */}
                {library.some((c) => c.totals.experiments_planned > 0) && (
                  <div
                    className="mt-6 flex flex-wrap items-center justify-center gap-2"
                  >
                    <Link
                      href="/app/library/experiments"
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-medium transition-colors"
                      style={{
                        background: "rgba(15,23,42,0.04)",
                        color: appleVibe.text.secondary,
                        border: `1px solid ${appleVibe.stroke.hairline}`,
                      }}
                    >
                      <Beaker className="h-3 w-3" strokeWidth={2} />
                      View all experiments
                      <span style={{ color: appleVibe.text.faint }}>
                        {library.reduce(
                          (sum, c) => sum + c.totals.experiments_planned,
                          0,
                        )}
                      </span>
                      <ArrowRight className="h-2.5 w-2.5" strokeWidth={2.5} />
                    </Link>
                  </div>
                )}
              </motion.div>
            )}
          </motion.div>
        )}

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

