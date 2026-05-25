"use client";

// ── Portal Card ──
//
// The "Start a new objective" CTA on the Objective Canvas landing.
// Designed to feel like a door to the canvas, not a button:
//
//   - Subtle BREATHING: scale loops 1.0 ↔ 1.012 on a 4s cadence,
//     paused when the user is interacting (hover / focus).
//   - CURSOR PARALLAX: the inner content (icon, heading, hint)
//     shifts ~6px in response to the mouse position over the card.
//     Apple/Linear-style — feels alive without being noisy.
//   - DRIFTING TWINKLES: 4 small sparkles trace slow random paths
//     inside the card. Random per-mount so it never feels mechanical.
//   - CLICK → motion.div with `layoutId="portal-card"` makes the
//     card morph into the entry card when the parent transitions.
//
// Click handler is supplied by the parent (landing-experience).
// On click we set internal "leaving" state so the breathing stops
// and the card's final scale is owned by the parent's layout
// animation.

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { Sparkle } from "@/components/objective/icons/sparkle";
import { appleVibe } from "@/lib/apple-vibe-tokens";

interface Props {
  onOpen: () => void;
}

interface TwinkleSpec {
  /** % from left, 0..100 */
  x: number;
  /** % from top, 0..100 */
  y: number;
  /** Pixel size */
  size: number;
  /** Animation delay seconds */
  delay: number;
  /** Animation duration seconds (long → slow drift) */
  duration: number;
  /** Random drift radius in px */
  drift: number;
}

function generateTwinkles(): TwinkleSpec[] {
  // Hand-tuned positions across the card, then a tiny random jitter
  // each mount so the picture isn't identical on every refresh.
  const seeds = [
    { x: 12, y: 28, size: 12 },
    { x: 88, y: 22, size: 9 },
    { x: 22, y: 78, size: 8 },
    { x: 82, y: 72, size: 14 },
  ];
  return seeds.map((s, i) => ({
    x: s.x + (Math.random() * 6 - 3),
    y: s.y + (Math.random() * 6 - 3),
    size: s.size + (Math.random() * 2 - 1),
    delay: i * 0.6 + Math.random() * 0.4,
    duration: 5.5 + Math.random() * 1.6,
    drift: 14 + Math.random() * 10,
  }));
}

export function PortalCard({ onOpen }: Props) {
  const reduce = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [opening, setOpening] = useState(false);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  // Twinkles are generated once per mount.
  const twinkles = useMemo(() => generateTwinkles(), []);

  // ── Cursor parallax ──
  // Map mouse position to a small offset (-6 .. +6 px), eased by
  // distance from center. Reset when mouse leaves the card.
  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (reduce || opening) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);
    setParallax({
      x: Math.max(-1, Math.min(1, dx)) * 6,
      y: Math.max(-1, Math.min(1, dy)) * 6,
    });
  }

  function onMouseLeave() {
    setHovered(false);
    setParallax({ x: 0, y: 0 });
  }

  function handleClick() {
    if (opening) return;
    setOpening(true);
    // Brief hold so the press animation reads before the parent
    // begins the route transition.
    setTimeout(onOpen, 140);
  }

  // Keyboard activation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.key === "Enter" || e.key === " ") && document.activeElement === containerRef.current) {
        e.preventDefault();
        handleClick();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening]);

  const breathing =
    !reduce && !hovered && !opening
      ? {
          scale: [1, 1.012, 1],
        }
      : { scale: 1 };

  return (
    <motion.div
      ref={containerRef}
      role="button"
      tabIndex={0}
      aria-label="Start a new objective"
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      layoutId="portal-card"
      transition={{
        layout: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
      }}
      animate={{
        ...breathing,
        boxShadow: hovered
          ? appleVibe.shadow.cardHover
          : appleVibe.shadow.card,
      }}
      // Breathing keyframes loop, hover/press transitions are
      // independent so they don't fight.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {...({
        transition: {
          scale: hovered || opening
            ? { duration: 0.25, ease: "easeOut" }
            : { duration: 4, ease: "easeInOut", repeat: Infinity },
          boxShadow: { duration: 0.25, ease: "easeOut" },
          layout: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
        },
      } as any)}
      whileTap={!reduce ? { scale: 0.985 } : undefined}
      className="group relative mx-auto block w-full max-w-2xl cursor-pointer overflow-hidden p-7 outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={{
        background: appleVibe.surface.card,
        border: `1px solid ${appleVibe.stroke.soft}`,
        boxShadow: appleVibe.shadow.card,
        borderRadius: appleVibe.radius.xl,
        fontFamily: appleVibe.font.stack,
      }}
    >
      {/* ── Twinkles layer ── */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {twinkles.map((t, i) => (
          <motion.div
            key={i}
            className="absolute"
            style={{
              left: `${t.x}%`,
              top: `${t.y}%`,
              width: t.size,
              height: t.size,
              color: "rgba(15,23,42,0.18)",
            }}
            animate={
              reduce
                ? undefined
                : {
                    x: [0, t.drift, -t.drift * 0.6, t.drift * 0.4, 0],
                    y: [0, -t.drift * 0.8, t.drift * 0.6, -t.drift * 0.3, 0],
                    opacity: [0.25, 0.7, 0.4, 0.65, 0.25],
                    rotate: [0, 40, -20, 30, 0],
                  }
            }
            transition={{
              duration: t.duration,
              delay: t.delay,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <Sparkle className="h-full w-full" />
          </motion.div>
        ))}
      </div>

      {/* ── Inner content, parallax-shifted ── */}
      <motion.div
        animate={{ x: parallax.x, y: parallax.y }}
        transition={{ type: "spring", stiffness: 120, damping: 18, mass: 0.4 }}
        className="relative flex items-center gap-5"
      >
        {/* Icon (the door handle) */}
        <motion.div
          animate={{
            rotate: hovered ? 8 : 0,
            scale: pressed ? 0.92 : hovered ? 1.06 : 1,
          }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="flex h-12 w-12 flex-shrink-0 items-center justify-center"
          style={{
            background: appleVibe.accent.primary,
            color: appleVibe.text.onAccent,
            borderRadius: 14,
            boxShadow:
              "0 1px 0 rgba(255,255,255,0.18) inset, 0 8px 18px -10px rgba(11,18,40,0.45)",
          }}
        >
          <Plus className="h-5 w-5" strokeWidth={2.25} />
        </motion.div>

        <div className="min-w-0 flex-1">
          <div
            className="text-[10.5px] font-semibold uppercase tracking-[0.14em]"
            style={{ color: appleVibe.text.tertiary }}
          >
            New objective
          </div>
          <h2
            className="mt-1 text-[20px] font-semibold leading-tight tracking-tight"
            style={{
              color: appleVibe.text.primary,
              fontFamily: appleVibe.font.display,
              letterSpacing: "-0.015em",
            }}
          >
            What are you working on?
          </h2>
          <p
            className="mt-0.5 text-[12.5px] font-light"
            style={{ color: appleVibe.text.secondary }}
          >
            Type your goal · pick Autopilot or Human-in-the-loop · we
            unfurl it onto a whiteboard
          </p>
        </div>

        <motion.div
          animate={{ x: hovered ? 4 : 0, opacity: hovered ? 1 : 0.55 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="flex-shrink-0"
        >
          <ArrowRight
            className="h-4 w-4"
            strokeWidth={2}
            style={{ color: appleVibe.text.secondary }}
          />
        </motion.div>
      </motion.div>

      {/* ── Hover-only glow ring ── */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        animate={{ opacity: hovered ? 1 : 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        style={{
          borderRadius: appleVibe.radius.xl,
          background:
            "radial-gradient(circle at var(--mx,50%) var(--my,50%), rgba(124,58,237,0.06), transparent 60%)",
        }}
      />
    </motion.div>
  );
}
